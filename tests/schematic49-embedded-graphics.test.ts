import { expect, test } from "bun:test"
import { Resvg } from "@resvg/resvg-js"
import {
  parseAltiumSchDoc,
  serializeAltiumSchDocToBinary,
  serializeAltiumSheetToSvg,
} from "altiumts"
import { CircuitJsonToAltiumConverter } from "../lib"
import { type CircuitElement, expectValidSchematic } from "./fixtures"

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="1" height="1" fill="red"/><rect x="2" y="1" width="1" height="1" fill="blue" fill-opacity="0.5"/></svg>'

function exportGraphic(graphic: CircuitElement) {
  const converter = new CircuitJsonToAltiumConverter([graphic], {
    schematicUnitsPerCircuitUnit: 20,
    schematicSheets: [{ width: 20, height: 15 }],
  })
  converter.runUntilFinished()
  return parseAltiumSchDoc(converter.getOutput().schematics[0]!.content)
}

test("exports the TMDS62LEVM sheet 05 block diagram into native image storage", async () => {
  const circuitJson: CircuitElement[] = await Bun.file(
    new URL("./assets/tmds62levm-sheet05.circuit.json", import.meta.url),
  ).json()
  const converter = new CircuitJsonToAltiumConverter(circuitJson, {
    schematicUnitsPerCircuitUnit: 70.19636363636363,
    schematicSheets: [
      {
        schematicSheetId: "schematic_sheet_altium",
        width: 28.776419394944057,
        height: 21.653543307086615,
        circuitOrigin: { x: 14.388209697472028, y: 10.826771653543307 },
      },
    ],
  })
  converter.runUntilFinished()
  const files = converter.getOutput().schematics
  const root = parseAltiumSchDoc(files[0]!.content)
  const document = parseAltiumSchDoc(files[1]!.content)
  expect(root.embeddedImages).toHaveLength(0)
  expect(document.getRecordsByKind("30")).toHaveLength(1)
  expect(document.embeddedImages).toHaveLength(1)
  const image = document.embeddedImages[0]!
  expect(image.record.getBoolean("EMBEDIMAGE")).toBe(true)
  expect(image.record.getNumber("LOCATION.X")).toBe(0)
  expect(image.record.getNumber("LOCATION.Y")).toBe(0)
  expect(image.record.getNumber("CORNER.X")).toBe(2020)
  expect(image.record.getNumber("CORNER.Y")).toBe(1520)
  expect(image.getBitmapBytes().slice(0, 2)).toEqual(Uint8Array.of(0x42, 0x4d))
  expect(image.getNativePngBytes()).toBeDefined()
  expectValidSchematic(document)

  // Compare decoded native storage with the imported graphic, so a missing
  // payload, flipped bitmap, changed colors, or lost transparency fails.
  const graphic = circuitJson.find(
    (element) => element.type === "schematic_graphic",
  )!
  const expected = new Resvg(graphic.svg_content as string).render()
  const decoded = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2020" height="1520"><image width="2020" height="1520" href="${image.getDataUrl()}"/></svg>`,
  ).render()
  expect(decoded.pixels).toEqual(expected.pixels)
  expect(serializeAltiumSheetToSvg(document)).toContain(
    '<image data-record="30"',
  )
})

test("preserves color, bitmap row padding, and PNG transparency with centered sizing", () => {
  const document = exportGraphic({
    type: "schematic_graphic",
    schematic_graphic_id: "colored-graphic",
    svg_content: svg,
    width: 6,
    height: 4,
  })
  const image = document.embeddedImages[0]!
  const bitmap = image.getBitmapBytes()
  expect([...bitmap.slice(54, 63)]).toEqual([
    255, 255, 255, 255, 255, 255, 255, 127, 127,
  ])
  expect([...bitmap.slice(66, 75)]).toEqual([
    0, 0, 255, 255, 255, 255, 255, 255, 255,
  ])
  expect([
    image.record.getNumber("LOCATION.X"),
    image.record.getNumber("LOCATION.Y"),
  ]).toEqual([140, 110])
  expect([
    image.record.getNumber("CORNER.X"),
    image.record.getNumber("CORNER.Y"),
  ]).toEqual([260, 190])
  const decoded = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><image width="3" height="2" href="${image.getDataUrl()}"/></svg>`,
  ).render()
  expect([...decoded.pixels]).toEqual([
    255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128,
    128,
  ])
  expectValidSchematic(document)
})

test("supports inline SVG asset URLs and reports unavailable graphic sources", () => {
  for (const url of [
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    `data:image/svg+xml,${encodeURIComponent(svg)}`,
  ]) {
    const document = exportGraphic({
      type: "schematic_graphic",
      schematic_graphic_id: "asset-graphic",
      asset: { url, mimetype: "image/svg+xml" },
    })
    expect(document.embeddedImages).toHaveLength(1)
    expectValidSchematic(document)
  }
  expect(() =>
    exportGraphic({
      type: "schematic_graphic",
      schematic_graphic_id: "missing-graphic",
    }),
  ).toThrow('Unable to export schematic graphic "missing-graphic"')
})

test("bounds large raster payloads while preserving the SVG placement aspect ratio", () => {
  const document = exportGraphic({
    type: "schematic_graphic",
    schematic_graphic_id: "large-graphic",
    svg_content:
      '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="2000"><rect width="3000" height="2000" fill="green"/></svg>',
    width: 6,
    height: 4,
  })
  const image = document.embeddedImages[0]!
  const png = image.getNativePngBytes()!
  const header = new DataView(png.buffer, png.byteOffset, png.byteLength)
  expect(header.getUint32(16)).toBe(2048)
  expect(header.getUint32(20)).toBeLessThanOrEqual(2048)
  expect([
    image.record.getNumber("LOCATION.X"),
    image.record.getNumber("LOCATION.Y"),
  ]).toEqual([140, 110])
  expect([
    image.record.getNumber("CORNER.X"),
    image.record.getNumber("CORNER.Y"),
  ]).toEqual([260, 190])
  expect(image.record.getBoolean("KEEPASPECT")).toBe(false)
  expectValidSchematic(document)
})

test("keeps template images alongside generated graphics without filename collisions", () => {
  const templateImage = exportGraphic({
    type: "schematic_graphic",
    schematic_graphic_id: "template-graphic",
    svg_content: svg,
  }).embeddedImages[0]!
  const templateContent = serializeAltiumSchDocToBinary(
    [
      "|RECORD=31|CUSTOMX=400|CUSTOMY=300|USECUSTOMSHEET=T",
      "|RECORD=39|FILENAME=sheet.SchDot",
      "|RECORD=30|OWNERINDEX=1|FILENAME=circuit-graphic-1.png|LOCATION.X=10|LOCATION.Y=10|CORNER.X=20|CORNER.Y=20",
    ].join("\r\n"),
    {
      embeddedImages: [
        {
          name: "circuit-graphic-1.png",
          compressedBytes: templateImage.getCompressedBytes(),
        },
      ],
    },
  )
  const converter = new CircuitJsonToAltiumConverter(
    [
      {
        type: "schematic_graphic",
        schematic_graphic_id: "sheet-graphic",
        svg_content: svg,
      },
    ],
    {
      schematicUnitsPerCircuitUnit: 20,
      schematicSheets: [{ width: 20, height: 15, templateContent }],
    },
  )
  converter.runUntilFinished()
  const document = parseAltiumSchDoc(
    converter.getOutput().schematics[0]!.content,
  )
  expect(document.embeddedImages.map((image) => image.name)).toEqual([
    "circuit-graphic-1.png",
    "circuit-graphic-2.png",
  ])
  expect(document.embeddedImages[0]!.getCompressedBytes()).toEqual(
    templateImage.getCompressedBytes(),
  )
  expectValidSchematic(document)
})
