import { type PcbCutout, pcb_cutout } from "circuit-json"
import { createBoardCutoutRegionRecord } from "./create-board-cutout-region-record"
import {
  createCirclePoints,
  createRoundedRectPoints,
} from "./create-pcb-annotation-primitives"
import { getPcbPathCutoutRegions } from "./get-pcb-path-cutout-regions"
import type { PcbCutoutRegion } from "./pcb-cutout-types"
import type { CircuitElement, PointTransform } from "./types"

type CreatePcbCutoutRecordsOptions = {
  circuitJson: CircuitElement[]
  circuitToAltiumPcbPoint: PointTransform
}

export function createPcbCutoutRecords({
  circuitJson,
  circuitToAltiumPcbPoint,
}: CreatePcbCutoutRecordsOptions): string[] {
  const records: string[] = []

  for (const element of circuitJson) {
    if (element.type !== "pcb_cutout") continue
    const cutout = pcb_cutout.parse(element)
    for (const region of getCutoutRegions(cutout)) {
      records.push(
        createBoardCutoutRegionRecord({
          circuitToAltiumPcbPoint,
          innerRings: region.innerRings ?? [],
          outerRing: region.outerRing,
        }),
      )
    }
  }

  return records
}

function getCutoutRegions(cutout: PcbCutout): PcbCutoutRegion[] {
  if (cutout.shape === "rect") {
    return [
      {
        outerRing: createRoundedRectPoints({
          center: cutout.center,
          cornerRadiusMm: cutout.corner_radius ?? 0,
          heightMm: cutout.height,
          rotationDegrees: cutout.rotation ?? 0,
          widthMm: cutout.width,
        }),
      },
    ]
  }
  if (cutout.shape === "circle") {
    return [
      {
        outerRing: createCirclePoints({
          center: cutout.center,
          radiusMm: cutout.radius,
        }),
      },
    ]
  }
  if (cutout.shape === "polygon") {
    return [{ outerRing: cutout.points }]
  }
  return getPcbPathCutoutRegions(cutout)
}
