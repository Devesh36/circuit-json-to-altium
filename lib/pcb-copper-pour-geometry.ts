import type { PcbCopperPour, PointWithBulge } from "circuit-json"
import { applyToPoint, compose, rotate, translate } from "transformation-matrix"
import { pointsEqual } from "./format"
import type { Point } from "./types"

type CopperPourRings = {
  innerRings: Point[][]
  outerRing: Point[]
}

const MAXIMUM_ARC_STEP_RADIANS = Math.PI / 24

export function getCopperPourRings(copperPour: PcbCopperPour): CopperPourRings {
  if (copperPour.shape === "rect") {
    return {
      innerRings: [],
      outerRing: closeCopperPourRing(getRotatedRectPoints(copperPour)),
    }
  }
  if (copperPour.shape === "polygon") {
    return {
      innerRings: [],
      outerRing: closeCopperPourRing(copperPour.points),
    }
  }
  return {
    innerRings: copperPour.brep_shape.inner_rings.map((ring) =>
      removeClosingPoint(flattenBulgedRing(ring.vertices)),
    ),
    outerRing: closeCopperPourRing(
      flattenBulgedRing(copperPour.brep_shape.outer_ring.vertices),
    ),
  }
}

function getRotatedRectPoints(
  copperPour: Extract<PcbCopperPour, { shape: "rect" }>,
): Point[] {
  const centerToCircuitMatrix = compose(
    translate(copperPour.center.x, copperPour.center.y),
    rotate(((copperPour.rotation ?? 0) * Math.PI) / 180),
  )
  const halfWidth = copperPour.width / 2
  const halfHeight = copperPour.height / 2
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((corner) => applyToPoint(centerToCircuitMatrix, corner))
}

function flattenBulgedRing(vertices: PointWithBulge[]): Point[] {
  const ring = removeClosingPoint(vertices)
  if (ring.length < 3) {
    throw new Error("A PCB copper pour ring requires at least three vertices")
  }
  const points: Point[] = []
  for (const [vertexIndex, start] of ring.entries()) {
    const end = ring[(vertexIndex + 1) % ring.length]
    if (!end) continue
    appendDistinctPoint(points, start)
    for (const point of approximateBulgedSegment({
      bulge: start.bulge ?? 0,
      end,
      start,
    })) {
      appendDistinctPoint(points, point)
    }
  }
  return closeCopperPourRing(points)
}

function approximateBulgedSegment({
  bulge,
  end,
  start,
}: {
  bulge: number
  end: Point
  start: Point
}): Point[] {
  if (Math.abs(bulge) < 1e-12 || pointsEqual(start, end)) return [end]
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const centerScale = (1 - bulge * bulge) / (4 * bulge)
  const center = {
    x: (start.x + end.x) / 2 - deltaY * centerScale,
    y: (start.y + end.y) / 2 + deltaX * centerScale,
  }
  const radius = Math.hypot(start.x - center.x, start.y - center.y)
  const startAngleRadians = Math.atan2(start.y - center.y, start.x - center.x)
  const sweepRadians = 4 * Math.atan(bulge)
  const segmentCount = Math.max(
    2,
    Math.ceil(Math.abs(sweepRadians) / MAXIMUM_ARC_STEP_RADIANS),
  )
  return Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const angleRadians =
      startAngleRadians + (sweepRadians * (segmentIndex + 1)) / segmentCount
    return {
      x: center.x + radius * Math.cos(angleRadians),
      y: center.y + radius * Math.sin(angleRadians),
    }
  })
}

export function closeCopperPourRing(points: readonly Point[]): Point[] {
  const ring: Point[] = []
  for (const point of points) appendDistinctPoint(ring, point)
  const firstPoint = ring[0]
  if (firstPoint && !pointsEqual(firstPoint, ring.at(-1) ?? firstPoint)) {
    ring.push(firstPoint)
  }
  if (ring.length < 4) {
    throw new Error("A PCB copper pour ring requires at least three vertices")
  }
  return ring
}

function removeClosingPoint<T extends Point>(points: readonly T[]): T[] {
  const ring = [...points]
  const firstPoint = ring[0]
  const lastPoint = ring.at(-1)
  if (firstPoint && lastPoint && pointsEqual(firstPoint, lastPoint)) ring.pop()
  return ring
}

function appendDistinctPoint(points: Point[], point: Point): void {
  const previousPoint = points.at(-1)
  if (!previousPoint || !pointsEqual(previousPoint, point)) points.push(point)
}

export function getAltiumCopperLayer(layer: PcbCopperPour["layer"]): string {
  if (layer === "top") return "TOP"
  if (layer === "bottom") return "BOTTOM"
  const innerLayerMatch = /^inner(\d+)$/u.exec(layer)
  if (!innerLayerMatch?.[1]) {
    throw new Error(`Unsupported PCB copper pour layer: ${layer}`)
  }
  return `MID-LAYER${Number(innerLayerMatch[1])}`
}

export function isOuterCopperLayer(layer: string): boolean {
  return layer === "TOP" || layer === "BOTTOM"
}
