import { expect, test } from "bun:test"
import { parseAltiumBinaryPcbDoc, serializeAltiumPcbToSvg } from "altiumts"
import { type CircuitElement, CircuitJsonToAltiumConverter } from "../lib"
import { createSideBySideSvg } from "./fixtures/create-side-by-side-svg"

const terminalRotations = { T500: 90, T501: 270, T502: 90, T503: 270 }
const sourceBoardMinimum = { x: 792, y: 1438 }
const fullBoardViewport = { x: 648, y: 1294, width: 5088, height: 3388 }
const panelWidth = 1000
const panelHeight = Math.round(
  (panelWidth * fullBoardViewport.height) / fullBoardViewport.width,
)

async function exportRealBoard() {
  const circuitJson: CircuitElement[] = await Bun.file(
    new URL("./assets/ti-pmp23595.circuit.json", import.meta.url),
  ).json()
  const converter = new CircuitJsonToAltiumConverter(circuitJson, {
    projectName: "PMP23595",
  })
  converter.runUntilFinished()
  const pcb = parseAltiumBinaryPcbDoc(converter.getOutput().pcb.content)
  const terminalPads = Object.keys(terminalRotations).map((name) => {
    const sourceComponent = circuitJson.find(
      (element) => element.type === "source_component" && element.name === name,
    )!
    const component = circuitJson.find(
      (element) =>
        element.type === "pcb_component" &&
        element.source_component_id === sourceComponent.source_component_id,
    )!
    const sourcePad = circuitJson.find(
      (element) =>
        element.type === "pcb_plated_hole" &&
        element.pcb_component_id === component.pcb_component_id,
    )!
    const exportedPad = pcb
      .getRecordsByKind("Pad")
      .find(
        (pad) =>
          pcb.getComponentForRecord(pad)?.get("SOURCEDESIGNATOR") === name &&
          (pad.getAltiumMeasurement("XSIZE")?.toMillimeters() ?? 0) > 10,
      )!
    return { name, sourcePad, exportedPad }
  })
  return { circuitJson, pcb, terminalPads }
}

test("snapshots the full real PMP23595 board from PR #187", async () => {
  const { circuitJson, pcb, terminalPads } = await exportRealBoard()
  expect(circuitJson).toHaveLength(5170)
  expect(
    Object.fromEntries(
      terminalPads.map(({ name, sourcePad }) => [
        name,
        sourcePad.rect_ccw_rotation,
      ]),
    ),
  ).toEqual(terminalRotations)
  for (const { exportedPad } of terminalPads) {
    expect(
      exportedPad.getAltiumMeasurement("XSIZE")?.toMillimeters(),
    ).toBeCloseTo(17.272, 4)
    expect(
      exportedPad.getAltiumMeasurement("YSIZE")?.toMillimeters(),
    ).toBeCloseTo(12.7, 4)
    expect(
      exportedPad.getAltiumMeasurement("HOLESIZE")?.toMillimeters(),
    ).toBeCloseTo(6.4516, 4)
  }
  const originalSvg = await Bun.file(
    new URL("./assets/ti-pmp23595-original-mid1.svg", import.meta.url),
  ).text()
  const outline = pcb.boardGeometry.outline.points
  const shift = {
    x: Math.min(...outline.map((point) => point.x)) - sourceBoardMinimum.x,
    y: Math.min(...outline.map((point) => point.y)) - sourceBoardMinimum.y,
  }
  const exportedSvg = serializeAltiumPcbToSvg(pcb, {
    layers: ["MID-LAYER2", "MULTILAYER"],
    width: panelWidth,
    height: panelHeight,
    margin: 0,
    backgroundColor: "#ffffff",
    viewBox: {
      ...fullBoardViewport,
      x: fullBoardViewport.x + shift.x,
      y: fullBoardViewport.y + shift.y,
    },
  })
  let panelIndex = 0
  const comparison = createSideBySideSvg(originalSvg, exportedSvg, {
    source: "Original Altium — full PMP23595 board",
    converted: "Current export — full PMP23595 board",
  }).replace(/<image\b[^>]*\/>/gu, (image) => {
    const id = `panel-${panelIndex}`
    const x = panelIndex++ * panelWidth
    return `<defs><clipPath id="${id}"><rect x="${x}" y="32" width="${panelWidth}" height="${panelHeight}"/></clipPath></defs><g clip-path="url(#${id})">${image}</g>`
  })
  await expect(comparison).toMatchSvgSnapshot(import.meta.path)
})

test("preserves the imported rotations of real PMP23595 terminals T500–T503", async () => {
  const { terminalPads } = await exportRealBoard()
  expect(
    Object.fromEntries(
      terminalPads.map(({ name, exportedPad }) => [
        name,
        exportedPad.getNumber("ROTATION") ?? 0,
      ]),
    ),
  ).toEqual(terminalRotations)
})
