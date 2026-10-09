import { expect, test } from "bun:test"
import { board, type CircuitElement, extractArchive } from "./fixtures"

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
