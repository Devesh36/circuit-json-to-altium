import { getAltiumColorFromCss } from "./altium-color"
import { ALTIUM_SCHEMATIC_GRAPHIC_COLOR } from "./altium-schematic-colors"
import { ALTIUM_SCHEMATIC_HAIRLINE_WIDTH } from "./altium-schematic-line-width"
import { createAltiumSchematicCoordinateFields } from "./create-altium-schematic-coordinate-fields"
import {
  SCHEMATIC_PIN_NAME_FONT_SIZE_CIRCUIT_UNITS,
  SCHEMATIC_PIN_NUMBER_FONT_SIZE_CIRCUIT_UNITS,
} from "./create-altium-schematic-font-table"
import { createOwnedSchematicRecordFields } from "./create-altium-schematic-graphic-record-fields"
import type { AltiumSchematicSymbolRecords } from "./create-altium-schematic-symbol-records"
import { createSchematicPinMarkerRecords } from "./create-schematic-pin-marker-records"
import { findSchematicComponentText } from "./find-schematic-component-text"
import {
  asNumber,
  asPoint,
  asPositiveNumber,
  asString,
  sanitizeField,
} from "./format"
import { addSchematicRecord } from "./schematic-document-records"
import type { SchematicDocumentContext } from "./schematic-document-types"
import type { CircuitElement, Point } from "./types"

const ALTIUM_PIN_STANDARD_FLAGS = 0x20
const ALTIUM_PIN_NAME_VISIBLE_FLAG = 0x08
const ALTIUM_PIN_DESIGNATOR_VISIBLE_FLAG = 0x10
const ALTIUM_PIN_CUSTOM_FONT_FLAG = 0x10
const ALTIUM_PIN_CUSTOM_POSITION_FLAG = 0x01
const SCHEMATIC_PIN_NAME_INSET_CIRCUIT_UNITS = 0.1
const SCHEMATIC_PIN_NUMBER_MARGIN_CIRCUIT_UNITS = 0.15
const DEFAULT_PIN_OUTWARD_DIRECTION: Point = { x: -1, y: 0 }
const PIN_OUTWARD_DIRECTION_BY_FACING_DIRECTION: Record<string, Point> = {
  left: DEFAULT_PIN_OUTWARD_DIRECTION,
  right: { x: 1, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
}
const ALTIUM_PIN_ORIENTATION_BY_FACING_DIRECTION: Record<string, number> = {
  left: 2,
  right: 0,
  up: 1,
  down: 3,
}

type AppendSchematicComponentPinOptions = {
  altiumComponentRecordIndex: number
  componentGraphicTexts: CircuitElement[]
  hasCustomSymbolPrimitives: boolean
  hasExplicitComponentTextPresentation: boolean
  pinIndex: number
  schematicPort: CircuitElement
  schematicSymbolRecords: AltiumSchematicSymbolRecords | undefined
}

function getBoxedSchematicPinLocation(
  {
    circuitPinTerminal,
    distanceFromComponentEdge,
    facingDirection,
  }: {
    circuitPinTerminal: Point
    distanceFromComponentEdge: number
    facingDirection: string
  },
  context: SchematicDocumentContext,
): Point {
  const outwardDirection =
    PIN_OUTWARD_DIRECTION_BY_FACING_DIRECTION[facingDirection] ??
    DEFAULT_PIN_OUTWARD_DIRECTION
  return context.circuitToAltiumSchematicPoint({
    x: circuitPinTerminal.x - outwardDirection.x * distanceFromComponentEdge,
    y: circuitPinTerminal.y - outwardDirection.y * distanceFromComponentEdge,
  })
}

export function appendSchematicComponentPinRecords(
  {
    altiumComponentRecordIndex,
    componentGraphicTexts,
    hasCustomSymbolPrimitives,
    hasExplicitComponentTextPresentation,
    pinIndex,
    schematicPort,
    schematicSymbolRecords,
  }: AppendSchematicComponentPinOptions,
  context: SchematicDocumentContext,
): void {
  const sourcePort = context.sourcePorts.get(
    asString(schematicPort.source_port_id),
  )
  const circuitPinTerminal = asPoint(schematicPort.center) ?? { x: 0, y: 0 }
  const facingDirection = asString(schematicPort.facing_direction)
  const boxedSchematicPinLocation = getBoxedSchematicPinLocation(
    {
      circuitPinTerminal,
      distanceFromComponentEdge: Math.max(
        asNumber(schematicPort.distance_from_component_edge),
        0,
      ),
      facingDirection,
    },
    context,
  )
  const altiumPinOrientation =
    ALTIUM_PIN_ORIENTATION_BY_FACING_DIRECTION[facingDirection] ?? 2
  const isPinTextVisibleByDefault =
    !schematicSymbolRecords && !hasCustomSymbolPrimitives
  const pinName =
    sanitizeField(schematicPort.display_pin_label) ||
    sanitizeField(sourcePort?.name) ||
    `Pin ${pinIndex + 1}`
  const pinDesignator =
    sanitizeField(sourcePort?.pin_number) || `${pinIndex + 1}`
  const pinGeometryLabels = [
    asString(schematicPort.display_pin_label),
    asString(sourcePort?.name),
    ...(Array.isArray(sourcePort?.port_hints)
      ? sourcePort.port_hints.flatMap((portHint) =>
          typeof portHint === "string" ? [portHint] : [],
        )
      : []),
    pinDesignator,
  ]
  const altiumPinTerminal =
    context.circuitToAltiumSchematicPoint(circuitPinTerminal)
  const builtinPinGeometry =
    schematicSymbolRecords?.pinGeometryByTerminal.get(
      `${altiumPinTerminal.x}:${altiumPinTerminal.y}`,
    ) ??
    pinGeometryLabels
      .map((label) => schematicSymbolRecords?.pinGeometryByLabel.get(label))
      .find((pinGeometry) => pinGeometry !== undefined)
  const altiumPinLocation =
    builtinPinGeometry?.location ??
    (schematicSymbolRecords
      ? context.circuitToAltiumSchematicPoint(circuitPinTerminal)
      : boxedSchematicPinLocation)
  const pinNameText =
    typeof schematicPort.display_pin_label === "string"
      ? findSchematicComponentText({
          componentTexts: componentGraphicTexts,
          excludedText: undefined,
          renderedText: pinName,
        })
      : undefined
  const pinNumberText =
    typeof schematicPort.pin_number === "number"
      ? findSchematicComponentText({
          componentTexts: componentGraphicTexts,
          excludedText: pinNameText,
          renderedText: pinDesignator,
        })
      : undefined
  const hasVisibleCustomPinName =
    hasCustomSymbolPrimitives &&
    typeof schematicPort.display_pin_label === "string"
  const hasVisibleRegularPinName =
    !hasCustomSymbolPrimitives &&
    (hasExplicitComponentTextPresentation
      ? typeof schematicPort.display_pin_label === "string"
      : isPinTextVisibleByDefault)
  const isPinNameVisible =
    pinNameText === undefined &&
    (hasVisibleCustomPinName || hasVisibleRegularPinName)
  const isPinNumberVisible =
    pinNumberText === undefined &&
    !hasCustomSymbolPrimitives &&
    (hasExplicitComponentTextPresentation
      ? typeof schematicPort.pin_number === "number"
      : isPinTextVisibleByDefault)
  const altiumPinTextVisibilityFlags =
    (isPinNameVisible ? ALTIUM_PIN_NAME_VISIBLE_FLAG : 0) |
    (isPinNumberVisible ? ALTIUM_PIN_DESIGNATOR_VISIBLE_FLAG : 0)
  const altiumPinConglomerate =
    ALTIUM_PIN_STANDARD_FLAGS |
    altiumPinTextVisibilityFlags |
    altiumPinOrientation
  const explicitPinText = pinNameText ?? pinNumberText
  const pinColor = getAltiumColorFromCss({
    cssColor: asString(explicitPinText?.color),
    fallbackAltiumColor: ALTIUM_SCHEMATIC_GRAPHIC_COLOR,
  })
  const pinNameFontId =
    context.nativeTextFontTable.fontIdBySizeCircuitUnits.get(
      asPositiveNumber(
        schematicPort.display_pin_label_font_size,
        SCHEMATIC_PIN_NAME_FONT_SIZE_CIRCUIT_UNITS,
      ),
    )!
  const pinNumberFontId =
    context.nativeTextFontTable.fontIdBySizeCircuitUnits.get(
      SCHEMATIC_PIN_NUMBER_FONT_SIZE_CIRCUIT_UNITS,
    )!
  const pinMarkers = createSchematicPinMarkerRecords({
    body: altiumPinLocation,
    orientation: altiumPinOrientation,
    hasInversionCircle: schematicPort.is_drawn_with_inversion_circle === true,
    hasInputArrow: schematicPort.has_input_arrow === true,
    hasOutputArrow: schematicPort.has_output_arrow === true,
    ownerIndex: altiumComponentRecordIndex,
    color: pinColor,
    toAltiumLength: context.circuitToAltiumSchematicLength,
  })
  for (const recordFields of pinMarkers.records) {
    addSchematicRecord(recordFields, context.recordContext)
  }
  const outwardDirection =
    PIN_OUTWARD_DIRECTION_BY_FACING_DIRECTION[facingDirection] ??
    DEFAULT_PIN_OUTWARD_DIRECTION
  const pinBodyOffset =
    (altiumPinTerminal.x - altiumPinLocation.x) * outwardDirection.x +
    (altiumPinTerminal.y - altiumPinLocation.y) * outwardDirection.y
  const nameInset = context.circuitToAltiumSchematicLength(
    SCHEMATIC_PIN_NAME_INSET_CIRCUIT_UNITS,
  )
  const numberMargin = context.circuitToAltiumSchematicLength(
    SCHEMATIC_PIN_NUMBER_MARGIN_CIRCUIT_UNITS,
  )
  addSchematicRecord(
    [
      "RECORD=2",
      `OWNERINDEX=${altiumComponentRecordIndex}`,
      "OWNERPARTID=1",
      `DESIGNATOR=${pinDesignator}`,
      `NAME=${pinName}`,
      `PINCONGLOMERATE=${altiumPinConglomerate}`,
      ...createAltiumSchematicCoordinateFields(
        "LOCATION.X",
        altiumPinTerminal.x,
      ),
      ...createAltiumSchematicCoordinateFields(
        "LOCATION.Y",
        altiumPinTerminal.y,
      ),
      "PINLENGTH=0",
      `SYMBOL_LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
      "ELECTRICAL=4",
      `COLOR=${pinColor}`,
      `PINNAME_POSITIONCONGLOMERATE=${ALTIUM_PIN_CUSTOM_FONT_FLAG | ALTIUM_PIN_CUSTOM_POSITION_FLAG}`,
      ...createAltiumSchematicCoordinateFields(
        "NAME_CUSTOMPOSITION_MARGIN",
        nameInset - 2 + pinBodyOffset,
      ),
      `NAME_CUSTOMFONTID=${pinNameFontId}`,
      `NAME_CUSTOMCOLOR=${pinColor}`,
      `PINDESIGNATOR_POSITIONCONGLOMERATE=${ALTIUM_PIN_CUSTOM_FONT_FLAG | ALTIUM_PIN_CUSTOM_POSITION_FLAG}`,
      ...createAltiumSchematicCoordinateFields(
        "DESIGNATOR_CUSTOMPOSITION_MARGIN",
        numberMargin - pinBodyOffset,
      ),
      `DESIGNATOR_CUSTOMFONTID=${pinNumberFontId}`,
      `DESIGNATOR_CUSTOMCOLOR=${pinColor}`,
    ],
    context.recordContext,
  )
  if (
    pinMarkers.stemStart.x === altiumPinTerminal.x &&
    pinMarkers.stemStart.y === altiumPinTerminal.y
  ) {
    return
  }
  addSchematicRecord(
    [
      "RECORD=13",
      ...createOwnedSchematicRecordFields(altiumComponentRecordIndex),
      ...createAltiumSchematicCoordinateFields(
        "LOCATION.X",
        pinMarkers.stemStart.x,
      ),
      ...createAltiumSchematicCoordinateFields(
        "LOCATION.Y",
        pinMarkers.stemStart.y,
      ),
      ...createAltiumSchematicCoordinateFields("CORNER.X", altiumPinTerminal.x),
      ...createAltiumSchematicCoordinateFields("CORNER.Y", altiumPinTerminal.y),
      `COLOR=${pinColor}`,
      `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
    ],
    context.recordContext,
  )
}
