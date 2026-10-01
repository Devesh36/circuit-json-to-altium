import {
  appendDistinctPoint,
  PCB_CUTOUT_GEOMETRY_EPSILON,
} from "./pcb-cutout-geometry"
import type { Point } from "./types"

function getPointAtPolylineDistance({
  cumulativeLengths,
  distance,
  points,
}: {
  cumulativeLengths: number[]
  distance: number
  points: Point[]
}): Point | undefined {
  for (let index = 1; index < cumulativeLengths.length; index++) {
    const segmentStartDistance = cumulativeLengths[index - 1]
    const segmentEndDistance = cumulativeLengths[index]
    const segmentStart = points[index - 1]
    const segmentEnd = points[index]
    if (
      segmentStartDistance === undefined ||
      segmentEndDistance === undefined ||
      !segmentStart ||
      !segmentEnd ||
      distance > segmentEndDistance + PCB_CUTOUT_GEOMETRY_EPSILON
    ) {
      continue
    }
    const segmentLength = segmentEndDistance - segmentStartDistance
    if (segmentLength <= PCB_CUTOUT_GEOMETRY_EPSILON) continue
    const ratio = Math.min(
      Math.max((distance - segmentStartDistance) / segmentLength, 0),
      1,
    )
    return {
      x: segmentStart.x + (segmentEnd.x - segmentStart.x) * ratio,
      y: segmentStart.y + (segmentEnd.y - segmentStart.y) * ratio,
    }
  }
  return points.at(-1)
}

export function splitPcbCutoutPathIntoDashes({
  dashLength,
  gapLength,
  points,
}: {
  dashLength: number
  gapLength: number
  points: Point[]
}): Point[][] {
  const cumulativeLengths = [0]
  for (let index = 1; index < points.length; index++) {
    const previousPoint = points[index - 1]
    const point = points[index]
    const previousDistance = cumulativeLengths[index - 1]
    if (!previousPoint || !point || previousDistance === undefined) continue
    cumulativeLengths.push(
      previousDistance +
        Math.hypot(point.x - previousPoint.x, point.y - previousPoint.y),
    )
  }
  const totalLength = cumulativeLengths.at(-1) ?? 0
  const period = dashLength + gapLength
  const dashes: Point[][] = []
  for (
    let dashStart = 0;
    dashStart < totalLength - PCB_CUTOUT_GEOMETRY_EPSILON;
    dashStart += period
  ) {
    const dashEnd = Math.min(dashStart + dashLength, totalLength)
    const dash: Point[] = []
    const startPoint = getPointAtPolylineDistance({
      cumulativeLengths,
      distance: dashStart,
      points,
    })
    const endPoint = getPointAtPolylineDistance({
      cumulativeLengths,
      distance: dashEnd,
      points,
    })
    if (!startPoint || !endPoint) continue
    dash.push(startPoint)
    for (let index = 1; index < points.length - 1; index++) {
      const pointDistance = cumulativeLengths[index]
      const point = points[index]
      if (
        point &&
        pointDistance !== undefined &&
        pointDistance > dashStart + PCB_CUTOUT_GEOMETRY_EPSILON &&
        pointDistance < dashEnd - PCB_CUTOUT_GEOMETRY_EPSILON
      ) {
        dash.push(point)
      }
    }
    appendDistinctPoint(dash, endPoint)
    if (dash.length >= 2) dashes.push(dash)
  }
  return dashes
}
