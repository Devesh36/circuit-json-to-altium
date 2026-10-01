import { pointsEqual } from "./format"
import type { Point } from "./types"

export const PCB_CUTOUT_GEOMETRY_EPSILON = 1e-9

export function removeConsecutiveDuplicatePoints(
  points: readonly Point[],
): Point[] {
  const distinctPoints: Point[] = []
  for (const point of points) appendDistinctPoint(distinctPoints, point)
  return distinctPoints
}

export function appendDistinctPoint(points: Point[], point: Point): void {
  const previousPoint = points.at(-1)
  if (!previousPoint || !pointsEqual(previousPoint, point)) points.push(point)
}

export function getUnitDirection(
  start: Point | undefined,
  end: Point | undefined,
): Point | undefined {
  if (!start || !end) return undefined
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const length = Math.hypot(deltaX, deltaY)
  if (length <= PCB_CUTOUT_GEOMETRY_EPSILON) return undefined
  return { x: deltaX / length, y: deltaY / length }
}

export function leftNormal(direction: Point): Point {
  return { x: -direction.y, y: direction.x }
}

export function scalePoint(point: Point, scale: number): Point {
  return { x: point.x * scale, y: point.y * scale }
}

export function addPoints(...points: Point[]): Point {
  return points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 },
  )
}

function crossProduct(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x
}

export function getLineIntersection({
  firstDirection,
  firstPoint,
  secondDirection,
  secondPoint,
}: {
  firstDirection: Point
  firstPoint: Point
  secondDirection: Point
  secondPoint: Point
}): Point | undefined {
  const denominator = crossProduct(firstDirection, secondDirection)
  if (Math.abs(denominator) <= PCB_CUTOUT_GEOMETRY_EPSILON) return undefined
  const betweenStarts = {
    x: secondPoint.x - firstPoint.x,
    y: secondPoint.y - firstPoint.y,
  }
  const distanceAlongFirst =
    crossProduct(betweenStarts, secondDirection) / denominator
  return addPoints(firstPoint, scalePoint(firstDirection, distanceAlongFirst))
}
