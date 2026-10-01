import {
  type AltiumRecord,
  getSchematicRecordPoints,
  parseAltiumSchDoc,
} from "altiumts"
import { createAltiumSchematicCoordinateFields as coordinates } from "./create-altium-schematic-coordinate-fields"
import { normalizeSchematicWireSegments } from "./normalize-schematic-wire-segments"
import type { Point } from "./types"

type WireSegment = { from: Point; to: Point; record: AltiumRecord }
type SchematicWireStyleKey = string

/** Normalize the completed export, including fractional net-label leaders.
 * Owned artwork and wires with children are left alone. Removing sheet wires
 * must remap ownership of subsequent components, templates and annotations.
 */
export function normalizeSchematicDocumentWires(asciiContent: string): string {
  const document = parseAltiumSchDoc(asciiContent)
  const replacements = new Map<AltiumRecord, AltiumRecord[]>()
  const groups = new Map<SchematicWireStyleKey, WireSegment[]>()
  for (const wire of document.wires) {
    if (document.getParent(wire) || document.getOwnedRecords(wire).length) {
      continue
    }
    const key = ["COLOR", "LINEWIDTH", "ISHIDDEN"]
      .map((field) => wire.getCaseInsensitive(field))
      .join(":")
    const group = groups.get(key) ?? []
    const points = getSchematicRecordPoints(wire)
    for (let index = 1; index < points.length; index++) {
      group.push({ from: points[index - 1]!, to: points[index]!, record: wire })
    }
    groups.set(key, group)
    replacements.set(wire, [])
  }
  const connectionSegments = [...groups.values()].flat()
  for (const group of groups.values()) {
    for (const { from, to, record } of normalizeSchematicWireSegments(
      group,
      connectionSegments,
    )) {
      const originalPoints = getSchematicRecordPoints(record)
      if (
        originalPoints.length === 2 &&
        originalPoints[0]!.x === from.x &&
        originalPoints[0]!.y === from.y &&
        originalPoints[1]!.x === to.x &&
        originalPoints[1]!.y === to.y
      ) {
        replacements.get(record)!.push(record)
        continue
      }
      const fields = record.fields
        .filter(
          (field) => !/^(LOCATIONCOUNT|[XY]\d+(_FRAC)?)$/iu.test(field.key),
        )
        .filter(
          (field) =>
            field.key.toUpperCase() !== "UNIQUEID" ||
            replacements.get(record)!.length === 0,
        )
        .map((field) => field.getString())
      fields.push(
        "LOCATIONCOUNT=2",
        ...coordinates("X1", from.x),
        ...coordinates("Y1", from.y),
        ...coordinates("X2", to.x),
        ...coordinates("Y2", to.y),
      )
      const replacement = parseAltiumSchDoc(
        `|RECORD=31\r\n|${fields.join("|")}\r\n`,
      ).records[1]!
      replacements.get(record)!.push(replacement)
    }
  }
  if (
    [...replacements].every(
      ([record, records]) => records.length === 1 && records[0] === record,
    )
  ) {
    return asciiContent
  }
  const indexByRecord = new Map(
    document.records.map((record, index) => [record, index]),
  )
  const newIndexByOldIndex = new Map<number, number>()
  let nextIndex = 0
  const lines = document.lines.flatMap((line) => {
    const oldIndex = indexByRecord.get(line as AltiumRecord)
    if (oldIndex === undefined) return [line]
    const records = replacements.get(line as AltiumRecord) ?? [line]
    if (records.length) newIndexByOldIndex.set(oldIndex, nextIndex)
    nextIndex += records.length
    return records
  })
  let recordIndex = 0
  for (const line of lines) {
    const record = line as AltiumRecord
    if (record.recordKind === undefined) continue
    for (const field of record.fields) {
      if (
        field.key.toUpperCase() === "OWNERINDEX" &&
        Number(field.value) >= 0
      ) {
        const newIndex = newIndexByOldIndex.get(Number(field.value))
        if (newIndex === undefined)
          throw new Error("Cannot remove an owned schematic record")
        field.value = String(newIndex)
      }
      if (
        field.key.toUpperCase() === "INDEXINSHEET" &&
        Number(field.value) >= 0
      ) {
        field.value = String(recordIndex)
      }
    }
    recordIndex++
  }
  return lines.map((line) => `${line.getString()}${line.terminator}`).join("")
}
