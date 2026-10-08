import { expect, test } from "bun:test"
import {
  board,
  type CircuitElement,
  expectValidPcb,
  extractArchive,
  pcbComponent,
  sourceComponent,
} from "./fixtures"

test("preserves PMP23595 terminal pad rotation and copper dimensions", async () => {
  const terminals = [
    { name: "T500", rotation: 90, x: -15, y: -15 },
    { name: "T501", rotation: 270, x: 15, y: 15 },
    { name: "T502", rotation: 90, x: 15, y: -15 },
    { name: "T503", rotation: 270, x: -15, y: 15 },
  ]
  const elements: CircuitElement[] = [board({ width: 80, height: 70 })]
  for (const { name, rotation, x, y } of terminals) {
    const sourceComponentId = `source-${name}`
    const pcbComponentId = `pcb-${name}`
    elements.push(
      sourceComponent(sourceComponentId, name),
      pcbComponent({
        sourceComponentId,
        pcbComponentId,
        overrides: { center: { x, y }, rotation },
      }),
      {
        type: "pcb_plated_hole",
        pcb_plated_hole_id: `hole-${name}`,
        pcb_component_id: pcbComponentId,
        shape: "circular_hole_with_rect_pad",
        hole_diameter: 6.4516,
        rect_pad_width: 17.272,
        rect_pad_height: 12.7,
        rect_ccw_rotation: rotation,
        x,
        y,
        port_hints: ["1"],
      },
    )
  }

  const { pcb } = await extractArchive(elements)
  const pads = pcb.getRecordsByKind("Pad")
  expect(pads).toHaveLength(4)
  for (const [index, pad] of pads.entries()) {
    const terminal = terminals[index]!
    expect(pcb.getComponentForRecord(pad)?.get("SOURCEDESIGNATOR")).toBe(
      terminal.name,
    )
    expect(pad.getNumber("ROTATION")).toBe(terminal.rotation)
    expect(pad.get("SHAPE")).toBe("RECTANGLE")
    expect(pad.get("HOLESHAPE") ?? "ROUND").toBe("ROUND")
    expect(pad.getAltiumMeasurement("XSIZE")?.toMillimeters()).toBeCloseTo(
      17.272,
      4,
    )
    expect(pad.getAltiumMeasurement("YSIZE")?.toMillimeters()).toBeCloseTo(
      12.7,
      4,
    )
    expect(pad.getAltiumMeasurement("HOLESIZE")?.toMillimeters()).toBeCloseTo(
      6.4516,
      4,
    )
  }
  expectValidPcb(pcb)
})

test("uses rectangular-pad rotation with legacy fallback and normalization", async () => {
  const cases = [
    { rect_ccw_rotation: 0, ccw_rotation: 90, expected: 0 },
    { rect_ccw_rotation: -90, ccw_rotation: 0, expected: 270 },
    { rect_ccw_rotation: 450, expected: 90 },
    { rect_ccw_rotation: 37, expected: 37 },
    { rect_ccw_rotation: 180, ccw_rotation: 0, expected: 180 },
    { ccw_rotation: 270, expected: 270 },
    { expected: 0 },
  ]
  const elements: CircuitElement[] = [board()]
  for (const [index, { expected: _expected, ...rotation }] of cases.entries()) {
    elements.push({
      type: "pcb_plated_hole",
      pcb_plated_hole_id: `hole-${index}`,
      shape: "circular_hole_with_rect_pad",
      hole_diameter: 0.8,
      rect_pad_width: 2,
      rect_pad_height: 1,
      x: index,
      y: 0,
      ...rotation,
    })
  }

  const { pcb } = await extractArchive(elements)
  for (const [index, pad] of pcb.getRecordsByKind("Pad").entries()) {
    expect(pad.getNumber("ROTATION")).toBe(cases[index]!.expected)
  }
})
