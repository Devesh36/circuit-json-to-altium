import { expect, test } from "bun:test"
import { board, type CircuitElement, extractArchive } from "./fixtures"

const getWorldSlotAngle = (pad: {
  getNumber: (key: string) => number | undefined
}) =>
  ((pad.getNumber("ROTATION") ?? 0) + (pad.getNumber("HOLEROTATION") ?? 0)) %
  180

test("preserves the eight vertical NEMA17 USB-C mounting slots", async () => {
  const elements = (await Bun.file(
    new URL("./assets/nema17.circuit.json", import.meta.url),
  ).json()) as CircuitElement[]
  const slots = elements.filter(
    (element) =>
      element.type === "pcb_plated_hole" &&
      Number(element.hole_height) > Number(element.hole_width),
  )
  expect(slots).toHaveLength(8)
  const { pcb } = await extractArchive(elements)
  const pads = pcb
    .getRecordsByKind("Pad")
    .filter((pad) => pad.get("HOLESHAPE") === "SLOT")
  expect(pads).toHaveLength(8)
  for (const [index, pad] of pads.entries()) {
    expect(getWorldSlotAngle(pad)).toBe(90)
    expect(pad.getAltiumMeasurement("HOLESIZE")?.toMillimeters()).toBeCloseTo(
      Number(slots[index]?.hole_width),
      4,
    )
    expect(pad.getAltiumMeasurement("SLOTLENGTH")?.toMillimeters()).toBeCloseTo(
      Number(slots[index]?.hole_height),
      4,
    )
  }
}, 30_000)

test("preserves horizontal, vertical, and independently rotated slot axes", async () => {
  const elements: CircuitElement[] = [board()]
  const expectedAngles: number[] = []
  for (const type of ["pcb_plated_hole", "pcb_hole"]) {
    for (const [width, height, rotation, expectedAngle] of [
      [1.6, 0.8, 0, 0],
      [1.6, 0.8, 30, 30],
      [1.6, 0.8, 90, 90],
      [1.6, 0.8, 180, 0],
      [1.6, 0.8, -45, 135],
      [0.8, 1.6, 0, 90],
      [0.8, 1.6, 30, 120],
      [0.8, 1.6, 90, 0],
      [0.8, 1.6, 180, 90],
      [0.8, 1.6, -45, 45],
    ] as const) {
      elements.push({
        type,
        [`${type}_id`]: `${type}-${elements.length}`,
        shape: "pill",
        hole_shape: "pill",
        x: 0,
        y: 0,
        hole_width: width,
        hole_height: height,
        outer_width: 2,
        outer_height: 2,
        ccw_rotation: rotation,
      })
      expectedAngles.push(expectedAngle)
    }
  }
  elements.push({
    type: "pcb_plated_hole",
    pcb_plated_hole_id: "independent",
    shape: "rotated_pill_hole_with_rect_pad",
    x: 0,
    y: 0,
    hole_width: 0.8,
    hole_height: 1.6,
    rect_pad_width: 2,
    rect_pad_height: 3,
    hole_ccw_rotation: 30,
    rect_ccw_rotation: 70,
  })
  // Plated holes are exported before non-plated holes.
  expectedAngles.splice(10, 0, 120)
  const { pcb } = await extractArchive(elements)
  const pads = pcb.getRecordsByKind("Pad")
  expect(pads).toHaveLength(expectedAngles.length)
  for (const [index, pad] of pads.entries())
    expect(getWorldSlotAngle(pad)).toBeCloseTo(expectedAngles[index]!, 6)
})
