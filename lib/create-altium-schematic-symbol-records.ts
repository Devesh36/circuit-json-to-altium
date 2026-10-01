import type { SchSymbol, TextPrimitive } from "schematic-symbols"
import { symbols } from "schematic-symbols"
import { compose, translate } from "transformation-matrix"
import {
  type AltiumSchematicSymbolMapping,
  createAltiumSchematicGraphicRecordFields,
  createOwnedSchematicRecordFields,
  transformSchematicSymbolPoint,
} from "./create-altium-schematic-graphic-record-fields"
import { sanitizeField } from "./format"
import type { Point, PointTransform } from "./types"

type AltiumSchematicTextPlacement = {
  justification: number
  position: Point
}

type AltiumSchematicPinGeometry = {
  length: number
  location: Point
}

type SchematicPinLabel = string
type SchematicPinTerminal = string

const ALTIUM_JUSTIFICATION_BY_TEXT_ANCHOR = {
  bottom_left: 0,
  middle_bottom: 1,
  bottom_right: 2,
  middle_left: 3,
  center: 4,
  middle_right: 5,
  top_left: 6,
  middle_top: 7,
  top_right: 8,
} satisfies Record<TextPrimitive["anchor"], number>

export type AltiumSchematicSymbolRecords = {
  commentPlacement?: AltiumSchematicTextPlacement
  designatorPlacement?: AltiumSchematicTextPlacement
  graphicRecordFields: string[][]
  pinGeometryByLabel: Map<SchematicPinLabel, AltiumSchematicPinGeometry>
  pinGeometryByTerminal: Map<SchematicPinTerminal, AltiumSchematicPinGeometry>
}

type CreateAltiumSchematicSymbolRecordsOptions = {
  altiumComponentRecordIndex: number
  circuitComponentCenter: Point
  circuitToAltiumSchematicPoint: PointTransform
  circuitToAltiumSchematicPrecisePoint: PointTransform
  symbolName: string
}

export function createAltiumSchematicSymbolRecords({
  altiumComponentRecordIndex,
  circuitComponentCenter,
  circuitToAltiumSchematicPoint,
  circuitToAltiumSchematicPrecisePoint,
  symbolName,
}: CreateAltiumSchematicSymbolRecordsOptions):
  | AltiumSchematicSymbolRecords
  | undefined {
  const schematicSymbol = findSchematicSymbol(symbolName)
  if (!schematicSymbol) return undefined

  const symbolToCircuitMatrix = compose(
    translate(circuitComponentCenter.x, circuitComponentCenter.y),
    translate(-schematicSymbol.center.x, -schematicSymbol.center.y),
  )
  const roundedAltiumComponentCenter = circuitToAltiumSchematicPoint(
    circuitComponentCenter,
  )
  const preciseAltiumComponentCenter = circuitToAltiumSchematicPrecisePoint(
    circuitComponentCenter,
  )
  const symbolMapping: AltiumSchematicSymbolMapping = {
    altiumComponentRecordIndex,
    circuitToAltiumSchematicPoint,
    // Preserve primitive detail relative to the component's integer-grid
    // origin so paths remain aligned with native Altium pins and text.
    circuitToAltiumSchematicPrecisePoint: (circuitPoint) => {
      const preciseAltiumPoint =
        circuitToAltiumSchematicPrecisePoint(circuitPoint)
      return {
        x:
          preciseAltiumPoint.x +
          roundedAltiumComponentCenter.x -
          preciseAltiumComponentCenter.x,
        y:
          preciseAltiumPoint.y +
          roundedAltiumComponentCenter.y -
          preciseAltiumComponentCenter.y,
      }
    },
    symbolToCircuitMatrix,
  }
  const graphicRecordFields: string[][] = []
  const { pinGeometryByLabel, pinGeometryByTerminal } =
    createAltiumPinGeometryMaps({
      schematicSymbol,
      symbolMapping,
    })
  let commentPlacement: AltiumSchematicTextPlacement | undefined
  let designatorPlacement: AltiumSchematicTextPlacement | undefined

  for (const primitive of schematicSymbol.primitives) {
    if (primitive.type !== "text") {
      graphicRecordFields.push(
        createAltiumSchematicGraphicRecordFields({
          graphicPrimitive: primitive,
          symbolMapping,
        }),
      )
      continue
    }

    const textPlacement = getAltiumTextPlacement({
      symbolMapping,
      textPrimitive: primitive,
    })
    if (primitive.text === "{REF}") {
      designatorPlacement = textPlacement
    } else if (primitive.text === "{VAL}") {
      commentPlacement = textPlacement
    } else {
      graphicRecordFields.push(
        createAltiumTextRecordFields({
          symbolMapping,
          textPrimitive: primitive,
        }),
      )
    }
  }

  return {
    commentPlacement,
    designatorPlacement,
    graphicRecordFields,
    pinGeometryByLabel,
    pinGeometryByTerminal,
  }
}

function getPointKey(point: Point): string {
  return `${point.x}:${point.y}`
}

function createAltiumPinGeometryMaps({
  schematicSymbol,
  symbolMapping,
}: {
  schematicSymbol: SchSymbol
  symbolMapping: AltiumSchematicSymbolMapping
}): Pick<
  AltiumSchematicSymbolRecords,
  "pinGeometryByLabel" | "pinGeometryByTerminal"
> {
  const pinGeometryByLabel = new Map<
    SchematicPinLabel,
    AltiumSchematicPinGeometry
  >()
  const pinGeometryByTerminal = new Map<
    SchematicPinTerminal,
    AltiumSchematicPinGeometry
  >()

  for (const port of schematicSymbol.ports) {
    const connectedPrimitivePoints = schematicSymbol.primitives.flatMap(
      (primitive) => {
        if (primitive.type !== "path" || primitive.points.length < 2) return []
        const firstPoint = primitive.points[0]
        const lastPoint = primitive.points.at(-1)
        if (firstPoint?.x === port.x && firstPoint.y === port.y) {
          return primitive.points[1] ? [primitive.points[1]] : []
        }
        if (lastPoint?.x === port.x && lastPoint.y === port.y) {
          const adjacentPoint = primitive.points.at(-2)
          return adjacentPoint ? [adjacentPoint] : []
        }
        return []
      },
    )
    const bodyPoint = connectedPrimitivePoints.toSorted((left, right) => {
      const leftDistance = Math.hypot(left.x - port.x, left.y - port.y)
      const rightDistance = Math.hypot(right.x - port.x, right.y - port.y)
      return leftDistance - rightDistance
    })[0]
    if (!bodyPoint) continue

    const altiumBodyPoint = transformSchematicSymbolPoint({
      symbolMapping,
      symbolPoint: bodyPoint,
    })
    const altiumTerminalPoint = transformSchematicSymbolPoint({
      symbolMapping,
      symbolPoint: port,
    })
    const pinGeometry = {
      length: Math.max(
        1,
        Math.round(
          Math.hypot(
            altiumTerminalPoint.x - altiumBodyPoint.x,
            altiumTerminalPoint.y - altiumBodyPoint.y,
          ),
        ),
      ),
      location: altiumBodyPoint,
    }
    pinGeometryByTerminal.set(getPointKey(altiumTerminalPoint), pinGeometry)
    for (const label of port.labels) {
      if (!pinGeometryByLabel.has(label)) {
        pinGeometryByLabel.set(label, pinGeometry)
      }
    }
  }

  return { pinGeometryByLabel, pinGeometryByTerminal }
}

function findSchematicSymbol(symbolName: string): SchSymbol | undefined {
  return Object.entries(symbols).find(
    ([registeredSymbolName]) => registeredSymbolName === symbolName,
  )?.[1]
}

function createAltiumTextRecordFields({
  symbolMapping,
  textPrimitive,
}: {
  symbolMapping: AltiumSchematicSymbolMapping
  textPrimitive: TextPrimitive
}): string[] {
  const placement = getAltiumTextPlacement({
    symbolMapping,
    textPrimitive,
  })
  return [
    "RECORD=4",
    ...createOwnedSchematicRecordFields(
      symbolMapping.altiumComponentRecordIndex,
    ),
    `LOCATION.X=${placement.position.x}`,
    `LOCATION.Y=${placement.position.y}`,
    "FONTID=2",
    `TEXT=${sanitizeField(textPrimitive.text)}`,
    "ORIENTATION=0",
    `JUSTIFICATION=${placement.justification}`,
  ]
}

function getAltiumTextPlacement({
  symbolMapping,
  textPrimitive,
}: {
  symbolMapping: AltiumSchematicSymbolMapping
  textPrimitive: TextPrimitive
}): AltiumSchematicTextPlacement {
  return {
    justification: ALTIUM_JUSTIFICATION_BY_TEXT_ANCHOR[textPrimitive.anchor],
    position: transformSchematicSymbolPoint({
      symbolMapping,
      symbolPoint: { x: textPrimitive.x, y: textPrimitive.y },
    }),
  }
}
