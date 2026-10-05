import { expect, test } from "bun:test"
import { AltiumTrackRecord, parseAltiumBinaryPcbDoc } from "altiumts"
import { CircuitJsonToAltiumConverter } from "../lib"
import type { CircuitElement } from "./fixtures"

test("preserves all 13 nema17 silkscreen circles in native export", async () => {
  const elements = (await Bun.file(
    new URL("./assets/nema17.circuit.json", import.meta.url),
  ).json()) as CircuitElement[]
  const circles = elements.filter(
    (element) => element.type === "pcb_silkscreen_circle",
  )
  expect(circles).toHaveLength(13)
  const converter = new CircuitJsonToAltiumConverter(elements, {
    projectName: "nema17",
  })
  converter.runUntilFinished()
  const document = parseAltiumBinaryPcbDoc(converter.getOutput().pcb.content)
  const tracks = document.records.filter(
    (record): record is AltiumTrackRecord =>
      record instanceof AltiumTrackRecord,
  )
  const circleTracks = tracks.slice(-13 * 48)
  expect(circleTracks).toHaveLength(13 * 48)
  const board = elements.find((element) => element.type === "pcb_board")!
  const outline = board.outline as { x: number; y: number }[]
  const offsetX = 25.4 - Math.min(...outline.map((point) => point.x))
  const offsetY = 25.4 - Math.min(...outline.map((point) => point.y))
  const components = elements.filter(
    (element) => element.type === "pcb_component",
  )
  for (const [index, circle] of circles.entries()) {
    const ring = circleTracks.slice(index * 48, (index + 1) * 48)
    const center = circle.center as { x: number; y: number }
    for (const [segmentIndex, segment] of ring.entries()) {
      expect(segment.layer).toBe(
        circle.layer === "bottom" ? "BOTTOMOVERLAY" : "TOPOVERLAY",
      )
      expect(segment.widthMils! * 0.0254).toBeCloseTo(
        circle.stroke_width as number,
        4,
      )
      expect(segment.componentIndex).toBe(
        components.findIndex(
          (component) => component.pcb_component_id === circle.pcb_component_id,
        ),
      )
      const start = segment.start!
      expect(
        Math.hypot(
          start.x * 0.0254 - offsetX - center.x,
          start.y * 0.0254 - offsetY - center.y,
        ),
      ).toBeCloseTo(circle.radius as number, 4)
      expect(segment.end!.x).toBeCloseTo(
        ring[(segmentIndex + 1) % 48]!.start!.x,
        4,
      )
      expect(segment.end!.y).toBeCloseTo(
        ring[(segmentIndex + 1) % 48]!.start!.y,
        4,
      )
    }
  }
})
