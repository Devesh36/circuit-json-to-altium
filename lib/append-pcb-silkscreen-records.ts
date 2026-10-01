import { createPcbSilkscreenGraphicRecords } from "./create-pcb-silkscreen-graphic-records"
import { createPcbSilkscreenLineRecords } from "./create-pcb-silkscreen-line-records"
import { createPcbSilkscreenTextRecord } from "./create-pcb-silkscreen-text-record"
import {
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

function appendPcbSilkscreenPathRecords(context: PcbDocumentContext): void {
  for (const silkscreenPath of byType(
    context.circuitJson,
    "pcb_silkscreen_path",
  )) {
    const route = Array.isArray(silkscreenPath.route)
      ? silkscreenPath.route.flatMap((routePoint) =>
          isCircuitElement(routePoint) && asPoint(routePoint)
            ? [routePoint]
            : [],
        )
      : []
    const altiumComponentIndex = context.componentIndex.get(
      asString(silkscreenPath.pcb_component_id),
    )
    const silkscreenLayer =
      asString(silkscreenPath.layer).toLowerCase() === "bottom"
        ? "BOTTOMOVERLAY"
        : "TOPOVERLAY"
    for (let index = 1; index < route.length; index++) {
      const circuitStartPoint = asPoint(route[index - 1])
      const circuitEndPoint = asPoint(route[index])
      if (!circuitStartPoint || !circuitEndPoint) continue
      const altiumStartPoint =
        context.circuitToAltiumPcbPoint(circuitStartPoint)
      const altiumEndPoint = context.circuitToAltiumPcbPoint(circuitEndPoint)
      if (pointsEqual(altiumStartPoint, altiumEndPoint)) continue
      context.lines.push(
        [
          "|RECORD=Track",
          ...(altiumComponentIndex === undefined
            ? []
            : [`COMPONENT=${altiumComponentIndex}`]),
          `LAYER=${silkscreenLayer}`,
          "LOCKED=FALSE",
          `X1=${formatMil(altiumStartPoint.x)}`,
          `Y1=${formatMil(altiumStartPoint.y)}`,
          `X2=${formatMil(altiumEndPoint.x)}`,
          `Y2=${formatMil(altiumEndPoint.y)}`,
          `WIDTH=${formatMil(asPositiveNumber(silkscreenPath.stroke_width, 0.15) * MILLIMETERS_TO_MILS)}`,
        ].join("|"),
      )
    }
  }
}

export function appendPcbSilkscreenRecords(context: PcbDocumentContext): void {
  context.lines.push(
    ...createPcbSilkscreenLineRecords({
      circuitJson: context.circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
      componentIndex: context.componentIndex,
    }),
  )
  appendPcbSilkscreenPathRecords(context)
  context.lines.push(
    ...createPcbSilkscreenGraphicRecords({
      circuitJson: context.circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
      componentIndex: context.componentIndex,
    }),
  )
  for (const silkscreenText of byType(
    context.circuitJson,
    "pcb_silkscreen_text",
  )) {
    context.lines.push(
      createPcbSilkscreenTextRecord({
        altiumComponentIndex: context.componentIndex.get(
          asString(silkscreenText.pcb_component_id),
        ),
        circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
        silkscreenText,
      }),
    )
  }
}
