import { expect, test } from "bun:test"
import { AltiumRegionRecord, AltiumTextRecord } from "altiumts"
import {
  board,
  type CircuitElement,
  expectValidPcb,
  extractArchive,
  pcbComponent,
  sourceComponent,
} from "./fixtures"

test("exports top and bottom silkscreen paths and text", async () => {
  const elements: CircuitElement[] = [
    board(),
    sourceComponent("sc1", "U1"),
    pcbComponent({ pcbComponentId: "pc1", sourceComponentId: "sc1" }),
    {
      type: "pcb_silkscreen_path",
      pcb_silkscreen_path_id: "silk1",
      pcb_component_id: "pc1",
      layer: "top",
      route: [
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
      ],
      stroke_width: 0.12,
    },
    {
      type: "pcb_silkscreen_text",
      pcb_silkscreen_text_id: "text1",
      pcb_component_id: "pc1",
      layer: "bottom",
      anchor_position: { x: 0, y: -2 },
      text: "U1|BOTTOM\nLABEL",
      font_size: 0.8,
      ccw_rotation: 90,
    },
  ]

  const { pcb } = await extractArchive(elements)
  const silkTracks = pcb.getRecordsByKind("Track")
  const text = pcb.getRecordsByKind("Text")[0]

  expect(silkTracks).toHaveLength(2)
  expect(silkTracks.every((track) => track.get("LAYER") === "TOPOVERLAY")).toBe(
    true,
  )
  expect(silkTracks.every((track) => track.get("COMPONENT") === "0")).toBe(true)
  expect(text).toBeInstanceOf(AltiumTextRecord)
  if (!(text instanceof AltiumTextRecord)) {
    throw new Error("Expected a typed Altium text record")
  }
  expect(text.get("LAYER")).toBe("BOTTOMOVERLAY")
  expect(text.get("MIRROR")).toBe("TRUE")
  expect(text.text).toBe("U1|BOTTOM\nLABEL")
  expect(text.get("ROTATION")).toBe("90")
  expectValidPcb(pcb)
})

test("exports a silkscreen line alongside a BRep graphic with a cutout", async () => {
  const elements: CircuitElement[] = [
    board(),
    sourceComponent("sc1", "U1"),
    pcbComponent({ pcbComponentId: "pc1", sourceComponentId: "sc1" }),
    {
      type: "pcb_silkscreen_line",
      pcb_silkscreen_line_id: "silk-line",
      pcb_component_id: "pc1",
      layer: "bottom",
      x1: -4,
      y1: -2,
      x2: 4,
      y2: -2,
      stroke_width: 0.2,
    },
    {
      type: "pcb_silkscreen_graphic",
      pcb_silkscreen_graphic_id: "silk-graphic",
      pcb_component_id: "pc1",
      layer: "top",
      shape: "brep",
      brep_shape: {
        outer_ring: {
          vertices: [
            { x: -4, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 3 },
            { x: -4, y: 3 },
          ],
        },
        inner_rings: [
          {
            vertices: [
              { x: -1, y: 1 },
              { x: 1, y: 1 },
              { x: 1, y: 2 },
              { x: -1, y: 2 },
            ],
          },
        ],
      },
    },
  ]

  const { pcb } = await extractArchive(elements)
  const tracks = pcb.getRecordsByKind("Track")
  const regions = pcb.getRecordsByKind("Region")
  expect(tracks).toHaveLength(1)
  expect(tracks[0]?.get("LAYER")).toBe("BOTTOMOVERLAY")
  expect(tracks[0]?.get("COMPONENT")).toBe("0")
  expect(regions).toHaveLength(1)
  expect(regions[0]?.get("LAYER")).toBe("TOPOVERLAY")
  expect(regions[0]?.get("COMPONENT")).toBe("0")
  expect(regions[0]).toBeInstanceOf(AltiumRegionRecord)
  if (!(regions[0] instanceof AltiumRegionRecord)) {
    throw new Error("Expected a typed Altium region record")
  }
  expect(regions[0].geometry.holes).toHaveLength(1)
  expectValidPcb(pcb)
})
