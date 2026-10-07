import { pcb_silkscreen_rect } from "circuit-json"
import {
  createAltiumFillRecord,
  createAltiumRegionRecord,
  createAltiumTrackRecords,
  createRoundedRectPoints,
} from "./create-pcb-annotation-primitives"
import { byType } from "./format"
import type { CircuitElement, PcbComponentId, PointTransform } from "./types"

export function createPcbSilkscreenRectRecords({
  circuitJson,
  circuitToAltiumPcbPoint,
  componentIndex,
}: {
  circuitJson: CircuitElement[]
  circuitToAltiumPcbPoint: PointTransform
  componentIndex: ReadonlyMap<PcbComponentId, number>
}): string[] {
  return byType(circuitJson, "pcb_silkscreen_rect").flatMap((element) => {
    const rectangle = pcb_silkscreen_rect.parse(element)
    const owner = componentIndex.get(rectangle.pcb_component_id)
    const layer = rectangle.layer === "bottom" ? "BOTTOMOVERLAY" : "TOPOVERLAY"
    const rotationDegrees = rectangle.ccw_rotation ?? 0
    const cornerRadiusMm = rectangle.corner_radius ?? 0
    const circuitPoints = createRoundedRectPoints({
      center: rectangle.center,
      cornerRadiusMm,
      heightMm: rectangle.height,
      rotationDegrees,
      widthMm: rectangle.width,
    })
    const records: string[] = []
    if (rectangle.is_filled) {
      records.push(
        cornerRadiusMm === 0
          ? createAltiumFillRecord({
              altiumComponentIndex: owner,
              center: rectangle.center,
              circuitToAltiumPcbPoint,
              heightMm: rectangle.height,
              layer,
              rotationDegrees,
              widthMm: rectangle.width,
            })
          : createAltiumRegionRecord({
              altiumComponentIndex: owner,
              circuitPoints,
              circuitToAltiumPcbPoint,
              layer,
            }),
      )
    }
    if (rectangle.has_stroke !== false && rectangle.stroke_width > 0) {
      if (rectangle.is_stroke_dashed) {
        throw new Error(
          "Altium silkscreen rectangles do not preserve dashed strokes",
        )
      }
      records.push(
        ...createAltiumTrackRecords({
          altiumComponentIndex: owner,
          circuitPoints,
          circuitToAltiumPcbPoint,
          closePath: true,
          layer,
          strokeWidthMm: rectangle.stroke_width,
        }),
      )
    }
    return records
  })
}
