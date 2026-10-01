import { pcb_keepout } from "circuit-json"
import {
  createAltiumFillRecord,
  createAltiumRegionRecord,
  createAltiumTrackRecords,
  createCirclePoints,
} from "./create-pcb-annotation-primitives"
import { createPcbKeepoutExclusionRule } from "./create-pcb-keepout-exclusion-rule"
import type { CircuitElement, PointTransform } from "./types"

type CreatePcbKeepoutRecordsOptions = {
  circuitJson: CircuitElement[]
  circuitToAltiumPcbPoint: PointTransform
}

function addKeepoutUnionIndex({
  record,
  unionIndex,
}: {
  record: string
  unionIndex: number | undefined
}): string {
  return unionIndex === undefined
    ? record
    : `${record}|UNIONINDEX=${unionIndex}`
}

export function createPcbKeepoutRecords({
  circuitJson,
  circuitToAltiumPcbPoint,
}: CreatePcbKeepoutRecordsOptions): string[] {
  const records: string[] = []
  let exclusionIndex = 0

  for (const element of circuitJson) {
    if (element.type !== "pcb_keepout") continue
    const keepout = pcb_keepout.parse(element)
    const unionIndex = keepout.excluded_pcb_component_ids?.length
      ? ++exclusionIndex
      : undefined
    if (unionIndex !== undefined) {
      records.push(
        createPcbKeepoutExclusionRule({
          circuitJson,
          excludedComponentIds: keepout.excluded_pcb_component_ids!,
          unionIndex,
        }),
      )
    }
    if (keepout.shape === "outline" && keepout.stroke_width <= 0) {
      throw new Error(
        `PCB keepout outline ${keepout.pcb_keepout_id} requires a stroke width`,
      )
    }
    for (const layer of keepout.layers.map(getAltiumKeepoutLayer)) {
      if (keepout.shape === "rect") {
        records.push(
          addKeepoutUnionIndex({
            record: createAltiumFillRecord({
              center: keepout.center,
              circuitToAltiumPcbPoint,
              heightMm: keepout.height,
              isKeepout: true,
              layer,
              widthMm: keepout.width,
            }),
            unionIndex,
          }),
        )
        continue
      }
      if (keepout.shape === "circle") {
        records.push(
          addKeepoutUnionIndex({
            record: createAltiumRegionRecord({
              circuitPoints: createCirclePoints({
                center: keepout.center,
                radiusMm: keepout.radius,
              }),
              circuitToAltiumPcbPoint,
              isKeepout: true,
              layer,
            }),
            unionIndex,
          }),
        )
        continue
      }
      records.push(
        ...createAltiumTrackRecords({
          circuitPoints: keepout.outline,
          circuitToAltiumPcbPoint,
          isKeepout: true,
          layer,
          strokeWidthMm: keepout.stroke_width,
        }).map((record) => addKeepoutUnionIndex({ record, unionIndex })),
      )
    }
  }

  return records
}

function getAltiumKeepoutLayer(circuitLayer: string): string {
  const normalizedLayer = circuitLayer.toLowerCase()
  if (normalizedLayer === "top") return "TOP"
  if (normalizedLayer === "bottom") return "BOTTOM"
  if (normalizedLayer === "all" || normalizedLayer === "multilayer") {
    return "KEEPOUT"
  }
  const innerLayerMatch = /^inner(\d+)$/u.exec(normalizedLayer)
  if (innerLayerMatch?.[1]) {
    return `MID-LAYER${Number(innerLayerMatch[1])}`
  }
  throw new Error(`Unsupported PCB keepout layer: ${circuitLayer}`)
}
