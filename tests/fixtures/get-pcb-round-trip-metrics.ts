import { pcb_copper_pour } from "circuit-json"
import type { CircuitElement } from "../../lib/types"

const preservedPrimitiveTypes = [
  "source_net",
  "source_component",
  "pcb_component",
  "source_port",
  "pcb_port",
  "pcb_smtpad",
  "pcb_plated_hole",
  "pcb_hole",
  "source_trace",
  "pcb_trace",
  "pcb_via",
  "pcb_copper_pour",
  "pcb_silkscreen_text",
  "pcb_cutout",
  "pcb_silkscreen_graphic",
  "pcb_courtyard_outline",
  "pcb_keepout",
  "pcb_fabrication_note_path",
  "pcb_fabrication_note_text",
  "pcb_fabrication_note_dimension",
  "pcb_note_path",
  "pcb_note_text",
  "pcb_note_dimension",
  "cad_component",
] as const

const geometryElementTypes = [
  "pcb_component",
  "pcb_smtpad",
  "pcb_plated_hole",
  "pcb_hole",
  "pcb_trace",
  "pcb_via",
  "pcb_silkscreen_text",
] as const

const rotationElementTypes = [
  "pcb_component",
  "pcb_smtpad",
  "pcb_plated_hole",
  "pcb_hole",
  "pcb_silkscreen_text",
] as const

type PreservedPrimitiveType = (typeof preservedPrimitiveTypes)[number]
type GeometryElementType = (typeof geometryElementTypes)[number]
type RotationElementType = (typeof rotationElementTypes)[number]

export type PreservedPrimitiveCounts = Record<PreservedPrimitiveType, number>

export type PcbRoundTripMetrics = {
  cadComponentMismatchCount: number
  copperPourComponentMismatchCount: number
  copperPourCutoutMismatchCount: number
  copperPourSolderMaskMismatchCount: number
  geometryMaxDeltaMm: number
  platedHoleDimensionMismatchCount: number
  rotationMismatchCount: number
  roundTripCounts: PreservedPrimitiveCounts
  roundTripSourceNetNames: string[]
  sourceCounts: PreservedPrimitiveCounts
  sourceNetNames: string[]
  sourcePrimitiveTotal: number
  silkscreenTextMismatchCount: number
  sourceComponentCopperPourCount: number
  sourceCopperPourCutoutCount: number
}

function getCopperPourCutoutCounts(circuitJson: CircuitElement[]): number[] {
  return circuitJson.flatMap((element) => {
    if (element.type !== "pcb_copper_pour") return []
    const copperPour = pcb_copper_pour.parse(element)
    return [
      copperPour.shape === "brep"
        ? copperPour.brep_shape.inner_rings.length
        : 0,
    ]
  })
}

function getCopperPourCutoutMismatchCount(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  const sourceCounts = getCopperPourCutoutCounts(sourceCircuitJson)
  const roundTripCounts = getCopperPourCutoutCounts(roundTripCircuitJson)
  if (sourceCounts.length !== roundTripCounts.length) {
    return Number.POSITIVE_INFINITY
  }
  return sourceCounts.reduce(
    (mismatchCount, count, index) =>
      mismatchCount + (count === roundTripCounts[index] ? 0 : 1),
    0,
  )
}

function getCopperPourSolderMaskMismatchCount(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  const getCoverage = (circuitJson: CircuitElement[]): boolean[] => {
    const coverage: boolean[] = []
    for (const element of circuitJson) {
      if (
        element.type === "pcb_copper_pour" &&
        typeof element.covered_with_solder_mask === "boolean"
      ) {
        coverage.push(element.covered_with_solder_mask)
      }
    }
    return coverage
  }
  const sourceCoverage = getCoverage(sourceCircuitJson)
  const roundTripCoverage = getCoverage(roundTripCircuitJson)
  if (sourceCoverage.length !== roundTripCoverage.length) {
    return Number.POSITIVE_INFINITY
  }
  return sourceCoverage.reduce(
    (mismatchCount, isCovered, index) =>
      mismatchCount + (isCovered === roundTripCoverage[index] ? 0 : 1),
    0,
  )
}

function getCopperPourComponentMismatchCount(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  const sourceComponentIds = sourceCircuitJson.flatMap((element) =>
    element.type === "pcb_copper_pour" &&
    typeof element.pcb_component_id === "string"
      ? [element.pcb_component_id]
      : [],
  )
  const roundTripComponentIds = roundTripCircuitJson.flatMap((element) =>
    element.type === "pcb_copper_pour" &&
    typeof element.pcb_component_id === "string"
      ? [element.pcb_component_id]
      : [],
  )
  if (sourceComponentIds.length !== roundTripComponentIds.length) {
    return Number.POSITIVE_INFINITY
  }
  return sourceComponentIds.reduce(
    (mismatchCount, componentId, index) =>
      mismatchCount + (componentId === roundTripComponentIds[index] ? 0 : 1),
    0,
  )
}

const platedHoleDimensionFields = [
  ["hole_width"],
  ["hole_height"],
  ["outer_width", "rect_pad_width"],
  ["outer_height", "rect_pad_height"],
] as const

function getPlatedHoleDimensionMismatchCount(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  const sourceHoles = sourceCircuitJson.filter(
    (element) => element.type === "pcb_plated_hole",
  )
  const roundTripHoles = roundTripCircuitJson.filter(
    (element) => element.type === "pcb_plated_hole",
  )
  if (sourceHoles.length !== roundTripHoles.length) {
    return Number.POSITIVE_INFINITY
  }
  return sourceHoles.reduce((mismatchCount, sourceHole, holeIndex) => {
    const roundTripHole = roundTripHoles[holeIndex]
    if (!roundTripHole) return mismatchCount + 1
    const dimensionsMatch = platedHoleDimensionFields.every((fieldNames) => {
      const sourceDimension = fieldNames
        .map((field) => sourceHole[field])
        .find((value) => typeof value === "number")
      const roundTripDimension = fieldNames
        .map((field) => roundTripHole[field])
        .find((value) => typeof value === "number")
      return (
        typeof sourceDimension === "number" &&
        typeof roundTripDimension === "number" &&
        Math.abs(sourceDimension - roundTripDimension) <= 0.0001
      )
    })
    return mismatchCount + (dimensionsMatch ? 0 : 1)
  }, 0)
}

function getPoint3(
  input: unknown,
): { x: number; y: number; z: number } | undefined {
  if (
    typeof input !== "object" ||
    input === null ||
    !("x" in input) ||
    !("y" in input) ||
    !("z" in input) ||
    typeof input.x !== "number" ||
    typeof input.y !== "number" ||
    typeof input.z !== "number"
  ) {
    return undefined
  }
  return { x: input.x, y: input.y, z: input.z }
}

function getPoint2(input: unknown): { x: number; y: number } | undefined {
  if (
    typeof input !== "object" ||
    input === null ||
    !("x" in input) ||
    !("y" in input) ||
    typeof input.x !== "number" ||
    typeof input.y !== "number"
  ) {
    return undefined
  }
  return { x: input.x, y: input.y }
}

function point3Matches(
  sourcePointInput: unknown,
  roundTripPointInput: unknown,
): boolean {
  const sourcePoint = getPoint3(sourcePointInput)
  const roundTripPoint = getPoint3(roundTripPointInput)
  if (!sourcePoint || !roundTripPoint) {
    return sourcePointInput === roundTripPointInput
  }
  return (
    Math.abs(sourcePoint.x - roundTripPoint.x) <= 0.0001 &&
    Math.abs(sourcePoint.y - roundTripPoint.y) <= 0.0001 &&
    Math.abs(sourcePoint.z - roundTripPoint.z) <= 0.0001
  )
}

function getCadComponentLocalPosition({
  cadComponent,
  circuitJson,
}: {
  cadComponent: CircuitElement
  circuitJson: CircuitElement[]
}): { x: number; y: number; z: number } | undefined {
  const position = getPoint3(cadComponent.position)
  if (!position || typeof cadComponent.pcb_component_id !== "string") {
    return undefined
  }
  const pcbComponent = circuitJson.find(
    (element) =>
      element.type === "pcb_component" &&
      element.pcb_component_id === cadComponent.pcb_component_id,
  )
  const componentCenter = getPoint2(pcbComponent?.center)
  if (!componentCenter) return undefined
  return {
    x: position.x - componentCenter.x,
    y: position.y - componentCenter.y,
    z: position.z,
  }
}

function getCadComponentMismatchCount(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  const sourceCadComponents = sourceCircuitJson.filter(
    (element) => element.type === "cad_component",
  )
  const roundTripCadComponents = roundTripCircuitJson.filter(
    (element) => element.type === "cad_component",
  )
  if (sourceCadComponents.length !== roundTripCadComponents.length) {
    return Number.POSITIVE_INFINITY
  }

  return sourceCadComponents.reduce(
    (mismatchCount, sourceCadComponent, bodyIndex) => {
      const roundTripCadComponent = roundTripCadComponents[bodyIndex]
      if (!roundTripCadComponent) return mismatchCount + 1
      const matches =
        point3Matches(
          getCadComponentLocalPosition({
            cadComponent: sourceCadComponent,
            circuitJson: sourceCircuitJson,
          }),
          getCadComponentLocalPosition({
            cadComponent: roundTripCadComponent,
            circuitJson: roundTripCircuitJson,
          }),
        ) &&
        point3Matches(
          sourceCadComponent.rotation,
          roundTripCadComponent.rotation,
        ) &&
        point3Matches(sourceCadComponent.size, roundTripCadComponent.size) &&
        sourceCadComponent.layer === roundTripCadComponent.layer &&
        sourceCadComponent.show_as_translucent_model ===
          roundTripCadComponent.show_as_translucent_model
      return mismatchCount + (matches ? 0 : 1)
    },
    0,
  )
}

function getSourceNetNames(circuitJson: CircuitElement[]): string[] {
  return circuitJson.flatMap((element) => {
    if (element.type !== "source_net" || typeof element.name !== "string") {
      return []
    }
    return [element.name]
  })
}

function countPreservedPrimitives(
  circuitJson: CircuitElement[],
): PreservedPrimitiveCounts {
  const counts = Object.fromEntries(
    preservedPrimitiveTypes.map((type) => [
      type,
      circuitJson.filter((element) => element.type === type).length,
    ]),
  )
  return counts as PreservedPrimitiveCounts
}

function getGeometryPoints(
  circuitJson: CircuitElement[],
  elementType: GeometryElementType,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = []
  for (const element of circuitJson) {
    if (element.type !== elementType) continue
    if (elementType === "pcb_trace" && Array.isArray(element.route)) {
      for (const routePoint of element.route) {
        if (
          typeof routePoint === "object" &&
          routePoint !== null &&
          "x" in routePoint &&
          "y" in routePoint &&
          typeof routePoint.x === "number" &&
          typeof routePoint.y === "number"
        ) {
          points.push({ x: routePoint.x, y: routePoint.y })
        }
      }
      continue
    }
    if (
      elementType === "pcb_component" &&
      typeof element.center === "object" &&
      element.center !== null &&
      "x" in element.center &&
      "y" in element.center &&
      typeof element.center.x === "number" &&
      typeof element.center.y === "number"
    ) {
      points.push({ x: element.center.x, y: element.center.y })
      continue
    }
    if (
      elementType === "pcb_silkscreen_text" &&
      typeof element.anchor_position === "object" &&
      element.anchor_position !== null &&
      "x" in element.anchor_position &&
      "y" in element.anchor_position &&
      typeof element.anchor_position.x === "number" &&
      typeof element.anchor_position.y === "number"
    ) {
      points.push({
        x: element.anchor_position.x,
        y: element.anchor_position.y,
      })
      continue
    }
    if (
      elementType !== "pcb_component" &&
      elementType !== "pcb_trace" &&
      elementType !== "pcb_silkscreen_text" &&
      typeof element.x === "number" &&
      typeof element.y === "number"
    ) {
      points.push({ x: element.x, y: element.y })
    }
  }
  return points
}

function getSilkscreenTextMismatchCount(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  const sourceTexts = sourceCircuitJson.filter(
    (element) => element.type === "pcb_silkscreen_text",
  )
  const roundTripTexts = roundTripCircuitJson.filter(
    (element) => element.type === "pcb_silkscreen_text",
  )
  if (sourceTexts.length !== roundTripTexts.length) {
    return Number.POSITIVE_INFINITY
  }

  return sourceTexts.reduce((mismatchCount, sourceText, index) => {
    const roundTripText = roundTripTexts[index]
    if (!roundTripText) return mismatchCount + 1
    const matches =
      sourceText.text === roundTripText.text &&
      sourceText.anchor_alignment === roundTripText.anchor_alignment &&
      sourceText.is_mirrored === roundTripText.is_mirrored &&
      sourceText.layer === roundTripText.layer
    return mismatchCount + (matches ? 0 : 1)
  }, 0)
}

function getGeometryMaxDeltaMm(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  let maxDeltaMm = 0
  for (const elementType of geometryElementTypes) {
    const sourcePoints = getGeometryPoints(sourceCircuitJson, elementType)
    const roundTripPoints = getGeometryPoints(roundTripCircuitJson, elementType)
    const sourceAnchor = sourcePoints[0]
    const roundTripAnchor = roundTripPoints[0]
    if (sourcePoints.length !== roundTripPoints.length) {
      return Number.POSITIVE_INFINITY
    }
    if (!sourceAnchor || !roundTripAnchor) continue

    for (const [index, sourcePoint] of sourcePoints.entries()) {
      const roundTripPoint = roundTripPoints[index]
      if (!roundTripPoint) return Number.POSITIVE_INFINITY
      maxDeltaMm = Math.max(
        maxDeltaMm,
        Math.abs(
          sourcePoint.x -
            sourceAnchor.x -
            (roundTripPoint.x - roundTripAnchor.x),
        ),
        Math.abs(
          sourcePoint.y -
            sourceAnchor.y -
            (roundTripPoint.y - roundTripAnchor.y),
        ),
      )
    }
  }
  return maxDeltaMm
}

function getCcwRotationsDegrees(
  circuitJson: CircuitElement[],
  elementType: RotationElementType,
): number[] {
  return circuitJson
    .filter((element) => element.type === elementType)
    .flatMap((element) => {
      const ccwRotationDegrees = element.rotation ?? element.ccw_rotation ?? 0
      return typeof ccwRotationDegrees === "number" ? [ccwRotationDegrees] : []
    })
}

function getRotationMismatchCount(
  sourceCircuitJson: CircuitElement[],
  roundTripCircuitJson: CircuitElement[],
): number {
  let mismatchCount = 0
  for (const elementType of rotationElementTypes) {
    const sourceCcwRotationsDegrees = getCcwRotationsDegrees(
      sourceCircuitJson,
      elementType,
    )
    const roundTripCcwRotationsDegrees = getCcwRotationsDegrees(
      roundTripCircuitJson,
      elementType,
    )
    if (
      sourceCcwRotationsDegrees.length !== roundTripCcwRotationsDegrees.length
    ) {
      return Number.POSITIVE_INFINITY
    }
    mismatchCount += sourceCcwRotationsDegrees.reduce(
      (typeMismatchCount, ccwRotationDegrees, index) => {
        const roundTripCcwRotationDegrees =
          roundTripCcwRotationsDegrees[index] ?? 0
        return (
          typeMismatchCount +
          (getCircularRotationDeltaDegrees(
            ccwRotationDegrees,
            roundTripCcwRotationDegrees,
          ) <= 0.0001
            ? 0
            : 1)
        )
      },
      0,
    )
  }
  return mismatchCount
}

function getCircularRotationDeltaDegrees(
  firstCcwRotationDegrees: number,
  secondCcwRotationDegrees: number,
): number {
  const linearDeltaDegrees =
    Math.abs(firstCcwRotationDegrees - secondCcwRotationDegrees) % 360
  return Math.min(linearDeltaDegrees, 360 - linearDeltaDegrees)
}

export function getPcbRoundTripMetrics({
  roundTripCircuitJson,
  sourceCircuitJson,
}: {
  roundTripCircuitJson: CircuitElement[]
  sourceCircuitJson: CircuitElement[]
}): PcbRoundTripMetrics {
  const sourceCounts = countPreservedPrimitives(sourceCircuitJson)
  const roundTripCounts = countPreservedPrimitives(roundTripCircuitJson)

  return {
    cadComponentMismatchCount: getCadComponentMismatchCount(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    copperPourComponentMismatchCount: getCopperPourComponentMismatchCount(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    copperPourCutoutMismatchCount: getCopperPourCutoutMismatchCount(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    copperPourSolderMaskMismatchCount: getCopperPourSolderMaskMismatchCount(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    geometryMaxDeltaMm: getGeometryMaxDeltaMm(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    platedHoleDimensionMismatchCount: getPlatedHoleDimensionMismatchCount(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    rotationMismatchCount: getRotationMismatchCount(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    roundTripCounts,
    roundTripSourceNetNames: getSourceNetNames(roundTripCircuitJson),
    sourceCounts,
    sourceNetNames: getSourceNetNames(sourceCircuitJson),
    sourcePrimitiveTotal: Object.values(sourceCounts).reduce(
      (sum, count) => sum + count,
      0,
    ),
    silkscreenTextMismatchCount: getSilkscreenTextMismatchCount(
      sourceCircuitJson,
      roundTripCircuitJson,
    ),
    sourceComponentCopperPourCount: sourceCircuitJson.filter(
      (element) =>
        element.type === "pcb_copper_pour" &&
        typeof element.pcb_component_id === "string",
    ).length,
    sourceCopperPourCutoutCount: getCopperPourCutoutCounts(
      sourceCircuitJson,
    ).reduce((total, count) => total + count, 0),
  }
}
