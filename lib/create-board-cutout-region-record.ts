import { formatMil, getPolygonArea, pointsEqual } from "./format"
import {
  PCB_CUTOUT_GEOMETRY_EPSILON,
  removeConsecutiveDuplicatePoints,
} from "./pcb-cutout-geometry"
import type { Point, PointTransform } from "./types"

function closeValidRing(points: Point[]): Point[] {
  const ring = removeConsecutiveDuplicatePoints(points)
  const firstPoint = ring[0]
  const lastPoint = ring.at(-1)
  if (firstPoint && lastPoint && !pointsEqual(firstPoint, lastPoint)) {
    ring.push(firstPoint)
  }
  if (ring.length < 4 || getPolygonArea(ring) <= PCB_CUTOUT_GEOMETRY_EPSILON) {
    throw new Error("A PCB board cutout requires at least three vertices")
  }
  return ring
}

function createContourFields(points: Point[]): string[] {
  return points.flatMap((point, vertexIndex) => [
    `KIND${vertexIndex}=0`,
    `VX${vertexIndex}=${formatMil(point.x)}`,
    `VY${vertexIndex}=${formatMil(point.y)}`,
  ])
}

function createHoleFields(points: Point[], holeIndex: number): string[] {
  return [
    `HOLE${holeIndex}COUNT=${points.length}`,
    ...points.flatMap((point, vertexIndex) => [
      `HOLE${holeIndex}VX${vertexIndex}=${formatMil(point.x)}`,
      `HOLE${holeIndex}VY${vertexIndex}=${formatMil(point.y)}`,
    ]),
  ]
}

export function createBoardCutoutRegionRecord({
  circuitToAltiumPcbPoint,
  innerRings,
  outerRing,
}: {
  circuitToAltiumPcbPoint: PointTransform
  innerRings: Point[][]
  outerRing: Point[]
}): string {
  const altiumOuterRing = closeValidRing(outerRing).map(circuitToAltiumPcbPoint)
  const altiumInnerRings = innerRings.map((ring) =>
    closeValidRing(ring).map(circuitToAltiumPcbPoint),
  )
  return [
    "|RECORD=Region",
    "LAYER=MULTILAYER",
    "LOCKED=FALSE",
    "KEEPOUT=FALSE",
    "TEARDROP=FALSE",
    "ISBOARDCUTOUT=TRUE",
    "REGIONKIND=COPPER",
    `HOLECOUNT=${altiumInnerRings.length}`,
    ...createContourFields(altiumOuterRing),
    ...altiumInnerRings.flatMap(createHoleFields),
  ].join("|")
}
