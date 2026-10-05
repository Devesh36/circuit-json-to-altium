import { pcb_silkscreen_circle } from "circuit-json"
import {
  createAltiumRegionRecord,
  createAltiumTrackRecords,
  createCirclePoints,
} from "./create-pcb-annotation-primitives"
import { byType } from "./format"
import type { CircuitElement, PcbComponentId, PointTransform } from "./types"

export function createPcbSilkscreenCircleRecords({
  circuitJson,
  circuitToAltiumPcbPoint,
  componentIndex,
}: {
  circuitJson: CircuitElement[]
  circuitToAltiumPcbPoint: PointTransform
  componentIndex: ReadonlyMap<PcbComponentId, number>
}): string[] {
  return byType(circuitJson, "pcb_silkscreen_circle").flatMap((element) => {
    const circle = pcb_silkscreen_circle.parse(element)
    const owner = componentIndex.get(circle.pcb_component_id)
    const layer = circle.layer === "bottom" ? "BOTTOMOVERLAY" : "TOPOVERLAY"
    const records: string[] = []
    if (circle.is_filled) {
      records.push(
        createAltiumRegionRecord({
          altiumComponentIndex: owner,
          circuitPoints: createCirclePoints({
            center: circle.center,
            radiusMm: circle.radius,
          }),
          circuitToAltiumPcbPoint,
          layer,
        }),
      )
    }
    if (circle.stroke_width > 0) {
      records.push(
        ...createAltiumTrackRecords({
          altiumComponentIndex: owner,
          circuitPoints: createCirclePoints({
            center: circle.center,
            radiusMm: circle.radius,
          }),
          circuitToAltiumPcbPoint,
          closePath: true,
          layer,
          strokeWidthMm: circle.stroke_width,
        }),
      )
    }
    return records
  })
}
