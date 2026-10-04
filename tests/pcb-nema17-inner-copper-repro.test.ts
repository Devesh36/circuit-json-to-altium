import { expect, test } from "bun:test"
import { parseAltiumBinaryPcbDoc, serializeAltiumPcbToSvg } from "altiumts"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { CircuitJsonToAltiumConverter } from "../lib"
import type { CircuitElement } from "./fixtures"
import { createSideBySideSvg } from "./fixtures/create-side-by-side-svg"

test("preserves nema17 inner copper tracks", async () => {
  const elements = (await Bun.file(
    new URL("./assets/nema17.circuit.json", import.meta.url),
  ).json()) as CircuitElement[]
  const converter = new CircuitJsonToAltiumConverter(elements, {
    projectName: "nema17",
  })
  converter.runUntilFinished()
  const generated = parseAltiumBinaryPcbDoc(converter.getOutput().pcb.content)
  const originalSvg = await convertCircuitJsonToPcbSvg(
    elements as Parameters<typeof convertCircuitJsonToPcbSvg>[0],
    { matchBoardAspectRatio: true },
  )
  await expect(
    createSideBySideSvg(
      originalSvg,
      serializeAltiumPcbToSvg(generated, { width: 800, height: 800 }),
      { source: "nema17 Circuit JSON", converted: "nema17 Altium" },
    ),
  ).toMatchSvgSnapshot(import.meta.path)
  expect(
    generated.tracks.some((track) => track.get("LAYER") === "MID-LAYER1"),
  ).toBe(true)
  expect(
    generated.tracks.some((track) => track.get("LAYER") === "MID-LAYER2"),
  ).toBe(true)
})
