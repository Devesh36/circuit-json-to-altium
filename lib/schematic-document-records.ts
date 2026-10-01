import { createAltiumSchematicCoordinateFields } from "./create-altium-schematic-coordinate-fields"
import type { SchematicRecordContext } from "./schematic-document-types"

export function createSchematicRecordContext(): SchematicRecordContext {
  return {
    lines: [
      "|HEADER=Protel for Windows - Schematic Capture Ascii File Version 5.0",
    ],
    nextRecordIndex: 0,
  }
}

export function addSchematicRecord(
  recordFields: string[],
  context: SchematicRecordContext,
): number {
  const altiumRecordIndex = context.nextRecordIndex
  const normalizedRecordFields = recordFields.flatMap((field) => {
    const match =
      /^((?:LOCATION|CORNER)\.[XY]|[XY]\d+|RADIUS|SECONDARYRADIUS|PINLENGTH|WIDTH|HEIGHT|XSIZE|YSIZE|DISTANCEFROMTOP)=([+-]?[\d.]+)$/iu.exec(
        field,
      )
    if (!match || Number.isInteger(Number(match[2]))) return [field]
    if (match[1] === "DISTANCEFROMTOP") {
      // Sheet entries use 10-unit bases and _FRAC1 in 1/100,000 units.
      const ticks = Math.round(Number(match[2]) * 1_000_000)
      const base = Math.trunc(ticks / 1_000_000)
      const fraction = ticks - base * 1_000_000
      return [`DISTANCEFROMTOP=${base}`, `DISTANCEFROMTOP_FRAC1=${fraction}`]
    }
    return createAltiumSchematicCoordinateFields(match[1]!, Number(match[2]))
  })
  context.lines.push(`|${normalizedRecordFields.join("|")}`)
  context.nextRecordIndex++
  return altiumRecordIndex
}

export function remapTemplateFontId({
  fontIdBySourceFontId,
  recordFields,
}: {
  fontIdBySourceFontId: Map<number, number>
  recordFields: string[]
}): string[] {
  return recordFields.map((field) => {
    const match = /^FONTID=(\d+)$/iu.exec(field)
    const sourceFontId = Number(match?.[1])
    const fontId = fontIdBySourceFontId.get(sourceFontId)
    return fontId === undefined ? field : `FONTID=${fontId}`
  })
}
