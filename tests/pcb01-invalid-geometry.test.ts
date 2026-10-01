import { expect, test } from "bun:test"
import { CircuitJsonToAltiumConverter } from "../lib"
import { board } from "./fixtures"

test("rejects invalid board geometry instead of silently replacing it", () => {
  const invalidOutlineConverter = new CircuitJsonToAltiumConverter([
    board({
      outline: [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 2 },
        { x: 2, y: 0 },
      ],
    }),
  ])
  expect(() => invalidOutlineConverter.runUntilFinished()).toThrow(
    "pcb_board.outline[1] must contain finite x and y coordinates",
  )

  const invalidCenterConverter = new CircuitJsonToAltiumConverter([
    board({ center: { x: Number.NaN, y: Number.POSITIVE_INFINITY } }),
  ])
  expect(() => invalidCenterConverter.runUntilFinished()).toThrow(
    "pcb_board.center must contain finite x and y coordinates",
  )

  const invalidSizeConverter = new CircuitJsonToAltiumConverter([
    board({ width: -1, height: 0 }),
  ])
  expect(() => invalidSizeConverter.runUntilFinished()).toThrow(
    "pcb_board.width must be a positive finite number",
  )
})
