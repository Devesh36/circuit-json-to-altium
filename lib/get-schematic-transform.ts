import type { Matrix } from "transformation-matrix"
import { applyToPoint, compose, scale, translate } from "transformation-matrix"
import { asNumber, asPoint, asString, isCircuitElement } from "./format"
import { isSchematicSheetAnnotation } from "./is-schematic-sheet-annotation"
import { isSchematicSymbolPrimitive } from "./is-schematic-symbol-primitive"
import type {
  AltiumSchematicSheetSettings,
  CircuitElement,
  LengthTransform,
  Point,
  PointTransform,
} from "./types"

type SchematicTransform = {
  circuitToAltiumSchematicLength: LengthTransform
  circuitToAltiumSchematicPoint: PointTransform
  circuitToAltiumSchematicPrecisePoint: PointTransform
  height: number
  width: number
}

type SchematicTransformOptions = {
  sheetSettings?: AltiumSchematicSheetSettings
  unitsPerCircuitUnit?: number
}

const MINIMUM_ALTIUM_SHEET_HEIGHT = 300
const MINIMUM_ALTIUM_SHEET_WIDTH = 400
const SCHEMATIC_CONTENT_MARGIN = 100

function getAltiumSchematicPoint(
  circuitPoint: Point,
  circuitToAltiumSchematicMatrix: Matrix,
): Point {
  const altiumPoint = applyToPoint(circuitToAltiumSchematicMatrix, circuitPoint)
  return { x: Math.round(altiumPoint.x), y: Math.round(altiumPoint.y) }
}

function appendSchematicSymbolPrimitivePoints({
  element,
  points,
}: {
  element: CircuitElement
  points: Point[]
}): void {
  if (element.type === "schematic_line") {
    points.push(
      { x: asNumber(element.x1), y: asNumber(element.y1) },
      { x: asNumber(element.x2), y: asNumber(element.y2) },
    )
    return
  }
  if (element.type === "schematic_path" && Array.isArray(element.points)) {
    for (const point of element.points) {
      const circuitPoint = asPoint(point)
      if (circuitPoint) points.push(circuitPoint)
    }
    return
  }
  const center = asPoint(element.center)
  if (!center) return
  if (element.type === "schematic_rect") {
    const width = asNumber(element.width)
    const height = asNumber(element.height)
    points.push(
      { x: center.x - width / 2, y: center.y - height / 2 },
      { x: center.x + width / 2, y: center.y + height / 2 },
    )
    return
  }
  if (element.type === "schematic_circle" || element.type === "schematic_arc") {
    const radius = asNumber(element.radius)
    const secondaryRadius =
      element.type === "schematic_arc"
        ? asNumber(element.altium_secondary_radius)
        : 0
    const radiusY = secondaryRadius > 0 ? secondaryRadius : radius
    points.push(
      { x: center.x - radius, y: center.y - radiusY },
      { x: center.x + radius, y: center.y + radiusY },
    )
    return
  }
}

export function getSchematicTransform(
  schematicElements: CircuitElement[],
  { sheetSettings, unitsPerCircuitUnit = 20 }: SchematicTransformOptions = {},
): SchematicTransform {
  const scaleRatio = unitsPerCircuitUnit / 20
  const circuitPoints: Point[] = []
  for (const element of schematicElements) {
    const center = asPoint(element.center)
    if (center) circuitPoints.push(center)
    if (
      isSchematicSymbolPrimitive(element) &&
      (asString(element.schematic_symbol_id) ||
        asString(element.schematic_component_id))
    ) {
      appendSchematicSymbolPrimitivePoints({
        element,
        points: circuitPoints,
      })
    }
    const anchor = asPoint(element.anchor_position)
    if (anchor) circuitPoints.push(anchor)
    const isSheetAnnotation = isSchematicSheetAnnotation(element)
    const position = isSheetAnnotation ? asPoint(element.position) : undefined
    if (position) circuitPoints.push(position)
    if (isSheetAnnotation && element.type === "schematic_rect") {
      const width = asNumber(element.width)
      const height = asNumber(element.height)
      if (center && width > 0 && height > 0) {
        circuitPoints.push(
          { x: center.x - width / 2, y: center.y - height / 2 },
          { x: center.x + width / 2, y: center.y + height / 2 },
        )
      }
    }
    if (
      isSheetAnnotation &&
      element.type === "schematic_path" &&
      Array.isArray(element.points)
    ) {
      for (const point of element.points) {
        const circuitPoint = asPoint(point)
        if (circuitPoint) circuitPoints.push(circuitPoint)
      }
    }
    if (element.type === "schematic_trace" && Array.isArray(element.edges)) {
      for (const edge of element.edges) {
        if (!isCircuitElement(edge)) continue
        const from = asPoint(edge.from)
        const to = asPoint(edge.to)
        if (from) circuitPoints.push(from)
        if (to) circuitPoints.push(to)
      }
    }
    if (
      element.type === "schematic_trace" &&
      Array.isArray(element.junctions)
    ) {
      for (const junction of element.junctions) {
        const circuitPoint = asPoint(junction)
        if (circuitPoint) circuitPoints.push(circuitPoint)
      }
    }
  }
  const minX =
    circuitPoints.length > 0
      ? Math.min(...circuitPoints.map((point) => point.x))
      : 0
  const minY =
    circuitPoints.length > 0
      ? Math.min(...circuitPoints.map((point) => point.y))
      : 0
  const maxX =
    circuitPoints.length > 0
      ? Math.max(...circuitPoints.map((point) => point.x))
      : 0
  const maxY =
    circuitPoints.length > 0
      ? Math.max(...circuitPoints.map((point) => point.y))
      : 0
  const altiumGridMinX =
    Math.round(minX * unitsPerCircuitUnit) / unitsPerCircuitUnit
  const altiumGridMinY =
    Math.round(minY * unitsPerCircuitUnit) / unitsPerCircuitUnit
  const altiumGridMaxX =
    Math.round(maxX * unitsPerCircuitUnit) / unitsPerCircuitUnit
  const altiumGridMaxY =
    Math.round(maxY * unitsPerCircuitUnit) / unitsPerCircuitUnit
  const altiumContentWidth =
    (altiumGridMaxX - altiumGridMinX) * unitsPerCircuitUnit
  const altiumContentHeight =
    (altiumGridMaxY - altiumGridMinY) * unitsPerCircuitUnit
  const sheetWidth = sheetSettings
    ? sheetSettings.width * unitsPerCircuitUnit
    : Math.max(
        MINIMUM_ALTIUM_SHEET_WIDTH * scaleRatio,
        altiumContentWidth + SCHEMATIC_CONTENT_MARGIN * 2 * scaleRatio,
      )
  const sheetHeight = sheetSettings
    ? sheetSettings.height * unitsPerCircuitUnit
    : Math.max(
        MINIMUM_ALTIUM_SHEET_HEIGHT * scaleRatio,
        altiumContentHeight + SCHEMATIC_CONTENT_MARGIN * 2 * scaleRatio,
      )
  const contentOffsetX = (sheetWidth - altiumContentWidth) / 2
  const contentOffsetY = (sheetHeight - altiumContentHeight) / 2
  const circuitToAltiumSchematicMatrix = sheetSettings?.circuitOrigin
    ? compose(
        translate(
          sheetSettings.circuitOrigin.x * unitsPerCircuitUnit,
          sheetSettings.circuitOrigin.y * unitsPerCircuitUnit,
        ),
        scale(unitsPerCircuitUnit, unitsPerCircuitUnit),
      )
    : compose(
        translate(contentOffsetX, contentOffsetY),
        scale(unitsPerCircuitUnit, unitsPerCircuitUnit),
        translate(-altiumGridMinX, -altiumGridMinY),
      )
  const altiumOrigin = applyToPoint(circuitToAltiumSchematicMatrix, {
    x: 0,
    y: 0,
  })

  return {
    circuitToAltiumSchematicLength: (circuitLength) => {
      const altiumLengthPoint = applyToPoint(circuitToAltiumSchematicMatrix, {
        x: circuitLength,
        y: 0,
      })
      return Math.abs(altiumLengthPoint.x - altiumOrigin.x)
    },
    circuitToAltiumSchematicPoint: (circuitPoint) =>
      getAltiumSchematicPoint(circuitPoint, circuitToAltiumSchematicMatrix),
    circuitToAltiumSchematicPrecisePoint: (circuitPoint) =>
      applyToPoint(circuitToAltiumSchematicMatrix, circuitPoint),
    width: sheetWidth,
    height: sheetHeight,
  }
}
