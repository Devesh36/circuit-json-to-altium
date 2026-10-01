import { convertCircuitPcbCcwRotationDegreesToAltium } from "./convert-circuit-pcb-ccw-rotation-degrees-to-altium"
import type { PcbNetEntry } from "./create-pcb-net-entries"
import {
  asNumber,
  asPositiveNumber,
  asString,
  byType,
  formatMil,
  formatNumber,
  MILLIMETERS_TO_MILS,
  sanitizeField,
} from "./format"
import type { PcbDocumentContext } from "./pcb-document-types"
import type { CircuitElement } from "./types"

function getPadNet(
  pad: CircuitElement,
  context: PcbDocumentContext,
): PcbNetEntry | undefined {
  const pcbPort = context.pcbPorts.get(asString(pad.pcb_port_id))
  return context.netBySourcePortId.get(asString(pcbPort?.source_port_id))
}

function getPadName(pad: CircuitElement, context: PcbDocumentContext): string {
  const pcbPort = context.pcbPorts.get(asString(pad.pcb_port_id))
  const sourcePort = context.sourcePorts.get(asString(pcbPort?.source_port_id))
  return (
    sanitizeField(sourcePort?.pin_number?.toString()) ||
    sanitizeField(sourcePort?.name) ||
    "1"
  )
}

function getSmtPadShapeFields({
  pad,
  width,
  height,
  layer,
}: {
  pad: CircuitElement
  width: number
  height: number
  layer: "TOP" | "BOTTOM"
}): string[] {
  const shape = asString(pad.shape).toLowerCase()
  if (shape === "circle") return ["SHAPE=ROUND"]

  const isPill = shape === "pill" || shape === "rotated_pill"
  const requestedCornerRadius = isPill
    ? asPositiveNumber(pad.radius, Math.min(width, height) / 2)
    : Math.max(0, asNumber(pad.corner_radius ?? pad.rect_border_radius))
  const cornerRadius = Math.min(
    Math.min(width, height) / 2,
    requestedCornerRadius,
  )
  if (cornerRadius <= 0) return ["SHAPE=RECTANGLE"]

  const layerOrdinal = layer === "BOTTOM" ? 31 : 0
  const cornerRadiusPercent = (cornerRadius * 200) / Math.min(width, height)
  return [
    "SHAPE=RECTANGLE",
    `LAYER${layerOrdinal}ALTSHAPE=ROUNDRECT`,
    `LAYER${layerOrdinal}CORNERRADIUS=${formatNumber(cornerRadiusPercent)}`,
  ]
}

function appendSmtPadRecords(context: PcbDocumentContext): void {
  for (const pad of byType(context.circuitJson, "pcb_smtpad")) {
    const altiumCenter = context.circuitToAltiumPcbPoint({
      x: asNumber(pad.x),
      y: asNumber(pad.y),
    })
    const altiumComponentIndex = context.componentIndex.get(
      asString(pad.pcb_component_id),
    )
    const net = getPadNet(pad, context)
    const diameter = asPositiveNumber(pad.radius, 0.5) * 2
    const width = asPositiveNumber(pad.width, diameter)
    const height = asPositiveNumber(pad.height, width)
    const layer =
      asString(pad.layer).toLowerCase() === "bottom" ? "BOTTOM" : "TOP"
    context.lines.push(
      [
        "|RECORD=Pad",
        ...(altiumComponentIndex === undefined
          ? []
          : [`COMPONENT=${altiumComponentIndex}`]),
        ...(net ? [`NET=${net.index}`] : []),
        `LAYER=${layer}`,
        `ROTATION=${formatNumber(convertCircuitPcbCcwRotationDegreesToAltium(asNumber(pad.ccw_rotation)))}`,
        `NAME=${getPadName(pad, context)}`,
        "HOLESIZE=0mil",
        "PLATED=TRUE",
        "LOCKED=FALSE",
        `X=${formatMil(altiumCenter.x)}`,
        `Y=${formatMil(altiumCenter.y)}`,
        ...getSmtPadShapeFields({ pad, width, height, layer }),
        `XSIZE=${formatMil(width * MILLIMETERS_TO_MILS)}`,
        `YSIZE=${formatMil(height * MILLIMETERS_TO_MILS)}`,
      ].join("|"),
    )
  }
}

function appendPlatedHoleRecords(context: PcbDocumentContext): void {
  for (const hole of byType(context.circuitJson, "pcb_plated_hole")) {
    const altiumCenter = context.circuitToAltiumPcbPoint({
      x: asNumber(hole.x),
      y: asNumber(hole.y),
    })
    const altiumComponentIndex = context.componentIndex.get(
      asString(hole.pcb_component_id),
    )
    const net = getPadNet(hole, context)
    const hasIndependentPadRotation =
      hole.shape === "rotated_pill_hole_with_rect_pad"
    const outerWidth = asPositiveNumber(
      hasIndependentPadRotation ? hole.rect_pad_width : hole.outer_width,
      asPositiveNumber(hole.outer_diameter, 1.6),
    )
    const outerHeight = asPositiveNumber(
      hasIndependentPadRotation ? hole.rect_pad_height : hole.outer_height,
      outerWidth,
    )
    const holeWidth = asPositiveNumber(
      hole.hole_width,
      asPositiveNumber(hole.hole_diameter, 0.8),
    )
    const holeHeight = asPositiveNumber(hole.hole_height, holeWidth)
    const isSlotted = Math.abs(holeWidth - holeHeight) > 1e-9
    const holeCcwRotationDegrees = asNumber(
      hasIndependentPadRotation ? hole.hole_ccw_rotation : hole.ccw_rotation,
    )
    const padCcwRotationDegrees = asNumber(
      hasIndependentPadRotation ? hole.rect_ccw_rotation : hole.ccw_rotation,
    )
    const isRoundedRectPad =
      hasIndependentPadRotation &&
      asPositiveNumber(hole.rect_border_radius, 0) >=
        Math.min(outerWidth, outerHeight) / 2 - 1e-9
    context.lines.push(
      [
        "|RECORD=Pad",
        ...(altiumComponentIndex === undefined
          ? []
          : [`COMPONENT=${altiumComponentIndex}`]),
        ...(net ? [`NET=${net.index}`] : []),
        "LAYER=MULTILAYER",
        `ROTATION=${formatNumber(convertCircuitPcbCcwRotationDegreesToAltium(padCcwRotationDegrees))}`,
        `NAME=${getPadName(hole, context)}`,
        `HOLESIZE=${formatMil(Math.min(holeWidth, holeHeight) * MILLIMETERS_TO_MILS)}`,
        `HOLEWIDTH=${formatMil(Math.max(holeWidth, holeHeight) * MILLIMETERS_TO_MILS)}`,
        `HOLESHAPE=${isSlotted ? "SLOT" : "ROUND"}`,
        `HOLEROTATION=${formatNumber(convertCircuitPcbCcwRotationDegreesToAltium(holeCcwRotationDegrees))}`,
        "PLATED=TRUE",
        "LOCKED=FALSE",
        `X=${formatMil(altiumCenter.x)}`,
        `Y=${formatMil(altiumCenter.y)}`,
        `SHAPE=${hole.shape === "circle" || hole.shape === "oval" || hole.shape === "pill" || isRoundedRectPad ? "ROUND" : "RECTANGLE"}`,
        `XSIZE=${formatMil(outerWidth * MILLIMETERS_TO_MILS)}`,
        `YSIZE=${formatMil(outerHeight * MILLIMETERS_TO_MILS)}`,
      ].join("|"),
    )
  }
}

function appendNonPlatedHoleRecords(context: PcbDocumentContext): void {
  for (const [holeIndex, hole] of byType(
    context.circuitJson,
    "pcb_hole",
  ).entries()) {
    const altiumCenter = context.circuitToAltiumPcbPoint({
      x: asNumber(hole.x),
      y: asNumber(hole.y),
    })
    const altiumComponentIndex = context.componentIndex.get(
      asString(hole.pcb_component_id),
    )
    const diameter = asPositiveNumber(hole.hole_diameter, 1)
    const holeWidth = asPositiveNumber(hole.hole_width, diameter)
    const holeHeight = asPositiveNumber(hole.hole_height, diameter)
    const isSlotted = Math.abs(holeWidth - holeHeight) > 1e-9
    context.lines.push(
      [
        "|RECORD=Pad",
        ...(altiumComponentIndex === undefined
          ? []
          : [`COMPONENT=${altiumComponentIndex}`]),
        "LAYER=MULTILAYER",
        `ROTATION=${formatNumber(convertCircuitPcbCcwRotationDegreesToAltium(asNumber(hole.ccw_rotation)))}`,
        `NAME=NPTH-${holeIndex + 1}`,
        `HOLESIZE=${formatMil(Math.min(holeWidth, holeHeight) * MILLIMETERS_TO_MILS)}`,
        `HOLEWIDTH=${formatMil(Math.max(holeWidth, holeHeight) * MILLIMETERS_TO_MILS)}`,
        `HOLESHAPE=${isSlotted ? "SLOT" : "ROUND"}`,
        `HOLEROTATION=${formatNumber(convertCircuitPcbCcwRotationDegreesToAltium(asNumber(hole.ccw_rotation)))}`,
        "PLATED=FALSE",
        "LOCKED=FALSE",
        `X=${formatMil(altiumCenter.x)}`,
        `Y=${formatMil(altiumCenter.y)}`,
        `SHAPE=${isSlotted ? "RECTANGLE" : "ROUND"}`,
        `XSIZE=${formatMil(holeWidth * MILLIMETERS_TO_MILS)}`,
        `YSIZE=${formatMil(holeHeight * MILLIMETERS_TO_MILS)}`,
      ].join("|"),
    )
  }
}

export function appendPcbPadRecords(context: PcbDocumentContext): void {
  appendSmtPadRecords(context)
  appendPlatedHoleRecords(context)
  appendNonPlatedHoleRecords(context)
}
