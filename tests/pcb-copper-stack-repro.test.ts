import { expect, test } from "bun:test"
import { parseAltiumBinaryPcbDoc } from "altiumts"
import { CircuitJsonToAltiumConverter } from "../lib"
import { board } from "./fixtures"

test.failing("preserves a declared four-layer copper stack", () => {
  const converter = new CircuitJsonToAltiumConverter([board({ num_layers: 4 })])
  converter.runUntilFinished()
  const document = parseAltiumBinaryPcbDoc(converter.getOutput().pcb.content)
  expect(document.board?.layerStack.entries).toHaveLength(4)
})
