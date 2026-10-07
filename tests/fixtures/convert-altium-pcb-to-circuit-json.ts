import {
  type AltiumBounds,
  type AltiumComponentRecord,
  type AltiumNetRecord,
  type AltiumPcbDocument,
  type AltiumPoint,
  type AltiumRecord,
  getPcbContour,
  getPcbRecordPolygonIndex,
  getPcbRegionGeometry,
  getPcbRegionSemanticKind,
  normalizeAltiumAngle,
  parseAltiumMeasurementToMils,
} from "altiumts"
import type { NinePointAnchor } from "circuit-json"
import type { CircuitElement } from "../../lib/types"
import { convertAltiumPcbAnnotationsToCircuitJson } from "./convert-altium-pcb-annotations-to-circuit-json"
import { convertAltiumPcbComponentBodiesToCircuitJson } from "./convert-altium-pcb-component-bodies-to-circuit-json"

const MILLIMETERS_PER_MIL = 0.0254

type CircuitPoint = {
  x: number
  y: number
}

type CircuitCopperLayer =
  | "bottom"
  | "inner1"
  | "inner2"
  | "inner3"
  | "inner4"
  | "inner5"
  | "inner6"
  | "inner7"
  | "inner8"
  | "top"

const CIRCUIT_INNER_COPPER_LAYERS = [
  "inner1",
  "inner2",
  "inner3",
  "inner4",
  "inner5",
  "inner6",
  "inner7",
  "inner8",
] as const

type SourceNetLookupContext = {
  document: AltiumPcbDocument
  sourceNetIds: Map<AltiumNetRecord, string>
}

function toCircuitPoint(point: AltiumPoint): CircuitPoint {
  return {
    x: point.x * MILLIMETERS_PER_MIL,
    y: point.y * MILLIMETERS_PER_MIL,
  }
}

function toCircuitLength(mils: number): number {
  return mils * MILLIMETERS_PER_MIL
}

function getMeasurementMils(
  record: AltiumRecord,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = parseAltiumMeasurementToMils(record.getCaseInsensitive(key))
    if (value !== undefined) return value
  }
  return undefined
}

function getPoint(
  record: AltiumRecord,
  xKey: string,
  yKey: string,
): AltiumPoint | undefined {
  const x = getMeasurementMils(record, xKey)
  const y = getMeasurementMils(record, yKey)
  return x === undefined || y === undefined ? undefined : { x, y }
}

function toCircuitRotation(altiumCcwDegrees: number): number {
  return normalizeAltiumAngle(altiumCcwDegrees)
}

function normalizeLayer(layer: string | undefined): string {
  return layer?.replace(/[\s_-]+/gu, "").toUpperCase() ?? ""
}

function toCircuitLayer(layer: string | undefined): "bottom" | "top" {
  return normalizeLayer(layer).includes("BOTTOM") ? "bottom" : "top"
}

function toCircuitTextAnchorAlignment(
  altiumJustification: number | undefined,
): NinePointAnchor {
  switch (altiumJustification) {
    case 1:
      return "top_left"
    case 2:
      return "center_left"
    case 4:
      return "top_center"
    case 5:
      return "center"
    case 6:
      return "bottom_center"
    case 7:
      return "top_right"
    case 8:
      return "center_right"
    case 9:
      return "bottom_right"
    default:
      return "bottom_left"
  }
}

function toCircuitCopperLayer(
  layer: string | undefined,
): CircuitCopperLayer | undefined {
  const normalized = normalizeLayer(layer)
  if (normalized === "TOP") return "top"
  if (normalized === "BOTTOM") return "bottom"
  const innerLayerMatch = /^MIDLAYER([1-8])$/u.exec(normalized)
  if (!innerLayerMatch?.[1]) return undefined
  return CIRCUIT_INNER_COPPER_LAYERS[Number(innerLayerMatch[1]) - 1]
}

function isCopperLayer(layer: string | undefined): boolean {
  const normalized = normalizeLayer(layer)
  return (
    normalized === "TOP" ||
    normalized === "BOTTOM" ||
    normalized.startsWith("MIDLAYER") ||
    normalized.startsWith("INTERNALPLANE")
  )
}

function isOverlayLayer(layer: string | undefined): boolean {
  const normalized = normalizeLayer(layer)
  return normalized === "TOPOVERLAY" || normalized === "BOTTOMOVERLAY"
}

function toCircuitPadShape(
  shape: string | undefined,
  alternateShape?: string,
): "circle" | "rect" {
  if (alternateShape?.toUpperCase() === "ROUNDRECT") return "rect"
  const normalized = shape?.toUpperCase() ?? ""
  return normalized === "ROUND" || normalized.includes("CIRCLE")
    ? "circle"
    : "rect"
}

function getPadAlternateShape(pad: AltiumRecord): string | undefined {
  const layerOrdinal =
    normalizeLayer(pad.getDecoded("LAYER")) === "BOTTOM" ? 31 : 0
  return pad.getDecoded(`LAYER${layerOrdinal}ALTSHAPE`)
}

function getCircuitPadCornerRadius(
  pad: AltiumRecord,
  widthMils: number,
  heightMils: number,
): number | undefined {
  const baseShape = pad.getDecoded("SHAPE")?.toUpperCase()
  const alternateShape = getPadAlternateShape(pad)?.toUpperCase()
  if (baseShape !== "ROUNDRECT" && alternateShape !== "ROUNDRECT") {
    return undefined
  }
  const layerOrdinal =
    normalizeLayer(pad.getDecoded("LAYER")) === "BOTTOM" ? 31 : 0
  const cornerRadiusPercent = Math.min(
    100,
    Math.max(0, pad.getNumber(`LAYER${layerOrdinal}CORNERRADIUS`) ?? 100),
  )
  return toCircuitLength(
    (Math.min(widthMils, heightMils) * cornerRadiusPercent) / 200,
  )
}

function createArcPoints(record: AltiumRecord): AltiumPoint[] {
  const center =
    getPoint(record, "LOCATION.X", "LOCATION.Y") ?? getPoint(record, "X", "Y")
  const radius = getMeasurementMils(record, "RADIUS")
  if (!center || radius === undefined || radius <= 0) return []

  const startAngle = record.getNumber("STARTANGLE") ?? 0
  const endAngle = record.getNumber("ENDANGLE") ?? 360
  const sweep = (endAngle - startAngle + 360) % 360 || 360
  const segmentCount = Math.max(8, Math.ceil(sweep / 7.5))

  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + (sweep * index) / segmentCount
    const radians = (angle * Math.PI) / 180
    return {
      x: center.x + Math.cos(radians) * radius,
      y: center.y + Math.sin(radians) * radius,
    }
  })
}

function getText(record: AltiumRecord): string {
  const wideString = record.getDecoded("WIDESTRING")
  if (!wideString) return record.getDecoded("TEXT") ?? ""
  if (!/^\d+(?:,\d+)*$/u.test(wideString)) return wideString

  try {
    return String.fromCodePoint(
      ...wideString.split(",").map((codePoint) => Number(codePoint)),
    )
  } catch {
    return wideString
  }
}

function getComponentIds(
  document: AltiumPcbDocument,
): Map<AltiumComponentRecord, string> {
  return new Map(
    document.components.map((component, index) => [
      component,
      `pcb_component_${index}`,
    ]),
  )
}

function getOwnedComponentId(
  document: AltiumPcbDocument,
  componentIds: ReadonlyMap<AltiumComponentRecord, string>,
  record: AltiumRecord,
): string | undefined {
  const component = document.getComponentForRecord(record)
  return component ? componentIds.get(component) : undefined
}

function isVisibleComponentText(
  document: AltiumPcbDocument,
  text: AltiumRecord,
): boolean {
  const component = document.getComponentForRecord(text)
  if (!component) return true
  if (
    text.getBoolean("DESIGNATOR") === true &&
    component.getBoolean("NAMEON") === false
  ) {
    return false
  }
  if (
    text.getBoolean("COMMENT") === true &&
    component.getBoolean("COMMENTON") === false
  ) {
    return false
  }
  return true
}

function appendNetConnection(
  elements: CircuitElement[],
  sourceTraceId: string,
  sourceNetId: string | undefined,
  sourcePortId?: string,
): void {
  elements.push({
    type: "source_trace",
    source_trace_id: sourceTraceId,
    ...(sourceNetId ? { connected_source_net_ids: [sourceNetId] } : {}),
    ...(sourcePortId ? { connected_source_port_ids: [sourcePortId] } : {}),
  })
}

function appendCopperTrace(
  elements: CircuitElement[],
  sourceTraceId: string,
  sourceNetId: string | undefined,
  layer: "bottom" | "top",
  widthMils: number,
  start: AltiumPoint,
  end: AltiumPoint,
): void {
  appendNetConnection(elements, sourceTraceId, sourceNetId)
  elements.push({
    type: "pcb_trace",
    pcb_trace_id: sourceTraceId.replace("source_trace", "pcb_trace"),
    source_trace_id: sourceTraceId,
    route: [start, end].map((point) => ({
      ...toCircuitPoint(point),
      layer,
      route_type: "wire",
      width: toCircuitLength(widthMils),
    })),
  })
}

function getSourceNetId(
  record: AltiumRecord,
  context: SourceNetLookupContext,
): string | undefined {
  const net = context.document.getNetForRecord(record)
  return net ? context.sourceNetIds.get(net) : undefined
}

function toCircuitBrepRing(points: AltiumPoint[]): CircuitPoint[] {
  const ring = points.map(toCircuitPoint)
  const firstPoint = ring[0]
  const lastPoint = ring.at(-1)
  if (
    firstPoint &&
    lastPoint &&
    firstPoint.x === lastPoint.x &&
    firstPoint.y === lastPoint.y
  ) {
    ring.pop()
  }
  return ring
}

function areAltiumPointsEquivalent(
  left: AltiumPoint,
  right: AltiumPoint,
): boolean {
  return (
    Math.abs(left.x - right.x) <= 0.001 && Math.abs(left.y - right.y) <= 0.001
  )
}

function removeClosingAltiumPoint(points: AltiumPoint[]): AltiumPoint[] {
  const ring = [...points]
  const firstPoint = ring[0]
  const lastPoint = ring.at(-1)
  if (
    firstPoint &&
    lastPoint &&
    areAltiumPointsEquivalent(firstPoint, lastPoint)
  ) {
    ring.pop()
  }
  return ring
}

function areAltiumContoursEquivalent(
  leftPoints: AltiumPoint[],
  rightPoints: AltiumPoint[],
): boolean {
  const left = removeClosingAltiumPoint(leftPoints)
  const right = removeClosingAltiumPoint(rightPoints)
  if (left.length === 0 || left.length !== right.length) return false

  return right.some((rightStart, rightStartIndex) => {
    if (!areAltiumPointsEquivalent(left[0]!, rightStart)) return false
    return [1, -1].some((direction) =>
      left.every((leftPoint, pointIndex) => {
        const rightIndex =
          (rightStartIndex + direction * pointIndex + right.length) %
          right.length
        return areAltiumPointsEquivalent(leftPoint, right[rightIndex]!)
      }),
    )
  })
}

function getPolygonCutoutRings({
  copperBounds,
  copperRecord,
  document,
}: {
  copperBounds: AltiumBounds | undefined
  copperRecord: AltiumRecord
  document: AltiumPcbDocument
}): CircuitPoint[][] {
  const polygonIndex = getPcbRecordPolygonIndex(document, copperRecord)
  if (!copperBounds) return []

  return document.boardGeometry.polygonCutouts.flatMap((cutoutGeometry) => {
    const cutoutBounds = cutoutGeometry.outline.bounds
    const cutoutPolygonIndex = getPcbRecordPolygonIndex(
      document,
      cutoutGeometry.record,
    )
    const hasMatchingOwner =
      cutoutPolygonIndex === undefined
        ? cutoutGeometry.record.getDecoded("LAYER") ===
          copperRecord.getDecoded("LAYER")
        : cutoutPolygonIndex === polygonIndex
    if (
      !hasMatchingOwner ||
      !cutoutBounds ||
      cutoutBounds.minX < copperBounds.minX ||
      cutoutBounds.minY < copperBounds.minY ||
      cutoutBounds.maxX > copperBounds.maxX ||
      cutoutBounds.maxY > copperBounds.maxY
    ) {
      return []
    }
    return [toCircuitBrepRing(cutoutGeometry.outline.points)]
  })
}

function appendCopperPourElements({
  componentIds,
  document,
  elements,
  sourceNetLookupContext,
}: {
  componentIds: ReadonlyMap<AltiumComponentRecord, string>
  document: AltiumPcbDocument
  elements: CircuitElement[]
  sourceNetLookupContext: SourceNetLookupContext
}): void {
  const solderMaskRegions = document
    .getRecordsByKind("Region")
    .filter((record) => isSolderMaskLayer(record.getDecoded("LAYER")))
  const copperRegions = [
    ...document.getRecordsByKind("Region"),
    ...document.getRecordsByKind("RegionFill"),
  ].filter(
    (record) =>
      getPcbRegionSemanticKind(record) === "COPPER" &&
      record.getBoolean("KEEPOUT") !== true &&
      toCircuitCopperLayer(record.getDecoded("LAYER")) !== undefined,
  )
  const polygonRegionsById = new Map<number, AltiumRecord[]>()
  for (const region of copperRegions) {
    const polygonId = region.getNumber("POLYGON")
    if (polygonId === undefined || polygonId === 65_535) continue
    polygonRegionsById.set(polygonId, [
      ...(polygonRegionsById.get(polygonId) ?? []),
      region,
    ])
  }
  const preservedPolygonIds = new Set(
    document.polygons.flatMap((polygon, polygonIndex) => {
      const polygonId = polygon.getNumber("ID") ?? polygonIndex
      const polygonPoints = getPcbContour(polygon).points
      const hasMatchingRegion = (polygonRegionsById.get(polygonId) ?? []).some(
        (region) =>
          areAltiumContoursEquivalent(
            polygonPoints,
            getPcbRegionGeometry(region).outline.points,
          ),
      )
      return hasMatchingRegion ? [] : [polygonId]
    }),
  )
  for (const [regionIndex, region] of copperRegions.entries()) {
    const layer = toCircuitCopperLayer(region.getDecoded("LAYER"))
    const geometry = getPcbRegionGeometry(region)
    if (!layer || geometry.outline.points.length < 3) continue
    const sourceNetId = getSourceNetId(region, sourceNetLookupContext)
    const pcbComponentId = getOwnedComponentId(document, componentIds, region)
    const polygonId = region.getNumber("POLYGON")
    const belongsToPolygon =
      polygonId !== undefined &&
      preservedPolygonIds.has(polygonId) &&
      !pcbComponentId
    const polygonCutoutRings = getPolygonCutoutRings({
      copperBounds: geometry.outline.bounds,
      copperRecord: region,
      document,
    })
    elements.push({
      type: "pcb_copper_pour",
      pcb_copper_pour_id: `pcb_copper_pour_region_${regionIndex}`,
      ...(sourceNetId ? { source_net_id: sourceNetId } : {}),
      ...(pcbComponentId ? { pcb_component_id: pcbComponentId } : {}),
      ...(belongsToPolygon
        ? { altium_polygon_id: polygonId, altium_polygon_role: "region" }
        : {}),
      ...(polygonCutoutRings.length > 0
        ? { altium_polygon_cutout_count: polygonCutoutRings.length }
        : {}),
      covered_with_solder_mask: !hasMatchingSolderMaskOpening({
        componentIds,
        copperRegion: region,
        document,
        solderMaskRegions,
      }),
      shape: "brep",
      brep_shape: {
        outer_ring: {
          vertices: toCircuitBrepRing(geometry.outline.points),
        },
        inner_rings: [
          ...geometry.holes.map((hole) => toCircuitBrepRing(hole.points)),
          ...polygonCutoutRings,
        ].map((vertices) => ({ vertices })),
      },
      layer,
    })
  }

  for (const [polygonIndex, polygon] of document.polygons.entries()) {
    const polygonId = polygon.getNumber("ID") ?? polygonIndex
    if (!preservedPolygonIds.has(polygonId)) continue
    const layer = toCircuitCopperLayer(polygon.layer)
    const polygonContour = getPcbContour(polygon)
    const points = toCircuitBrepRing(polygonContour.points)
    if (!layer || points.length < 3) continue
    const sourceNetId = getSourceNetId(polygon, sourceNetLookupContext)
    const polygonCutoutRings = getPolygonCutoutRings({
      copperBounds: polygonContour.bounds,
      copperRecord: polygon,
      document,
    })
    elements.push({
      type: "pcb_copper_pour",
      pcb_copper_pour_id: `pcb_copper_pour_polygon_${polygonIndex}`,
      altium_polygon_id: polygonId,
      altium_polygon_role: "outline",
      ...(sourceNetId ? { source_net_id: sourceNetId } : {}),
      ...(polygonCutoutRings.length > 0
        ? { altium_polygon_cutout_count: polygonCutoutRings.length }
        : {}),
      covered_with_solder_mask: true,
      ...(polygonCutoutRings.length === 0
        ? { shape: "polygon", points }
        : {
            shape: "brep",
            brep_shape: {
              outer_ring: { vertices: points },
              inner_rings: polygonCutoutRings.map((vertices) => ({
                vertices,
              })),
            },
          }),
      layer,
    })
  }

  const copperFills = document
    .getRecordsByKind("Fill")
    .filter(
      (fill) =>
        fill.getBoolean("KEEPOUT") !== true &&
        toCircuitCopperLayer(fill.getDecoded("LAYER")) !== undefined,
    )
  for (const [fillIndex, fill] of copperFills.entries()) {
    const start = getPoint(fill, "X1", "Y1")
    const end = getPoint(fill, "X2", "Y2")
    const layer = toCircuitCopperLayer(fill.getDecoded("LAYER"))
    if (!start || !end || !layer) continue
    const sourceNetId = getSourceNetId(fill, sourceNetLookupContext)
    elements.push({
      type: "pcb_copper_pour",
      pcb_copper_pour_id: `pcb_copper_pour_fill_${fillIndex}`,
      ...(sourceNetId ? { source_net_id: sourceNetId } : {}),
      covered_with_solder_mask: true,
      shape: "rect",
      center: toCircuitPoint({
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      }),
      width: toCircuitLength(Math.abs(end.x - start.x)),
      height: toCircuitLength(Math.abs(end.y - start.y)),
      rotation: toCircuitRotation(fill.getNumber("ROTATION") ?? 0),
      layer,
    })
  }
}

function hasMatchingSolderMaskOpening({
  componentIds,
  copperRegion,
  document,
  solderMaskRegions,
}: {
  componentIds: ReadonlyMap<AltiumComponentRecord, string>
  copperRegion: AltiumRecord
  document: AltiumPcbDocument
  solderMaskRegions: AltiumRecord[]
}): boolean {
  const copperLayer = toCircuitCopperLayer(copperRegion.getDecoded("LAYER"))
  const copperComponentId = getOwnedComponentId(
    document,
    componentIds,
    copperRegion,
  )
  const copperGeometry = getPcbRegionGeometry(copperRegion)
  return solderMaskRegions.some((solderMaskRegion) => {
    if (
      toCircuitSolderMaskLayer(solderMaskRegion.getDecoded("LAYER")) !==
        copperLayer ||
      getOwnedComponentId(document, componentIds, solderMaskRegion) !==
        copperComponentId
    ) {
      return false
    }
    const solderMaskGeometry = getPcbRegionGeometry(solderMaskRegion)
    const copperBounds = copperGeometry.outline.bounds
    const solderMaskBounds = solderMaskGeometry.outline.bounds
    if (!copperBounds || !solderMaskBounds) return false
    return (
      copperGeometry.outline.points.length ===
        solderMaskGeometry.outline.points.length &&
      Math.abs(copperBounds.minX - solderMaskBounds.minX) <= 0.001 &&
      Math.abs(copperBounds.minY - solderMaskBounds.minY) <= 0.001 &&
      Math.abs(copperBounds.maxX - solderMaskBounds.maxX) <= 0.001 &&
      Math.abs(copperBounds.maxY - solderMaskBounds.maxY) <= 0.001
    )
  })
}

function isSolderMaskLayer(layer: string | undefined): boolean {
  const normalized = normalizeLayer(layer)
  return normalized === "TOPSOLDER" || normalized === "BOTTOMSOLDER"
}

function toCircuitSolderMaskLayer(
  layer: string | undefined,
): "bottom" | "top" | undefined {
  const normalized = normalizeLayer(layer)
  if (normalized === "TOPSOLDER") return "top"
  if (normalized === "BOTTOMSOLDER") return "bottom"
  return undefined
}

function appendSilkscreenGraphicElements({
  componentIds,
  document,
  elements,
}: {
  componentIds: ReadonlyMap<AltiumComponentRecord, string>
  document: AltiumPcbDocument
  elements: CircuitElement[]
}): void {
  const fills = document
    .getRecordsByKind("Fill")
    .filter((fill) => isOverlayLayer(fill.getDecoded("LAYER")))
  for (const [fillIndex, fill] of fills.entries()) {
    const start = getPoint(fill, "X1", "Y1")
    const end = getPoint(fill, "X2", "Y2")
    if (!start || !end) continue
    const width = toCircuitLength(Math.abs(end.x - start.x))
    const height = toCircuitLength(Math.abs(end.y - start.y))
    elements.push({
      type: "pcb_silkscreen_rect",
      pcb_silkscreen_rect_id: `pcb_silkscreen_rect_${fillIndex}`,
      pcb_component_id: getOwnedComponentId(document, componentIds, fill) ?? "",
      center: toCircuitPoint({
        x: (start.x + end.x) / 2,
        y: (start.y + end.y) / 2,
      }),
      width,
      height,
      stroke_width: Math.min(width, height),
      is_filled: true,
      has_stroke: false,
      ccw_rotation: toCircuitRotation(fill.getNumber("ROTATION") ?? 0),
      layer: toCircuitLayer(fill.getDecoded("LAYER")),
    })
  }
  const regions = document
    .getRecordsByKind("Region")
    .filter((region) => isOverlayLayer(region.getDecoded("LAYER")))
  for (const [regionIndex, region] of regions.entries()) {
    const geometry = getPcbRegionGeometry(region)
    if (geometry.outline.points.length < 3) continue
    const pcbComponentId = getOwnedComponentId(document, componentIds, region)
    elements.push({
      type: "pcb_silkscreen_graphic",
      pcb_silkscreen_graphic_id: `pcb_silkscreen_graphic_${regionIndex}`,
      ...(pcbComponentId ? { pcb_component_id: pcbComponentId } : {}),
      layer: toCircuitLayer(region.getDecoded("LAYER")),
      shape: "brep",
      brep_shape: {
        outer_ring: {
          vertices: toCircuitBrepRing(geometry.outline.points),
        },
        inner_rings: geometry.holes.map((hole) => ({
          vertices: toCircuitBrepRing(hole.points),
        })),
      },
    })
  }
}

export function convertAltiumPcbToCircuitJson(
  document: AltiumPcbDocument,
): CircuitElement[] {
  const elements: CircuitElement[] = []
  const outline = document.boardGeometry.outline.points.map(toCircuitPoint)
  elements.push({ type: "pcb_board", pcb_board_id: "pcb_board_0", outline })
  for (const [
    cutoutIndex,
    cutout,
  ] of document.boardGeometry.cutouts.entries()) {
    const points = toCircuitBrepRing(cutout.outline.points)
    if (points.length < 3) continue
    elements.push({
      type: "pcb_cutout",
      pcb_cutout_id: `pcb_cutout_${cutoutIndex}`,
      pcb_board_id: "pcb_board_0",
      shape: "polygon",
      points,
    })
  }

  const sourceNetIds = new Map(
    document.nets.map((net, index) => [net, `source_net_${index}`]),
  )
  for (const [net, sourceNetId] of sourceNetIds) {
    elements.push({
      type: "source_net",
      source_net_id: sourceNetId,
      name: net.name ?? sourceNetId,
    })
  }
  const sourceNetLookupContext: SourceNetLookupContext = {
    document,
    sourceNetIds,
  }

  const componentIds = getComponentIds(document)
  for (const [component, pcbComponentId] of componentIds) {
    const componentIndex = document.components.indexOf(component)
    const sourceComponentId = `source_component_${componentIndex}`
    const position = component.position ?? { x: 0, y: 0 }
    const bounds = document.getComponentBounds(component)
    elements.push(
      {
        type: "source_component",
        source_component_id: sourceComponentId,
        name: component.designator ?? `Component-${componentIndex + 1}`,
      },
      {
        type: "pcb_component",
        pcb_component_id: pcbComponentId,
        source_component_id: sourceComponentId,
        center: toCircuitPoint(position),
        width: toCircuitLength(
          bounds ? Math.max(bounds.maxX - bounds.minX, 1) : 1,
        ),
        height: toCircuitLength(
          bounds ? Math.max(bounds.maxY - bounds.minY, 1) : 1,
        ),
        rotation: toCircuitRotation(component.rotation),
        layer: component.side === "bottom" ? "bottom" : "top",
      },
    )
  }

  for (const [padIndex, pad] of document.getRecordsByKind("Pad").entries()) {
    const position = getPoint(pad, "X", "Y")
    if (!position) continue
    const layer = pad.getDecoded("LAYER")
    const holeSizeMils = getMeasurementMils(pad, "HOLESIZE") ?? 0
    const outerWidthMils =
      getMeasurementMils(pad, "XSIZE", "TOPXSIZE") ??
      Math.max(holeSizeMils * 2, 1)
    const outerHeightMils =
      getMeasurementMils(pad, "YSIZE", "TOPYSIZE") ?? outerWidthMils
    const holeWidthMils =
      getMeasurementMils(pad, "HOLEWIDTH", "SLOTLENGTH") ?? holeSizeMils
    const hasOuterArea = outerWidthMils > 0 && outerHeightMils > 0
    const hasHoleArea = holeWidthMils > 0 && holeSizeMils > 0
    if (!hasOuterArea && !hasHoleArea) continue

    const pcbComponentId = getOwnedComponentId(document, componentIds, pad)
    const sourcePortId = `source_port_${padIndex}`
    const pcbPortId = `pcb_port_${padIndex}`
    const pinName = pad.getDecoded("NAME") || String(padIndex + 1)
    const sourceComponentId = pcbComponentId?.replace(
      "pcb_component",
      "source_component",
    )
    const circuitPosition = toCircuitPoint(position)
    elements.push(
      {
        type: "source_port",
        source_port_id: sourcePortId,
        ...(sourceComponentId
          ? { source_component_id: sourceComponentId }
          : {}),
        name: pinName,
        pin_number: pinName,
      },
      {
        type: "pcb_port",
        pcb_port_id: pcbPortId,
        source_port_id: sourcePortId,
        ...(pcbComponentId ? { pcb_component_id: pcbComponentId } : {}),
        x: circuitPosition.x,
        y: circuitPosition.y,
      },
    )

    const sourceNetId = getSourceNetId(pad, sourceNetLookupContext)
    if (sourceNetId) {
      appendNetConnection(
        elements,
        `source_trace_pad_${padIndex}`,
        sourceNetId,
        sourcePortId,
      )
    }

    const rotation = toCircuitRotation(pad.getNumber("ROTATION") ?? 0)
    const commonFields = {
      ...(pcbComponentId ? { pcb_component_id: pcbComponentId } : {}),
      pcb_port_id: pcbPortId,
      x: circuitPosition.x,
      y: circuitPosition.y,
    }

    if (holeSizeMils <= 0 && normalizeLayer(layer) !== "MULTILAYER") {
      const cornerRadius = getCircuitPadCornerRadius(
        pad,
        outerWidthMils,
        outerHeightMils,
      )
      elements.push({
        type: "pcb_smtpad",
        pcb_smtpad_id: `pcb_smtpad_${padIndex}`,
        ...commonFields,
        width: toCircuitLength(outerWidthMils),
        height: toCircuitLength(outerHeightMils),
        shape: toCircuitPadShape(
          pad.getDecoded("SHAPE"),
          getPadAlternateShape(pad),
        ),
        ...(cornerRadius === undefined ? {} : { corner_radius: cornerRadius }),
        ccw_rotation: rotation,
        layer: toCircuitLayer(layer),
      })
      continue
    }

    const isSlotted = Math.abs(holeWidthMils - holeSizeMils) > 1e-9
    const holeRotation = toCircuitRotation(
      isSlotted
        ? rotation +
            (pad.getNumber("SLOTROTATION") ??
              pad.getNumber("HOLEROTATION") ??
              0)
        : (pad.getNumber("HOLEROTATION") ?? rotation),
    )
    const holeFields = {
      ...commonFields,
      hole_width: toCircuitLength(Math.max(holeWidthMils, holeSizeMils)),
      hole_height: toCircuitLength(holeSizeMils),
      ccw_rotation: holeRotation,
    }
    if (pad.getBoolean("PLATED") === false) {
      elements.push({
        type: "pcb_hole",
        pcb_hole_id: `pcb_hole_${padIndex}`,
        ...holeFields,
      })
    } else if (isSlotted && rotation !== holeRotation) {
      const padShape = pad.getDecoded("SHAPE")?.toUpperCase()
      elements.push({
        type: "pcb_plated_hole",
        pcb_plated_hole_id: `pcb_plated_hole_${padIndex}`,
        ...commonFields,
        shape: "rotated_pill_hole_with_rect_pad",
        hole_shape: "rotated_pill",
        hole_width: toCircuitLength(Math.max(holeWidthMils, holeSizeMils)),
        hole_height: toCircuitLength(holeSizeMils),
        hole_ccw_rotation: holeRotation,
        pad_shape: "rect",
        rect_pad_width: toCircuitLength(outerWidthMils),
        rect_pad_height: toCircuitLength(outerHeightMils),
        rect_ccw_rotation: rotation,
        ...(padShape === "ROUND"
          ? {
              rect_border_radius: toCircuitLength(
                Math.min(outerWidthMils, outerHeightMils) / 2,
              ),
            }
          : {}),
        hole_offset_x: 0,
        hole_offset_y: 0,
      })
    } else {
      elements.push({
        type: "pcb_plated_hole",
        pcb_plated_hole_id: `pcb_plated_hole_${padIndex}`,
        ...holeFields,
        outer_width: toCircuitLength(outerWidthMils),
        outer_height: toCircuitLength(outerHeightMils),
        shape: isSlotted ? "pill" : toCircuitPadShape(pad.getDecoded("SHAPE")),
      })
    }
  }

  for (const [trackIndex, track] of document
    .getRecordsByKind("Track")
    .entries()) {
    const start = getPoint(track, "X1", "Y1")
    const end = getPoint(track, "X2", "Y2")
    const layer = track.getDecoded("LAYER")
    if (!start || !end || (start.x === end.x && start.y === end.y)) continue
    const widthMils = getMeasurementMils(track, "WIDTH") ?? 4
    if (isCopperLayer(layer)) {
      appendCopperTrace(
        elements,
        `source_trace_track_${trackIndex}`,
        getSourceNetId(track, sourceNetLookupContext),
        toCircuitLayer(layer),
        widthMils,
        start,
        end,
      )
    } else if (isOverlayLayer(layer)) {
      const pcbComponentId = getOwnedComponentId(document, componentIds, track)
      elements.push({
        type: "pcb_silkscreen_path",
        pcb_silkscreen_path_id: `pcb_silkscreen_path_track_${trackIndex}`,
        ...(pcbComponentId ? { pcb_component_id: pcbComponentId } : {}),
        layer: toCircuitLayer(layer),
        stroke_width: toCircuitLength(widthMils),
        route: [start, end].map(toCircuitPoint),
      })
    }
  }

  for (const [arcIndex, arc] of document.getRecordsByKind("Arc").entries()) {
    const points = createArcPoints(arc)
    const layer = arc.getDecoded("LAYER")
    const widthMils = getMeasurementMils(arc, "WIDTH") ?? 4
    if (isCopperLayer(layer)) {
      for (let segmentIndex = 1; segmentIndex < points.length; segmentIndex++) {
        const start = points[segmentIndex - 1]
        const end = points[segmentIndex]
        if (!start || !end) continue
        appendCopperTrace(
          elements,
          `source_trace_arc_${arcIndex}_${segmentIndex - 1}`,
          getSourceNetId(arc, sourceNetLookupContext),
          toCircuitLayer(layer),
          widthMils,
          start,
          end,
        )
      }
    } else if (isOverlayLayer(layer) && points.length > 1) {
      const pcbComponentId = getOwnedComponentId(document, componentIds, arc)
      elements.push({
        type: "pcb_silkscreen_path",
        pcb_silkscreen_path_id: `pcb_silkscreen_path_arc_${arcIndex}`,
        ...(pcbComponentId ? { pcb_component_id: pcbComponentId } : {}),
        layer: toCircuitLayer(layer),
        stroke_width: toCircuitLength(widthMils),
        route: points.map(toCircuitPoint),
      })
    }
  }

  for (const [viaIndex, via] of document.getRecordsByKind("Via").entries()) {
    const position = getPoint(via, "X", "Y")
    if (!position) continue
    const sourceNetId = getSourceNetId(via, sourceNetLookupContext)
    const sourceTraceId = `source_trace_via_${viaIndex}`
    if (sourceNetId) {
      appendNetConnection(elements, sourceTraceId, sourceNetId)
    }
    elements.push({
      type: "pcb_via",
      pcb_via_id: `pcb_via_${viaIndex}`,
      ...(sourceNetId ? { source_trace_id: sourceTraceId } : {}),
      ...toCircuitPoint(position),
      outer_diameter: toCircuitLength(
        getMeasurementMils(via, "DIAMETER", "TOPLAYERSIZE") ?? 20,
      ),
      hole_diameter: toCircuitLength(getMeasurementMils(via, "HOLESIZE") ?? 10),
    })
  }

  appendCopperPourElements({
    componentIds,
    document,
    elements,
    sourceNetLookupContext,
  })
  appendSilkscreenGraphicElements({ componentIds, document, elements })

  for (const [textIndex, text] of document.getRecordsByKind("Text").entries()) {
    const layer = text.getDecoded("LAYER")
    const position = getPoint(text, "X", "Y")
    if (
      !position ||
      !isOverlayLayer(layer) ||
      !isVisibleComponentText(document, text)
    ) {
      continue
    }
    const pcbComponentId = getOwnedComponentId(document, componentIds, text)
    elements.push({
      type: "pcb_silkscreen_text",
      pcb_silkscreen_text_id: `pcb_silkscreen_text_${textIndex}`,
      ...(pcbComponentId ? { pcb_component_id: pcbComponentId } : {}),
      text: getText(text),
      anchor_position: toCircuitPoint(position),
      anchor_alignment: toCircuitTextAnchorAlignment(
        text.getNumber("JUSTIFICATION"),
      ),
      font_size: toCircuitLength(getMeasurementMils(text, "HEIGHT") ?? 30),
      font: "tscircuit2024",
      ccw_rotation: toCircuitRotation(text.getNumber("ROTATION") ?? 0),
      is_mirrored:
        text.getBoolean("MIRROR") ?? toCircuitLayer(layer) === "bottom",
      layer: toCircuitLayer(layer),
    })
  }

  elements.push(
    ...convertAltiumPcbComponentBodiesToCircuitJson({
      componentIds,
      document,
      toCircuitLength,
      toCircuitPoint,
    }),
    ...convertAltiumPcbAnnotationsToCircuitJson({ componentIds, document }),
  )

  return elements
}
