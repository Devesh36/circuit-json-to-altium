import { getAltiumColorFromCss } from "./altium-color"
import {
  ALTIUM_SCHEMATIC_GRAPHIC_COLOR,
  ALTIUM_SCHEMATIC_SHEET_AREA_COLOR,
} from "./altium-schematic-colors"
import { ALTIUM_SCHEMATIC_HAIRLINE_WIDTH } from "./altium-schematic-line-width"
import { createAltiumSchematicCoordinateFields } from "./create-altium-schematic-coordinate-fields"
import {
  type AltiumSchematicFontTable,
  SCHEMATIC_NET_LABEL_FONT_SIZE_CIRCUIT_UNITS,
} from "./create-altium-schematic-font-table"
import { getHairlinePowerPortDefinitionId } from "./create-hairline-power-port-definitions"
import { estimateAltiumSchematicLabelTextWidth } from "./estimate-altium-schematic-label-text-width"
import { asNumber, asString, pointsEqual } from "./format"
import {
  getAltiumSchematicTextJustification,
  getAltiumSchematicTextOrientation,
} from "./get-altium-schematic-text-presentation"
import type { CircuitElement, Point } from "./types"

type AltiumPowerPortDirection = "down" | "left" | "right" | "up"
type AltiumPowerPortSymbolFamily = "ground" | "rail"

type AltiumPowerPortStyle = {
  orientationIndex: number
  styleIndex: number
}

type SchematicNetLabelRecordFieldsInput = {
  anchorSide: string
  altiumLabelCenter: Point
  altiumLabelPosition: Point
  decorationIndex: number
  fontTable: AltiumSchematicFontTable
  labelText: string
  symbolName: string
  textPresentation: CircuitElement | undefined
}

const ALTIUM_SCHEMATIC_POWER_PORT_FONT_ID = 2
const ALTIUM_SCHEMATIC_POWER_PORT_COLOR_INDEX = 132
const ALTIUM_SCHEMATIC_NET_LABEL_MINIMUM_WIDTH = 10

type NetLabelAnchorSide = "bottom" | "left" | "right" | "top"

type NetLabelDisplayGeometry = {
  orientation: number
  outlinePoints: Point[]
  textJustification: number
  textPosition: Point
}

type NetLabelPointContext = {
  direction: Point
  origin: Point
  perpendicular: Point
}

function getNetLabelPoint(
  { along, across = 0 }: { along: number; across?: number },
  context: NetLabelPointContext,
): Point {
  return {
    x:
      context.origin.x +
      context.direction.x * along +
      context.perpendicular.x * across,
    y:
      context.origin.y +
      context.direction.y * along +
      context.perpendicular.y * across,
  }
}

const NET_LABEL_GROWTH_DIRECTION_BY_ANCHOR_SIDE: Record<
  NetLabelAnchorSide,
  Point
> = {
  bottom: { x: 0, y: 1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  top: { x: 0, y: -1 },
}

const NET_LABEL_TEXT_PRESENTATION_BY_ANCHOR_SIDE: Record<
  NetLabelAnchorSide,
  { justification: number; orientation: number }
> = {
  bottom: { justification: 3, orientation: 1 },
  left: { justification: 3, orientation: 0 },
  right: { justification: 5, orientation: 0 },
  top: { justification: 5, orientation: 1 },
}

const ALTIUM_JUSTIFICATION_BY_NET_LABEL_ANCHOR_SIDE: Record<string, number> = {
  bottom: 1,
  left: 3,
  right: 5,
  top: 7,
}

const ALTIUM_ORIENTATION_INDEX_BY_POWER_PORT_DIRECTION: Record<
  AltiumPowerPortDirection,
  number
> = {
  right: 0,
  up: 1,
  left: 2,
  down: 3,
}

const ALTIUM_STYLE_INDEX_BY_POWER_PORT_SYMBOL_FAMILY: Record<
  AltiumPowerPortSymbolFamily,
  number
> = {
  rail: 2,
  ground: 4,
}

function isAltiumPowerPortDirection(
  direction: string,
): direction is AltiumPowerPortDirection {
  return direction in ALTIUM_ORIENTATION_INDEX_BY_POWER_PORT_DIRECTION
}

function isAltiumPowerPortSymbolFamily(
  symbolFamily: string,
): symbolFamily is AltiumPowerPortSymbolFamily {
  return symbolFamily in ALTIUM_STYLE_INDEX_BY_POWER_PORT_SYMBOL_FAMILY
}

function isNetLabelAnchorSide(
  anchorSide: string,
): anchorSide is NetLabelAnchorSide {
  return anchorSide in NET_LABEL_GROWTH_DIRECTION_BY_ANCHOR_SIDE
}

function getNetLabelDecorationUniqueId(
  decorationIndex: number,
  decorationKind: "P" | "T" | "W",
): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXY"
  let remainingIndex = Math.max(Math.floor(decorationIndex), 0)
  let encodedIndex = ""
  for (let digitIndex = 0; digitIndex < 4; digitIndex++) {
    encodedIndex = alphabet[remainingIndex % alphabet.length] + encodedIndex
    remainingIndex = Math.floor(remainingIndex / alphabet.length)
  }
  return `CJN${decorationKind}${encodedIndex}`
}

function getNetLabelDisplayGeometry({
  altiumLabelCenter,
  altiumLabelPosition,
  anchorSide,
  fontSize,
  textFontSize,
  scale,
  labelText,
}: Pick<
  SchematicNetLabelRecordFieldsInput,
  "altiumLabelCenter" | "altiumLabelPosition" | "anchorSide" | "labelText"
> & { fontSize: number; textFontSize: number; scale: number }):
  | NetLabelDisplayGeometry
  | undefined {
  if (!isNetLabelAnchorSide(anchorSide)) return undefined

  const direction = NET_LABEL_GROWTH_DIRECTION_BY_ANCHOR_SIDE[anchorSide]
  const centerOffset = {
    x: altiumLabelCenter.x - altiumLabelPosition.x,
    y: altiumLabelCenter.y - altiumLabelPosition.y,
  }
  const projectedHalfWidth =
    centerOffset.x * direction.x + centerOffset.y * direction.y
  const pointDepth = fontSize * 0.3
  const textInset = fontSize * 0.5
  const endPadding = fontSize * 0.2
  const textWidth = estimateAltiumSchematicLabelTextWidth(
    labelText,
    textFontSize,
  )
  const width = Math.max(
    projectedHalfWidth * 2,
    textInset + textWidth + endPadding,
    ALTIUM_SCHEMATIC_NET_LABEL_MINIMUM_WIDTH * scale,
  )
  const perpendicular = { x: -direction.y, y: direction.x }
  const netLabelPointContext = {
    direction,
    origin: altiumLabelPosition,
    perpendicular,
  }
  // Match Circuit JSON's 0.2-unit body around its 0.18-unit default font.
  // This keeps adjacent labels on a 0.2-unit pin pitch from overlapping.
  const halfHeight = (fontSize * (0.2 / 0.18)) / 2
  const textPresentation =
    NET_LABEL_TEXT_PRESENTATION_BY_ANCHOR_SIDE[anchorSide]

  return {
    orientation: textPresentation.orientation,
    outlinePoints: [
      getNetLabelPoint({ along: 0 }, netLabelPointContext),
      getNetLabelPoint(
        { along: pointDepth, across: halfHeight },
        netLabelPointContext,
      ),
      getNetLabelPoint(
        { along: width, across: halfHeight },
        netLabelPointContext,
      ),
      getNetLabelPoint(
        { along: width, across: -halfHeight },
        netLabelPointContext,
      ),
      getNetLabelPoint(
        { along: pointDepth, across: -halfHeight },
        netLabelPointContext,
      ),
    ],
    textJustification: textPresentation.justification,
    textPosition: getNetLabelPoint({ along: textInset }, netLabelPointContext),
  }
}

export function getAltiumPowerPortStyle(
  symbolName: string,
): AltiumPowerPortStyle | undefined {
  const directionSeparatorIndex = symbolName.lastIndexOf("_")
  if (directionSeparatorIndex < 1) return undefined
  const symbolFamily = symbolName.slice(0, directionSeparatorIndex)
  const direction = symbolName.slice(directionSeparatorIndex + 1)
  if (
    !isAltiumPowerPortSymbolFamily(symbolFamily) ||
    !isAltiumPowerPortDirection(direction)
  ) {
    return undefined
  }
  return {
    orientationIndex:
      ALTIUM_ORIENTATION_INDEX_BY_POWER_PORT_DIRECTION[direction],
    styleIndex: ALTIUM_STYLE_INDEX_BY_POWER_PORT_SYMBOL_FAMILY[symbolFamily],
  }
}

export function createAltiumSchematicNetLabelRecordFields({
  anchorSide,
  altiumLabelCenter,
  altiumLabelPosition,
  decorationIndex,
  fontTable,
  labelText,
  symbolName,
  textPresentation,
}: SchematicNetLabelRecordFieldsInput): string[][] {
  const powerPortStyle = getAltiumPowerPortStyle(symbolName)
  const sourceFontId =
    fontTable.fontIdBySizeCircuitUnits.get(
      asNumber(textPresentation?.font_size),
    ) ??
    (powerPortStyle
      ? ALTIUM_SCHEMATIC_POWER_PORT_FONT_ID
      : (fontTable.fontIdBySizeCircuitUnits.get(
          SCHEMATIC_NET_LABEL_FONT_SIZE_CIRCUIT_UNITS,
        ) ?? ALTIUM_SCHEMATIC_POWER_PORT_FONT_ID))
  const fontId = powerPortStyle
    ? sourceFontId
    : (fontTable.nativeTextFontIdBySizeCircuitUnits.get(
        asNumber(textPresentation?.font_size),
      ) ??
      fontTable.nativeTextFontIdBySizeCircuitUnits.get(
        SCHEMATIC_NET_LABEL_FONT_SIZE_CIRCUIT_UNITS,
      ) ??
      sourceFontId)
  const color = getAltiumColorFromCss({
    cssColor: asString(textPresentation?.color),
    fallbackAltiumColor: powerPortStyle
      ? ALTIUM_SCHEMATIC_POWER_PORT_COLOR_INDEX
      : ALTIUM_SCHEMATIC_GRAPHIC_COLOR,
  })
  if (powerPortStyle) {
    return [
      [
        "RECORD=17",
        `LOCATION.X=${altiumLabelPosition.x}`,
        `LOCATION.Y=${altiumLabelPosition.y}`,
        `FONTID=${fontId}`,
        `ORIENTATION=${powerPortStyle.orientationIndex}`,
        `STYLE=${powerPortStyle.styleIndex}`,
        `ObjectDefinitionId=${getHairlinePowerPortDefinitionId(powerPortStyle.styleIndex, color)}`,
        `COLOR=${color}`,
        "SHOWNETNAME=T",
        `TEXT=${labelText}`,
      ],
    ]
  }

  const nativeNetLabelFields = [
    "RECORD=25",
    `LOCATION.X=${altiumLabelPosition.x}`,
    `LOCATION.Y=${altiumLabelPosition.y}`,
    `FONTID=${fontId}`,
    `ORIENTATION=${getAltiumSchematicTextOrientation(asNumber(textPresentation?.rotation))}`,
    `JUSTIFICATION=${
      textPresentation
        ? getAltiumSchematicTextJustification(asString(textPresentation.anchor))
        : (ALTIUM_JUSTIFICATION_BY_NET_LABEL_ANCHOR_SIDE[anchorSide] ?? 0)
    }`,
    `COLOR=${color}`,
    `TEXT=${labelText}`,
  ]
  // Imported inline labels carry their original text presentation at the
  // electrical anchor, without a separate pointed body. Keep that placement
  // and rotation so the text stays beside the wire instead of across it.
  if (textPresentation && pointsEqual(altiumLabelCenter, altiumLabelPosition)) {
    return [nativeNetLabelFields]
  }
  const displayGeometry = getNetLabelDisplayGeometry({
    altiumLabelCenter,
    altiumLabelPosition,
    anchorSide,
    scale: (fontTable.unitsPerCircuitUnit ?? 20) / 20,
    // Keep the source height and inset; fit the width to the native font.
    fontSize: fontTable.fontSizePointsById.get(sourceFontId) ?? 4,
    textFontSize: fontTable.fontSizePointsById.get(fontId) ?? 4,
    labelText,
  })
  if (!displayGeometry) return [nativeNetLabelFields]

  // Net labels stay visible in native Altium, even with ISHIDDEN. Place one
  // label inside the outline and connect its hotspot to the original anchor.
  // The filled outline covers this short internal wire segment.
  return [
    [
      "RECORD=27",
      `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
      "LOCATIONCOUNT=2",
      ...createAltiumSchematicCoordinateFields("X1", altiumLabelPosition.x),
      ...createAltiumSchematicCoordinateFields("Y1", altiumLabelPosition.y),
      ...createAltiumSchematicCoordinateFields(
        "X2",
        displayGeometry.textPosition.x,
      ),
      ...createAltiumSchematicCoordinateFields(
        "Y2",
        displayGeometry.textPosition.y,
      ),
      "COLOR=34816",
      `UNIQUEID=${getNetLabelDecorationUniqueId(decorationIndex, "W")}`,
    ],
    [
      "RECORD=7",
      "OWNERPARTID=-1",
      `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
      `LOCATIONCOUNT=${displayGeometry.outlinePoints.length}`,
      ...displayGeometry.outlinePoints.flatMap((point, pointIndex) => [
        ...createAltiumSchematicCoordinateFields(`X${pointIndex + 1}`, point.x),
        ...createAltiumSchematicCoordinateFields(`Y${pointIndex + 1}`, point.y),
      ]),
      `COLOR=${color}`,
      `AREACOLOR=${ALTIUM_SCHEMATIC_SHEET_AREA_COLOR}`,
      "ISSOLID=T",
      `UNIQUEID=${getNetLabelDecorationUniqueId(decorationIndex, "P")}`,
    ],
    [
      "RECORD=25",
      ...createAltiumSchematicCoordinateFields(
        "LOCATION.X",
        displayGeometry.textPosition.x,
      ),
      ...createAltiumSchematicCoordinateFields(
        "LOCATION.Y",
        displayGeometry.textPosition.y,
      ),
      `FONTID=${fontId}`,
      `ORIENTATION=${displayGeometry.orientation}`,
      `JUSTIFICATION=${displayGeometry.textJustification}`,
      `COLOR=${color}`,
      `TEXT=${labelText}`,
      `UNIQUEID=${getNetLabelDecorationUniqueId(decorationIndex, "T")}`,
    ],
  ]
}
