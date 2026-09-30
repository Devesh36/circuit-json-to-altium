import { expect, test } from "bun:test"
import { parseAltiumBinaryPcbDoc, serializeAltiumPcbToSvg } from "altiumts"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { type CircuitElement, CircuitJsonToAltiumConverter } from "../lib"

const fixtureUrl = new URL(
  "./assets/simplefoc-mini-silkscreen.circuit.json",
  import.meta.url,
)

function exportPcb(elements: CircuitElement[]) {
  const converter = new CircuitJsonToAltiumConverter(elements, {
    projectName: "SimpleFOC Mini silkscreen",
  })
  converter.runUntilFinished()
  return parseAltiumBinaryPcbDoc(converter.getOutput().pcb.content)
}

function createLabeledComparisonSvg(panels: { label: string; svg: string }[]) {
  const panelSize = 800
  const headerHeight = 48
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${panels.length * panelSize}" height="${panelSize + headerHeight}" viewBox="0 0 ${panels.length * panelSize} ${panelSize + headerHeight}">
    <rect width="100%" height="100%" fill="#102020"/>
    ${panels
      .map(
        (
          { label, svg },
          index,
        ) => `<text x="${index * panelSize + 18}" y="34" fill="white" font-family="sans-serif" font-size="25">${label}</text>
      <image x="${index * panelSize}" y="${headerHeight}" width="${panelSize}" height="${panelSize}" href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/>`,
      )
      .join("\n")}
  </svg>`
}

test("preserves silkscreen lines from the real SimpleFOC Mini board", async () => {
  const circuitJson = (await Bun.file(fixtureUrl).json()) as CircuitElement[]
  const sourceLineCount = circuitJson.filter(
    (element) => element.type === "pcb_silkscreen_line",
  ).length
  const sourceGraphicCount = circuitJson.filter(
    (element) => element.type === "pcb_silkscreen_graphic",
  ).length
  expect(sourceLineCount).toBe(105)
  expect(sourceGraphicCount).toBe(3)

  // This filtered export reproduces the exporter behavior before the fix.
  const previousPcb = exportPcb(
    circuitJson.filter((element) => element.type !== "pcb_silkscreen_line"),
  )
  const correctedPcb = exportPcb(circuitJson)
  expect(correctedPcb.getRecordsByKind("Track").length).toBe(
    previousPcb.getRecordsByKind("Track").length + sourceLineCount,
  )
  expect(correctedPcb.getRecordsByKind("Region").length).toBe(
    sourceGraphicCount,
  )

  const sourceSvg = await convertCircuitJsonToPcbSvg(
    circuitJson as Parameters<typeof convertCircuitJsonToPcbSvg>[0],
    { matchBoardAspectRatio: true },
  )
  await expect(
    createLabeledComparisonSvg([
      { label: "Real board in Circuit JSON", svg: sourceSvg },
      {
        label: "Previous export: lines skipped",
        svg: serializeAltiumPcbToSvg(previousPcb),
      },
      {
        label: "Corrected Altium export",
        svg: serializeAltiumPcbToSvg(correctedPcb),
      },
    ]),
  ).toMatchSvgSnapshot(import.meta.path)
})
