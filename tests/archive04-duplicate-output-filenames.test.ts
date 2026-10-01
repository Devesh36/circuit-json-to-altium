import { expect, test } from "bun:test"
import { CircuitJsonToAltiumConverter } from "../lib"

test("rejects duplicate archive filenames before JSZip can overwrite them", async () => {
  const converter = new CircuitJsonToAltiumConverter([
    { type: "pcb_board", width: 20, height: 12 },
  ])
  converter.runUntilFinished()
  const output = converter.getOutput()
  output.schematics[0]!.filename = output.pcb.filename

  await expect(converter.getOutputZip()).rejects.toThrow(
    "Duplicate Altium archive filename: board.PcbDoc",
  )
})
