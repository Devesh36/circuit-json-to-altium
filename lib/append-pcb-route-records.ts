import {
  asNumber,
  asPoint,
  asPositiveNumber,
  asString,
  byType,
  formatMil,
  isCircuitElement,
  MILLIMETERS_TO_MILS,
  pointsEqual,
} from "./format"
import type { PcbDocumentContext } from "./pcb-document-types"
import type { CircuitElement, PcbTraceId } from "./types"

function appendTrackRecords(context: PcbDocumentContext): void {
  for (const trace of byType(context.circuitJson, "pcb_trace")) {
    const route = Array.isArray(trace.route)
      ? trace.route.flatMap((routePoint) =>
          isCircuitElement(routePoint) && asPoint(routePoint)
            ? [routePoint]
            : [],
        )
      : []
    const net = context.netByTraceId.get(asString(trace.source_trace_id))
    for (let index = 1; index < route.length; index++) {
      const circuitRouteStart = route[index - 1]
      const circuitRouteEnd = route[index]
      if (!circuitRouteStart || !circuitRouteEnd) continue
      if (
        circuitRouteStart.route_type === "via" &&
        circuitRouteEnd.route_type === "via"
      ) {
        continue
      }
      const altiumStartPoint = context.circuitToAltiumPcbPoint({
        x: asNumber(circuitRouteStart.x),
        y: asNumber(circuitRouteStart.y),
      })
      const altiumEndPoint = context.circuitToAltiumPcbPoint({
        x: asNumber(circuitRouteEnd.x),
        y: asNumber(circuitRouteEnd.y),
      })
      if (pointsEqual(altiumStartPoint, altiumEndPoint)) continue
      const routeLayer =
        asString(
          circuitRouteEnd.layer,
          asString(circuitRouteStart.layer),
        ).toLowerCase() === "bottom"
          ? "BOTTOM"
          : "TOP"
      context.lines.push(
        [
          "|RECORD=Track",
          ...(net ? [`NET=${net.index}`] : []),
          `LAYER=${routeLayer}`,
          "LOCKED=FALSE",
          `X1=${formatMil(altiumStartPoint.x)}`,
          `Y1=${formatMil(altiumStartPoint.y)}`,
          `X2=${formatMil(altiumEndPoint.x)}`,
          `Y2=${formatMil(altiumEndPoint.y)}`,
          `WIDTH=${formatMil(asPositiveNumber(circuitRouteEnd.width, asPositiveNumber(circuitRouteStart.width, 0.2)) * MILLIMETERS_TO_MILS)}`,
        ].join("|"),
      )
    }
  }
}

function appendViaRecords(context: PcbDocumentContext): void {
  const pcbTraces = new Map<PcbTraceId, CircuitElement>(
    byType(context.circuitJson, "pcb_trace").map((trace) => [
      asString(trace.pcb_trace_id),
      trace,
    ]),
  )
  for (const via of byType(context.circuitJson, "pcb_via")) {
    const altiumCenter = context.circuitToAltiumPcbPoint({
      x: asNumber(via.x),
      y: asNumber(via.y),
    })
    const owningTrace = pcbTraces.get(asString(via.pcb_trace_id))
    const net = context.netByTraceId.get(
      asString(via.source_trace_id, asString(owningTrace?.source_trace_id)),
    )
    context.lines.push(
      [
        "|RECORD=Via",
        ...(net ? [`NET=${net.index}`] : []),
        `X=${formatMil(altiumCenter.x)}`,
        `Y=${formatMil(altiumCenter.y)}`,
        `DIAMETER=${formatMil(asPositiveNumber(via.outer_diameter, 0.6) * MILLIMETERS_TO_MILS)}`,
        `HOLESIZE=${formatMil(asPositiveNumber(via.hole_diameter, 0.3) * MILLIMETERS_TO_MILS)}`,
        "STARTLAYER=TOP",
        "STOPLAYER=BOTTOM",
        "LOCKED=FALSE",
      ].join("|"),
    )
  }
}

export function appendPcbRouteRecords(context: PcbDocumentContext): void {
  appendTrackRecords(context)
  appendViaRecords(context)
}
