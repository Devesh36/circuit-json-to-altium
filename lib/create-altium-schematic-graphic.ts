import { deflateSync } from "node:zlib"
import { Resvg } from "@resvg/resvg-js"
import type { AltiumSchematicEmbeddedImageInput } from "altiumts"
import { createAltiumSchematicCoordinateFields } from "./create-altium-schematic-coordinate-fields"
import { asNumber, asString, isCircuitElement } from "./format"
import type { CircuitElement } from "./types"

// Keep both bitmap and PNG payloads within Altium's image decoding limits.
const MAXIMUM_GRAPHIC_RASTER_DIMENSION = 2048

function getGraphicSvg(graphic: CircuitElement): string {
  const inlineSvg = asString(graphic.svg_content)
  const asset = isCircuitElement(graphic.asset) ? graphic.asset : undefined
  const url = asString(asset?.url)
  const match = /^data:image\/svg\+xml((?:;[^,]*)?),(.*)$/isu.exec(url)
  if (!match) {
    if (inlineSvg) return inlineSvg
    throw new Error("Provide svg_content or an inline SVG asset data URL")
  }
  return /;base64$/iu.test(match[1]!)
    ? Buffer.from(match[2]!, "base64").toString("utf8")
    : decodeURIComponent(match[2]!)
}

function createBitmap({
  height,
  pixels,
  width,
}: {
  height: number
  pixels: Uint8Array
  width: number
}): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const bitmap = new Uint8Array(54 + rowSize * height)
  const header = new DataView(bitmap.buffer)
  bitmap.set([0x42, 0x4d])
  header.setUint32(2, bitmap.length, true)
  header.setUint32(10, 54, true)
  header.setUint32(14, 40, true)
  header.setInt32(18, width, true)
  header.setInt32(22, height, true)
  header.setUint16(26, 1, true)
  header.setUint16(28, 24, true)
  header.setUint32(34, rowSize * height, true)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4
      const target = 54 + (height - y - 1) * rowSize + x * 3
      // Resvg exposes premultiplied RGBA. The native bitmap fallback is BGR
      // on white; the accompanying TdxPNGImage retains the original alpha.
      const white = 255 - pixels[source + 3]!
      bitmap[target] = pixels[source + 2]! + white
      bitmap[target + 1] = pixels[source + 1]! + white
      bitmap[target + 2] = pixels[source]! + white
    }
  }
  return bitmap
}

export function createAltiumSchematicGraphic({
  graphic,
  name,
  sheetHeight,
  sheetWidth,
  unitsPerCircuitUnit,
}: {
  graphic: CircuitElement
  name: string
  sheetHeight: number
  sheetWidth: number
  unitsPerCircuitUnit: number
}): {
  embeddedImage: AltiumSchematicEmbeddedImageInput
  recordFields: string[]
} {
  try {
    const svg = getGraphicSvg(graphic)
    let renderer = new Resvg(svg)
    const svgWidth = renderer.width
    const svgHeight = renderer.height
    const maximumDimension = Math.max(svgWidth, svgHeight)
    if (maximumDimension > MAXIMUM_GRAPHIC_RASTER_DIMENSION) {
      renderer = new Resvg(svg, {
        fitTo: {
          mode: "zoom",
          value: MAXIMUM_GRAPHIC_RASTER_DIMENSION / maximumDimension,
        },
      })
    }
    if (renderer.imagesToResolve().length > 0) {
      throw new Error("SVG image references must be embedded data URLs")
    }
    const rendered = renderer.render()
    const bitmap = createBitmap(rendered)
    const className = Buffer.from("TdxPNGImage", "ascii")
    const compressedBytes = deflateSync(
      Buffer.concat([
        bitmap,
        Uint8Array.of(className.length),
        className,
        rendered.asPng(),
      ]),
    )
    const viewportWidth = Math.min(
      asNumber(graphic.width, sheetWidth / unitsPerCircuitUnit) *
        unitsPerCircuitUnit,
      sheetWidth,
    )
    const viewportHeight = Math.min(
      asNumber(graphic.height, sheetHeight / unitsPerCircuitUnit) *
        unitsPerCircuitUnit,
      sheetHeight,
    )
    if (viewportWidth <= 0 || viewportHeight <= 0) {
      throw new Error("Graphic width and height must be positive")
    }
    // schematic_graphic is a centered sheet overlay. Preserve the SVG's
    // aspect ratio within its viewport before converting SVG's downward Y.
    const fit = Math.min(viewportWidth / svgWidth, viewportHeight / svgHeight)
    const width = svgWidth * fit
    const height = svgHeight * fit
    const left = (sheetWidth - width) / 2
    const bottom = (sheetHeight - height) / 2
    return {
      embeddedImage: { compressedBytes, name },
      recordFields: [
        "RECORD=30",
        "OWNERINDEX=-1",
        "OWNERPARTID=-1",
        `FILENAME=${name}`,
        "EMBEDIMAGE=T",
        // Aspect fitting is already applied above, using the SVG dimensions.
        "KEEPASPECT=F",
        ...createAltiumSchematicCoordinateFields("LOCATION.X", left),
        ...createAltiumSchematicCoordinateFields("LOCATION.Y", bottom),
        ...createAltiumSchematicCoordinateFields("CORNER.X", left + width),
        ...createAltiumSchematicCoordinateFields("CORNER.Y", bottom + height),
      ],
    }
  } catch (cause) {
    throw new Error(
      `Unable to export schematic graphic "${asString(graphic.schematic_graphic_id)}": ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    )
  }
}
