import type { Point, PointTransform } from "./types"

export type AltiumSchematicBoxBounds = {
  bottom: number
  left: number
  right: number
  top: number
}

export function getFallbackSchematicBoxBounds({
  circuitComponentCenter,
  circuitComponentHeight,
  circuitComponentWidth,
  circuitToAltiumSchematicPoint,
}: {
  circuitComponentCenter: Point
  circuitComponentHeight: number
  circuitComponentWidth: number
  circuitToAltiumSchematicPoint: PointTransform
}): AltiumSchematicBoxBounds {
  const firstCorner = circuitToAltiumSchematicPoint({
    x: circuitComponentCenter.x - circuitComponentWidth / 2,
    y: circuitComponentCenter.y - circuitComponentHeight / 2,
  })
  const oppositeCorner = circuitToAltiumSchematicPoint({
    x: circuitComponentCenter.x + circuitComponentWidth / 2,
    y: circuitComponentCenter.y + circuitComponentHeight / 2,
  })
  return {
    bottom: Math.min(firstCorner.y, oppositeCorner.y),
    left: Math.min(firstCorner.x, oppositeCorner.x),
    right: Math.max(firstCorner.x, oppositeCorner.x),
    top: Math.max(firstCorner.y, oppositeCorner.y),
  }
}
