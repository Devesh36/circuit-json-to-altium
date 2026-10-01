import { pcb_copper_pour } from "circuit-json"
import type { PcbNetEntry } from "./create-pcb-net-entries"
import { asNumber, asString, formatMil } from "./format"
import {
  closeCopperPourRing,
  getAltiumCopperLayer,
  getCopperPourRings,
  isOuterCopperLayer,
} from "./pcb-copper-pour-geometry"
import type {
  CircuitElement,
  PcbComponentId,
  Point,
  PointTransform,
  SourceNetId,
} from "./types"

type CreatePcbCopperPourRecordsOptions = {
  circuitJson: CircuitElement[]
  circuitToAltiumPcbPoint: PointTransform
  componentIndex: ReadonlyMap<PcbComponentId, number>
  netEntries: PcbNetEntry[]
}

type AltiumPolygonRole = "outline" | "region"

type PolygonIdAllocatorContext = {
  nextGeneratedPolygonId: number
  usedPolygonIds: Set<number>
}

function allocatePolygonId(context: PolygonIdAllocatorContext): number {
  while (context.usedPolygonIds.has(context.nextGeneratedPolygonId)) {
    context.nextGeneratedPolygonId++
  }
  const polygonId = context.nextGeneratedPolygonId
  context.usedPolygonIds.add(polygonId)
  context.nextGeneratedPolygonId++
  return polygonId
}

export function createPcbCopperPourRecords({
  circuitJson,
  circuitToAltiumPcbPoint,
  componentIndex,
  netEntries,
}: CreatePcbCopperPourRecordsOptions): string[] {
  const netBySourceNetId = new Map<SourceNetId, PcbNetEntry>(
    netEntries.flatMap((netEntry) =>
      netEntry.sourceNetIds.map(
        (sourceNetId) => [sourceNetId, netEntry] as const,
      ),
    ),
  )
  const copperPours = circuitJson.flatMap((element) => {
    if (element.type !== "pcb_copper_pour") return []
    return [
      {
        copperPour: pcb_copper_pour.parse(element),
        polygonId: getAltiumPolygonId(element.altium_polygon_id),
        polygonRole: getAltiumPolygonRole(element.altium_polygon_role),
        polygonCutoutCount: Math.max(
          0,
          Math.trunc(asNumber(element.altium_polygon_cutout_count)),
        ),
        pcbComponentId: asString(element.pcb_component_id),
      },
    ]
  })
  const records: string[] = []
  const usedPolygonIds = new Set(
    copperPours.flatMap(({ polygonId }) =>
      polygonId === undefined ? [] : [polygonId],
    ),
  )
  const polygonIdAllocatorContext: PolygonIdAllocatorContext = {
    nextGeneratedPolygonId: 0,
    usedPolygonIds,
  }

  for (const entry of copperPours) {
    const { copperPour, pcbComponentId, polygonCutoutCount, polygonRole } =
      entry
    const polygonId =
      entry.polygonId ?? allocatePolygonId(polygonIdAllocatorContext)
    const circuitRings = getCopperPourRings(copperPour)
    const altiumRings = {
      outerRing: circuitRings.outerRing.map(circuitToAltiumPcbPoint),
      innerRings: circuitRings.innerRings.map((ring) =>
        ring.map(circuitToAltiumPcbPoint),
      ),
    }
    const layer = getAltiumCopperLayer(copperPour.layer)
    const boundedPolygonCutoutCount = Math.min(
      polygonCutoutCount,
      altiumRings.innerRings.length,
    )
    const inlineInnerRingCount =
      altiumRings.innerRings.length - boundedPolygonCutoutCount
    const inlineInnerRings = altiumRings.innerRings.slice(
      0,
      inlineInnerRingCount,
    )
    const polygonCutoutRings =
      altiumRings.innerRings.slice(inlineInnerRingCount)
    const net = copperPour.source_net_id
      ? netBySourceNetId.get(copperPour.source_net_id)
      : undefined
    const altiumComponentIndex = componentIndex.get(pcbComponentId)

    if (altiumComponentIndex !== undefined) {
      records.push(
        createRegionRecord({
          altiumComponentIndex,
          innerRings: altiumRings.innerRings,
          layer,
          outerRing: altiumRings.outerRing,
        }),
      )
      if (!copperPour.covered_with_solder_mask && isOuterCopperLayer(layer)) {
        records.push(
          createRegionRecord({
            altiumComponentIndex,
            innerRings: altiumRings.innerRings,
            layer: layer === "TOP" ? "TOPSOLDER" : "BOTTOMSOLDER",
            outerRing: altiumRings.outerRing,
          }),
        )
      }
      continue
    }

    if (polygonRole !== "region") {
      records.push(
        createPolygonRecord({
          layer,
          net,
          outerRing: altiumRings.outerRing,
          polygonIndex: polygonId,
        }),
      )
    }
    if (polygonRole !== "outline") {
      records.push(
        createRegionRecord({
          innerRings: inlineInnerRings,
          layer,
          net,
          outerRing: altiumRings.outerRing,
          polygonIndex: polygonId,
        }),
      )
    }
    records.push(
      ...polygonCutoutRings.map((innerRing) =>
        createRegionRecord({
          innerRings: [],
          layer,
          net,
          outerRing: closeCopperPourRing(innerRing),
          polygonIndex: polygonId,
          regionKind: "POLYGON_CUTOUT",
        }),
      ),
    )

    if (
      polygonRole !== "outline" &&
      !copperPour.covered_with_solder_mask &&
      isOuterCopperLayer(layer)
    ) {
      records.push(
        createRegionRecord({
          innerRings: altiumRings.innerRings,
          layer: layer === "TOP" ? "TOPSOLDER" : "BOTTOMSOLDER",
          outerRing: altiumRings.outerRing,
        }),
      )
    }
  }

  return records
}

function getAltiumPolygonId(polygonId: unknown): number | undefined {
  return typeof polygonId === "number" &&
    Number.isInteger(polygonId) &&
    polygonId >= 0 &&
    polygonId < 65_535
    ? polygonId
    : undefined
}

function getAltiumPolygonRole(
  polygonRole: unknown,
): AltiumPolygonRole | undefined {
  return polygonRole === "outline" || polygonRole === "region"
    ? polygonRole
    : undefined
}

function createPolygonRecord({
  layer,
  net,
  outerRing,
  polygonIndex,
}: {
  layer: string
  net?: PcbNetEntry
  outerRing: Point[]
  polygonIndex: number
}): string {
  return [
    "|RECORD=Polygon",
    `NET=${net?.index ?? 65_535}`,
    `ID=${polygonIndex}`,
    "POLYGONTYPE=Polygon",
    "POUROVERSTYLE=1",
    "HATCHSTYLE=Solid",
    "SELECTION=FALSE",
    `LAYER=${layer}`,
    "LOCKED=FALSE",
    ...createContourFields(outerRing),
  ].join("|")
}

function createRegionRecord({
  altiumComponentIndex,
  innerRings,
  layer,
  net,
  outerRing,
  polygonIndex,
  regionKind = "COPPER",
}: {
  altiumComponentIndex?: number
  innerRings: Point[][]
  layer: string
  net?: PcbNetEntry
  outerRing: Point[]
  polygonIndex?: number
  regionKind?: "COPPER" | "POLYGON_CUTOUT"
}): string {
  return [
    "|RECORD=Region",
    ...(altiumComponentIndex === undefined
      ? []
      : [`COMPONENT=${altiumComponentIndex}`]),
    ...(net ? [`NET=${net.index}`] : []),
    ...(polygonIndex === undefined ? [] : [`POLYGON=${polygonIndex}`]),
    `LAYER=${layer}`,
    "LOCKED=FALSE",
    "KEEPOUT=FALSE",
    "TEARDROP=FALSE",
    `REGIONKIND=${regionKind}`,
    `HOLECOUNT=${innerRings.length}`,
    ...createContourFields(outerRing),
    ...innerRings.flatMap(createHoleFields),
  ].join("|")
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
