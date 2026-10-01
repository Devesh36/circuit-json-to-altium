import { pcb_silkscreen_line } from "circuit-json"
import { createAltiumTrackRecords } from "./create-pcb-annotation-primitives"
import { byType } from "./format"
import type { CircuitElement, PcbComponentId, PointTransform } from "./types"

export function createPcbSilkscreenLineRecords({
  circuitJson,
  circuitToAltiumPcbPoint,
  componentIndex,
}: {
  circuitJson: CircuitElement[]
  circuitToAltiumPcbPoint: PointTransform
  componentIndex: ReadonlyMap<PcbComponentId, number>
}): string[] {
  return byType(circuitJson, "pcb_silkscreen_line").flatMap((element) => {
    const line = pcb_silkscreen_line.parse(element)
    return createAltiumTrackRecords({
      altiumComponentIndex: componentIndex.get(line.pcb_component_id),
      circuitPoints: [
        { x: line.x1, y: line.y1 },
        { x: line.x2, y: line.y2 },
      ],
      circuitToAltiumPcbPoint,
      layer: line.layer === "bottom" ? "BOTTOMOVERLAY" : "TOPOVERLAY",
      strokeWidthMm: line.stroke_width,
    })
  })
}
