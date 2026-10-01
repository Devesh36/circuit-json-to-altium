import type { PcbCutout } from "circuit-json"
import { createRoundedRectPoints } from "./create-pcb-annotation-primitives"
import { getPolygonArea, pointsEqual } from "./format"
import {
  addPoints,
  appendDistinctPoint,
  getLineIntersection,
  getUnitDirection,
  leftNormal,
  PCB_CUTOUT_GEOMETRY_EPSILON,
  removeConsecutiveDuplicatePoints,
  scalePoint,
} from "./pcb-cutout-geometry"
import type { PcbCutoutRegion } from "./pcb-cutout-types"
import { splitPcbCutoutPathIntoDashes } from "./split-pcb-cutout-path-into-dashes"
import type { Point } from "./types"

const MAXIMUM_MITER_RATIO = 4
const ROUNDED_CORNER_SEGMENTS = 8

export function getPcbPathCutoutRegions(
  cutout: Extract<PcbCutout, { shape: "path" }>,
): PcbCutoutRegion[] {
  const route = removeConsecutiveDuplicatePoints(cutout.route)
  const firstPoint = route[0]
  const lastPoint = route.at(-1)
  const isClosed =
    route.length >= 3 &&
    firstPoint !== undefined &&
    lastPoint !== undefined &&
    pointsEqual(firstPoint, lastPoint)
  if (isClosed) route.pop()
  if (route.length === 0) return []

  const halfWidthMm = cutout.slot_width / 2
  const cornerRadiusMm = Math.min(
    Math.max(cutout.slot_corner_radius ?? halfWidthMm, 0),
    halfWidthMm,
  )
  if (route.length === 1) {
    const center = route[0]
    if (!center) return []
    return [
      {
        outerRing: createRoundedRectPoints({
          center,
          cornerRadiusMm,
          heightMm: cutout.slot_width,
          widthMm: cutout.slot_width,
        }),
      },
    ]
  }

  const dashLength = cutout.slot_length
  const gapLength = cutout.space_between_slots
  const hasDashedSlots =
    dashLength !== undefined &&
    dashLength > PCB_CUTOUT_GEOMETRY_EPSILON &&
    gapLength !== undefined &&
    gapLength > PCB_CUTOUT_GEOMETRY_EPSILON
  if (hasDashedSlots) {
    const pathStart = route[0]
    if (!pathStart) return []
    const path = isClosed ? [...route, pathStart] : route
    return splitPcbCutoutPathIntoDashes({
      dashLength,
      gapLength,
      points: path,
    }).flatMap((dash) =>
      getOpenStrokeRegion({
        cornerRadiusMm,
        halfWidthMm,
        points: dash,
      }),
    )
  }

  if (isClosed) {
    return getClosedStrokeRegion({ halfWidthMm, points: route })
  }
  return getOpenStrokeRegion({ cornerRadiusMm, halfWidthMm, points: route })
}

function getOpenStrokeRegion({
  cornerRadiusMm,
  halfWidthMm,
  points,
}: {
  cornerRadiusMm: number
  halfWidthMm: number
  points: Point[]
}): PcbCutoutRegion[] {
  const route = removeConsecutiveDuplicatePoints(points)
  if (route.length < 2 || halfWidthMm <= PCB_CUTOUT_GEOMETRY_EPSILON) return []
  const start = route[0]
  const end = route.at(-1)
  const startDirection = getUnitDirection(start, route[1])
  const endDirection = getUnitDirection(route.at(-2), end)
  if (!start || !end || !startDirection || !endDirection) return []

  const leftBoundary = getOpenOffsetBoundary(route, halfWidthMm)
  const rightBoundary = getOpenOffsetBoundary(route, -halfWidthMm)
  const leftStart = addPoints(
    leftBoundary[0] as Point,
    scalePoint(startDirection, -(halfWidthMm - cornerRadiusMm)),
  )
  const leftEnd = addPoints(
    leftBoundary.at(-1) as Point,
    scalePoint(endDirection, halfWidthMm - cornerRadiusMm),
  )
  const rightEnd = addPoints(
    rightBoundary.at(-1) as Point,
    scalePoint(endDirection, halfWidthMm - cornerRadiusMm),
  )
  const rightStart = addPoints(
    rightBoundary[0] as Point,
    scalePoint(startDirection, -(halfWidthMm - cornerRadiusMm)),
  )
  leftBoundary[0] = leftStart
  leftBoundary[leftBoundary.length - 1] = leftEnd
  rightBoundary[0] = rightStart
  rightBoundary[rightBoundary.length - 1] = rightEnd

  const outerRing = [...leftBoundary]
  appendRoundedEndCap({
    center: end,
    cornerRadiusMm,
    halfWidthMm,
    normal: leftNormal(endDirection),
    outward: endDirection,
    points: outerRing,
  })
  outerRing.push(...rightBoundary.slice(0, -1).reverse())
  appendRoundedEndCap({
    center: start,
    cornerRadiusMm,
    halfWidthMm,
    normal: scalePoint(leftNormal(startDirection), -1),
    outward: scalePoint(startDirection, -1),
    points: outerRing,
  })
  return [{ outerRing }]
}

function getClosedStrokeRegion({
  halfWidthMm,
  points,
}: {
  halfWidthMm: number
  points: Point[]
}): PcbCutoutRegion[] {
  if (points.length < 3 || halfWidthMm <= PCB_CUTOUT_GEOMETRY_EPSILON) return []
  const leftRing = getClosedOffsetBoundary(points, halfWidthMm)
  const rightRing = getClosedOffsetBoundary(points, -halfWidthMm)
  if (leftRing.length < 3 || rightRing.length < 3) return []
  const [outerRing, innerRing] =
    getPolygonArea(leftRing) >= getPolygonArea(rightRing)
      ? [leftRing, rightRing]
      : [rightRing, leftRing]
  return [{ innerRings: [innerRing], outerRing }]
}

function getOpenOffsetBoundary(points: Point[], offset: number): Point[] {
  const firstDirection = getUnitDirection(points[0], points[1])
  const lastDirection = getUnitDirection(points.at(-2), points.at(-1))
  const firstPoint = points[0]
  const lastPoint = points.at(-1)
  if (!firstPoint || !lastPoint || !firstDirection || !lastDirection) return []
  const boundary = [
    addPoints(firstPoint, scalePoint(leftNormal(firstDirection), offset)),
  ]
  for (let index = 1; index < points.length - 1; index++) {
    appendOffsetJoin({ boundary, index, offset, points })
  }
  boundary.push(
    addPoints(lastPoint, scalePoint(leftNormal(lastDirection), offset)),
  )
  return boundary
}

function getClosedOffsetBoundary(points: Point[], offset: number): Point[] {
  const boundary: Point[] = []
  for (const [index] of points.entries()) {
    appendOffsetJoin({ boundary, index, offset, points, wrap: true })
  }
  return boundary
}

function appendOffsetJoin({
  boundary,
  index,
  offset,
  points,
  wrap = false,
}: {
  boundary: Point[]
  index: number
  offset: number
  points: Point[]
  wrap?: boolean
}): void {
  const point = points[index]
  const previousPoint =
    points[wrap ? (index - 1 + points.length) % points.length : index - 1]
  const nextPoint = points[wrap ? (index + 1) % points.length : index + 1]
  const previousDirection = getUnitDirection(previousPoint, point)
  const nextDirection = getUnitDirection(point, nextPoint)
  if (!point || !previousDirection || !nextDirection) return
  const previousOffsetPoint = addPoints(
    point,
    scalePoint(leftNormal(previousDirection), offset),
  )
  const nextOffsetPoint = addPoints(
    point,
    scalePoint(leftNormal(nextDirection), offset),
  )
  const intersection = getLineIntersection({
    firstDirection: previousDirection,
    firstPoint: previousOffsetPoint,
    secondDirection: nextDirection,
    secondPoint: nextOffsetPoint,
  })
  if (
    intersection &&
    Math.hypot(intersection.x - point.x, intersection.y - point.y) <=
      Math.abs(offset) * MAXIMUM_MITER_RATIO
  ) {
    appendDistinctPoint(boundary, intersection)
    return
  }
  appendDistinctPoint(boundary, previousOffsetPoint)
  appendDistinctPoint(boundary, nextOffsetPoint)
}

function appendRoundedEndCap({
  center,
  cornerRadiusMm,
  halfWidthMm,
  normal,
  outward,
  points,
}: {
  center: Point
  cornerRadiusMm: number
  halfWidthMm: number
  normal: Point
  outward: Point
  points: Point[]
}): void {
  if (cornerRadiusMm <= PCB_CUTOUT_GEOMETRY_EPSILON) {
    appendDistinctPoint(
      points,
      addPoints(
        center,
        scalePoint(outward, halfWidthMm),
        scalePoint(normal, halfWidthMm),
      ),
    )
    appendDistinctPoint(
      points,
      addPoints(
        center,
        scalePoint(outward, halfWidthMm),
        scalePoint(normal, -halfWidthMm),
      ),
    )
    return
  }

  const inset = halfWidthMm - cornerRadiusMm
  const firstCornerCenter = addPoints(
    center,
    scalePoint(outward, inset),
    scalePoint(normal, inset),
  )
  appendArc({
    center: firstCornerCenter,
    endAngleRadians: 0,
    normal,
    outward,
    points,
    radius: cornerRadiusMm,
    startAngleRadians: Math.PI / 2,
  })
  const secondCornerCenter = addPoints(
    center,
    scalePoint(outward, inset),
    scalePoint(normal, -inset),
  )
  appendArc({
    center: secondCornerCenter,
    endAngleRadians: -Math.PI / 2,
    normal,
    outward,
    points,
    radius: cornerRadiusMm,
    startAngleRadians: 0,
  })
}

function appendArc({
  center,
  endAngleRadians,
  normal,
  outward,
  points,
  radius,
  startAngleRadians,
}: {
  center: Point
  endAngleRadians: number
  normal: Point
  outward: Point
  points: Point[]
  radius: number
  startAngleRadians: number
}): void {
  for (let index = 1; index <= ROUNDED_CORNER_SEGMENTS; index++) {
    const angleRadians =
      startAngleRadians +
      ((endAngleRadians - startAngleRadians) * index) / ROUNDED_CORNER_SEGMENTS
    appendDistinctPoint(
      points,
      addPoints(
        center,
        scalePoint(outward, Math.cos(angleRadians) * radius),
        scalePoint(normal, Math.sin(angleRadians) * radius),
      ),
    )
  }
}
