import { createAltiumSchematicNoConnectRecordFields } from "./create-altium-schematic-no-connect-record-fields"
import {
  asNumber,
  asPoint,
  asString,
  isCircuitElement,
  sanitizeField,
} from "./format"
import type {
  CircuitElement,
  Point,
  SchematicSheetId,
  SourcePortId,
} from "./types"

export type AltiumSchematicChildSheet = {
  filename: string
  name: string
  schematicSheetId: SchematicSheetId
  subcircuitId?: string
}

export type AltiumSchematicSheetSymbolPlan = {
  childSheet: AltiumSchematicChildSheet
  entries: AltiumSchematicSheetEntryPlan[]
  height: number
  placementComponent?: CircuitElement
  width: number
}

type AltiumSchematicSheetEntryPlan = {
  circuitPosition?: Point
  distanceFromTop: number
  doNotConnect: boolean
  ioType: number
  name: string
  side: 0 | 1
}

type CreateAltiumSchematicSheetSymbolPlansOptions = {
  scale?: number
  childSheets: AltiumSchematicChildSheet[]
  circuitJson: CircuitElement[]
}

type CreateAltiumSchematicSheetSymbolRecordFieldsOptions = {
  scale?: number
  altiumSymbolRecordIndex: number
  location: Point
  plan: AltiumSchematicSheetSymbolPlan
}

const ALTIUM_SHEET_ENTRY_SPACING = 10
const ALTIUM_SHEET_ENTRY_DISTANCE_UNIT = 10
const ALTIUM_SHEET_SYMBOL_MINIMUM_HEIGHT = 60
const ALTIUM_SHEET_SYMBOL_MINIMUM_WIDTH = 160
const ALTIUM_SCHEMATIC_COMPONENT_OUTLINE_COLOR = 132
const ALTIUM_SCHEMATIC_COMPONENT_FILL_COLOR = 12_779_519

export function createAltiumSchematicSheetSymbolPlans({
  scale = 1,
  childSheets,
  circuitJson,
}: CreateAltiumSchematicSheetSymbolPlansOptions): AltiumSchematicSheetSymbolPlan[] {
  const sourcePortsById = new Map<SourcePortId, CircuitElement>(
    circuitJson
      .filter((element) => element.type === "source_port")
      .map((sourcePort) => [asString(sourcePort.source_port_id), sourcePort]),
  )

  return childSheets.map((childSheet) => {
    const placementComponent = circuitJson.find(
      (element) =>
        element.type === "schematic_component" &&
        element.is_schematic_group === true &&
        !asString(element.schematic_sheet_id) &&
        childSheet.subcircuitId !== undefined &&
        asString(element.subcircuit_id) === childSheet.subcircuitId,
    )
    const childPorts = circuitJson.filter(
      (element) =>
        element.type === "schematic_port" &&
        asString(element.schematic_sheet_id) === childSheet.schematicSheetId &&
        !asString(element.schematic_component_id),
    )
    const sideEntryCounts: Record<0 | 1, number> = { 0: 0, 1: 0 }
    const entries = childPorts.flatMap((schematicPort) => {
      const sourcePort = sourcePortsById.get(
        asString(schematicPort.source_port_id),
      )
      const name =
        asString(schematicPort.display_pin_label) || asString(sourcePort?.name)
      if (!name) return []

      const hasInputArrow = schematicPort.has_input_arrow === true
      const hasOutputArrow = schematicPort.has_output_arrow === true
      const side = getAltiumSchematicSheetEntrySide(schematicPort)
      sideEntryCounts[side]++
      return [
        {
          circuitPosition: asPoint(schematicPort.center),
          distanceFromTop: placementComponent
            ? getAltiumSchematicSheetEntryDistanceFromTop({
                placementComponent,
                schematicPort,
                scale,
              })
            : sideEntryCounts[side] * scale,
          doNotConnect: sourcePort?.do_not_connect === true,
          ioType: hasInputArrow
            ? hasOutputArrow
              ? 3
              : 1
            : hasOutputArrow
              ? 2
              : 0,
          name,
          side,
        } satisfies AltiumSchematicSheetEntryPlan,
      ]
    })
    const longestLabelLength = Math.max(
      childSheet.name.length,
      childSheet.filename.length,
      ...entries.map((entry) => entry.name.length * 2),
    )

    return {
      childSheet,
      entries,
      height:
        scale *
        Math.max(
          ALTIUM_SHEET_SYMBOL_MINIMUM_HEIGHT,
          Math.max(sideEntryCounts[0], sideEntryCounts[1]) *
            ALTIUM_SHEET_ENTRY_SPACING +
            20,
        ),
      placementComponent,
      width:
        scale *
        Math.max(
          ALTIUM_SHEET_SYMBOL_MINIMUM_WIDTH,
          longestLabelLength * 6 + 20,
        ),
    }
  })
}

export function createAltiumSchematicSheetEntryNoConnectRecordFields({
  location,
  plan,
}: {
  location: Point
  plan: AltiumSchematicSheetSymbolPlan
}): string[][] {
  return plan.entries.flatMap((entry) =>
    entry.doNotConnect
      ? [
          createAltiumSchematicNoConnectRecordFields({
            altiumNoConnectPosition: {
              x: location.x + (entry.side === 1 ? plan.width : 0),
              y:
                location.y -
                entry.distanceFromTop * ALTIUM_SHEET_ENTRY_DISTANCE_UNIT,
            },
          }),
        ]
      : [],
  )
}

export function createAltiumSchematicSheetSymbolOwnedRecordFields({
  scale = 1,
  altiumSymbolRecordIndex,
  location,
  plan,
}: CreateAltiumSchematicSheetSymbolRecordFieldsOptions): string[][] {
  const { childSheet, entries } = plan
  return [
    [
      "RECORD=32",
      `OWNERINDEX=${altiumSymbolRecordIndex}`,
      "OWNERPARTID=-1",
      `LOCATION.X=${location.x}`,
      `LOCATION.Y=${location.y + 10 * scale}`,
      "COLOR=8388608",
      "FONTID=1",
      `TEXT=${sanitizeField(childSheet.name)}`,
    ],
    [
      "RECORD=33",
      `OWNERINDEX=${altiumSymbolRecordIndex}`,
      "OWNERPARTID=-1",
      `LOCATION.X=${location.x}`,
      `LOCATION.Y=${location.y}`,
      "COLOR=8388608",
      "FONTID=1",
      `TEXT=${sanitizeField(childSheet.filename)}`,
    ],
    ...entries.map((entry) => [
      "RECORD=16",
      `OWNERINDEX=${altiumSymbolRecordIndex}`,
      "OWNERPARTID=-1",
      ...(entry.side === 1 ? ["SIDE=1"] : []),
      `DISTANCEFROMTOP=${entry.distanceFromTop}`,
      `COLOR=${ALTIUM_SCHEMATIC_COMPONENT_OUTLINE_COLOR}`,
      `AREACOLOR=${ALTIUM_SCHEMATIC_COMPONENT_FILL_COLOR}`,
      `TEXTCOLOR=${ALTIUM_SCHEMATIC_COMPONENT_OUTLINE_COLOR}`,
      "TEXTFONTID=1",
      "TEXTSTYLE=Full",
      `NAME=${sanitizeField(entry.name)}`,
      `IOTYPE=${entry.ioType}`,
      "ARROWKIND=Block & Triangle",
    ]),
  ]
}

export function createAltiumSchematicSheetSymbolRecordFields({
  location,
  plan,
}: {
  location: Point
  plan: AltiumSchematicSheetSymbolPlan
}): string[] {
  return [
    "RECORD=15",
    "OWNERPARTID=-1",
    `LOCATION.X=${location.x}`,
    `LOCATION.Y=${location.y}`,
    `XSIZE=${plan.width}`,
    `YSIZE=${plan.height}`,
    `COLOR=${ALTIUM_SCHEMATIC_COMPONENT_OUTLINE_COLOR}`,
    `AREACOLOR=${ALTIUM_SCHEMATIC_COMPONENT_FILL_COLOR}`,
    "ISSOLID=T",
    `UNIQUEID=${sanitizeField(plan.childSheet.schematicSheetId)}`,
    "SYMBOLTYPE=Normal",
  ]
}

function getAltiumSchematicSheetEntryDistanceFromTop({
  placementComponent,
  schematicPort,
  scale,
}: {
  placementComponent: CircuitElement
  schematicPort: CircuitElement
  scale: number
}): number {
  const componentCenter = asPoint(placementComponent.center)
  const portCenter = asPoint(schematicPort.center)
  const componentSize = isCircuitElement(placementComponent.size)
    ? placementComponent.size
    : undefined
  if (!componentCenter || !portCenter || !componentSize) return 0
  const componentTop = componentCenter.y + asNumber(componentSize.height) / 2
  const distance = (componentTop - portCenter.y) * 2
  return Math.max(scale === 1 ? Math.round(distance) : distance * scale, 0)
}

function getAltiumSchematicSheetEntrySide(
  schematicPort: CircuitElement,
): 0 | 1 {
  const facingDirection = asString(schematicPort.facing_direction)
  if (facingDirection === "right") return 1
  if (facingDirection === "left") return 0
  return schematicPort.has_output_arrow === true &&
    schematicPort.has_input_arrow !== true
    ? 1
    : 0
}
