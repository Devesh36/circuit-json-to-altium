import { expect, test } from "bun:test"
import { board, extractArchive } from "./fixtures"

test("exports outlined top circles and filled bottom circles", async () => {
  const { pcb } = await extractArchive([
    board(),
    {
      type: "pcb_silkscreen_circle",
      pcb_silkscreen_circle_id: "outline",
      pcb_component_id: "",
      layer: "top",
      center: { x: -2, y: 0 },
      radius: 1,
      stroke_width: 0.15,
    },
    {
      type: "pcb_silkscreen_circle",
      pcb_silkscreen_circle_id: "fill",
      pcb_component_id: "",
      layer: "bottom",
      center: { x: 2, y: 0 },
      radius: 1,
      stroke_width: 0,
      is_filled: true,
    },
  ])
  expect(pcb.tracks).toHaveLength(48)
  expect(pcb.tracks.every((track) => track.get("LAYER") === "TOPOVERLAY")).toBe(
    true,
  )
  expect(pcb.regions).toHaveLength(1)
  expect(pcb.regions[0]!.layer).toBe("BOTTOMOVERLAY")
  expect(
    pcb.regions[0]!.geometry.outline.vertices.length,
  ).toBeGreaterThanOrEqual(48)
})
