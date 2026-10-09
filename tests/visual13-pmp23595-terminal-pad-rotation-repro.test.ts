import { expect, test } from "bun:test"
import { parseAltiumBinaryPcbDoc, serializeAltiumPcbToSvg } from "altiumts"
import { type CircuitElement, CircuitJsonToAltiumConverter } from "../lib"
import { createSideBySideSvg } from "./fixtures/create-side-by-side-svg"

const terminalRotations = { T500: 90, T501: 270, T502: 90, T503: 270 }
const sourceBoardMinimum = { x: 792, y: 1438 }
const crops = [
  { name: "upper", x: 2300, y: 3550, width: 1450, height: 950 },
  { name: "lower", x: 1250, y: 1350, width: 1500, height: 1150 },
]

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

test("snapshots terminal pad rotation on the real PMP23595 board from PR #187", async () => {
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
  const originalSvgs = await Promise.all(
    crops.map((crop) =>
      Bun.file(
        new URL(
          `./assets/ti-pmp23595-original-${crop.name}.svg`,
          import.meta.url,
        ),
      ).text(),
    ),
  )
  const outline = pcb.boardGeometry.outline.points
  const shift = {
    x: Math.min(...outline.map((point) => point.x)) - sourceBoardMinimum.x,
    y: Math.min(...outline.map((point) => point.y)) - sourceBoardMinimum.y,
  }
  const rows = crops.map((crop, index) => {
    const height = Math.round((600 * crop.height) / crop.width)
    const sourceCrop = originalSvgs[index]!
    const exportedCrop = serializeAltiumPcbToSvg(pcb, {
      layers: ["MID-LAYER2", "MULTILAYER"],
      width: 600,
      height,
      margin: 0,
      backgroundColor: "#ffffff",
      viewBox: { ...crop, x: crop.x + shift.x, y: crop.y + shift.y },
    })
    let panelIndex = 0
    const rowSvg = createSideBySideSvg(sourceCrop, exportedCrop, {
      source: "Original Altium",
      converted: "Current export",
    }).replace(/<image\b[^>]*\/>/gu, (image) => {
      const id = `panel-${index}-${panelIndex}`
      const x = panelIndex++ * 600
      return `<defs><clipPath id="${id}"><rect x="${x}" y="32" width="600" height="${height}"/></clipPath></defs><g clip-path="url(#${id})">${image}</g>`
    })
    return { height: height + 32, svg: rowSvg }
  })
  const height = rows.reduce((sum, row) => sum + row.height, 0)
  let y = 0
  const images = rows.map((row) => {
    const image = row.svg.replace("<svg ", `<svg x="0" y="${y}" `)
    y += row.height
    return image
  })
  await expect(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}">${images.join("")}</svg>`,
  ).toMatchSvgSnapshot(import.meta.path)
})

test.failing("preserves the imported rotations of real PMP23595 terminals T500–T503", async () => {
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
