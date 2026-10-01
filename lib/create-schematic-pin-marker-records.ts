import { ALTIUM_SCHEMATIC_WHITE } from "./altium-schematic-colors"
import { ALTIUM_SCHEMATIC_HAIRLINE_WIDTH } from "./altium-schematic-line-width"
import { createAltiumSchematicCoordinateFields as coordinates } from "./create-altium-schematic-coordinate-fields"
import { createOwnedSchematicRecordFields } from "./create-altium-schematic-graphic-record-fields"
import type { LengthTransform, Point } from "./types"

// Match circuit-to-svg's inversion bubble radius, in Circuit JSON units.
export const SCHEMATIC_PIN_INVERSION_RADIUS = 0.06
export const SCHEMATIC_PIN_ARROW_SIZE = 0.1

type PinMarkerFrame = { body: Point; dx: number; dy: number }

type PinArrowContext = {
  frame: PinMarkerFrame
  records: string[][]
  arrowHalfWidth: number
  ownerIndex: number
  color: number
}

function getPinMarkerPoint({
  frame: { body, dx, dy },
  along,
  across = 0,
}: {
  frame: PinMarkerFrame
  along: number
  across?: number
}): Point {
  return {
    x: body.x + dx * along - dy * across,
    y: body.y + dy * along + dx * across,
  }
}

function addArrow({
  context: { frame, records, arrowHalfWidth, ownerIndex, color },
  tip,
  base,
}: {
  context: PinArrowContext
  tip: number
  base: number
}): void {
  const points = [
    getPinMarkerPoint({ frame, along: tip }),
    getPinMarkerPoint({ frame, along: base, across: arrowHalfWidth }),
    getPinMarkerPoint({ frame, along: base, across: -arrowHalfWidth }),
  ]
  records.push([
    "RECORD=7",
    ...createOwnedSchematicRecordFields(ownerIndex),
    "LOCATIONCOUNT=3",
    ...points.flatMap((p, i) => [
      ...coordinates(`X${i + 1}`, p.x),
      ...coordinates(`Y${i + 1}`, p.y),
    ]),
    `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
    `COLOR=${color}`,
    `AREACOLOR=${ALTIUM_SCHEMATIC_WHITE}`,
    "ISSOLID=T",
  ])
}

export function createSchematicPinMarkerRecords({
  body,
  orientation,
  hasInversionCircle,
  hasInputArrow,
  hasOutputArrow,
  ownerIndex,
  color,
  toAltiumLength,
}: {
  body: Point
  orientation: number
  hasInversionCircle: boolean
  hasInputArrow: boolean
  hasOutputArrow: boolean
  ownerIndex: number
  color: number
  toAltiumLength: LengthTransform
}): { records: string[][]; stemStart: Point } {
  const dx = [1, 0, -1, 0][orientation & 3]!
  const dy = [0, 1, 0, -1][orientation & 3]!
  const radius = hasInversionCircle
    ? toAltiumLength(SCHEMATIC_PIN_INVERSION_RADIUS)
    : 0
  const frame: PinMarkerFrame = { body, dx, dy }
  const records = hasInversionCircle
    ? [
        [
          "RECORD=8",
          ...createOwnedSchematicRecordFields(ownerIndex),
          ...coordinates("LOCATION.X", body.x + dx * radius),
          ...coordinates("LOCATION.Y", body.y + dy * radius),
          ...coordinates("RADIUS", radius),
          ...coordinates("SECONDARYRADIUS", radius),
          `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
          `COLOR=${color}`,
          `AREACOLOR=${ALTIUM_SCHEMATIC_WHITE}`,
          "ISSOLID=T",
        ],
      ]
    : []
  const arrowSize = toAltiumLength(SCHEMATIC_PIN_ARROW_SIZE)
  const arrowDepth = arrowSize * Math.cos(Math.PI / 6)
  const arrowHalfWidth = arrowSize * Math.sin(Math.PI / 6)
  const bubbleEnd = radius * 2
  const arrowContext: PinArrowContext = {
    frame,
    records,
    arrowHalfWidth,
    ownerIndex,
    color,
  }
  if (hasInputArrow) {
    addArrow({
      context: arrowContext,
      tip: bubbleEnd,
      base: bubbleEnd + arrowDepth,
    })
  }
  // Circuit JSON places an output arrow one arrow-size beyond its base
  // origin; bidirectional pins put that origin after the input arrow.
  const outputTip = bubbleEnd + (hasInputArrow ? arrowDepth : 0) + arrowSize
  if (hasOutputArrow) {
    // Draw only the exposed gap; the wire must not cross a filled triangle.
    const gapStart = getPinMarkerPoint({
      frame,
      along: bubbleEnd + (hasInputArrow ? arrowDepth : 0),
    })
    const gapEnd = getPinMarkerPoint({
      frame,
      along: outputTip - arrowDepth,
    })
    records.push([
      "RECORD=13",
      ...createOwnedSchematicRecordFields(ownerIndex),
      ...coordinates("LOCATION.X", gapStart.x),
      ...coordinates("LOCATION.Y", gapStart.y),
      ...coordinates("CORNER.X", gapEnd.x),
      ...coordinates("CORNER.Y", gapEnd.y),
      `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
      `COLOR=${color}`,
    ])
    addArrow({
      context: arrowContext,
      tip: outputTip,
      base: outputTip - arrowDepth,
    })
  }
  // The stem starts outside the filled markers, keeping their interiors clear.
  const bodyOffset = hasOutputArrow
    ? outputTip
    : bubbleEnd + (hasInputArrow ? arrowDepth : 0)
  return {
    records,
    stemStart: {
      x: body.x + dx * bodyOffset,
      y: body.y + dy * bodyOffset,
    },
  }
}
