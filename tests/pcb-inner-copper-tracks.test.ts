import { expect, test } from "bun:test"
import { parseAltiumBinaryPcbDoc } from "altiumts"
import { CircuitJsonToAltiumConverter } from "../lib"
import { board } from "./fixtures"

test.failing("preserves inner copper tracks and their physical board stack", () => {
  const layers = ["top", "inner1", "inner2", "inner8", "bottom"]
  const converter = new CircuitJsonToAltiumConverter([
    board(),
    ...layers.map((layer, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `trace${index}`,
      route: [
        { route_type: "wire", x: 0, y: index, width: 0.25, layer },
        { route_type: "wire", x: 5, y: index, width: 0.25, layer },
      ],
    })),
  ])
  converter.runUntilFinished()
  const document = parseAltiumBinaryPcbDoc(converter.getOutput().pcb.content)
  expect(document.tracks.map((track) => track.get("LAYER"))).toEqual([
    "TOP",
    "MID-LAYER1",
    "MID-LAYER2",
    "MID-LAYER8",
    "BOTTOM",
  ])
  const stack = document.board?.layerStack.entries
  expect(stack).toHaveLength(10)
  expect(stack?.map((entry) => entry.name)).toEqual([
    "Top Layer",
    ...Array.from({ length: 8 }, (_, index) => `Mid-Layer ${index + 1}`),
    "Bottom Layer",
  ])
})
