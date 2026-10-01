import { convertCircuitPcbCcwRotationDegreesToAltium } from "./convert-circuit-pcb-ccw-rotation-degrees-to-altium"
import {
  asNumber,
  asPoint,
  asPositiveNumber,
  asString,
  formatMil,
  formatNumber,
  sanitizeField,
} from "./format"
import type { PcbDocumentContext } from "./pcb-document-types"

export function appendPcbComponentRecords(context: PcbDocumentContext): void {
  for (const [index, component] of context.pcbComponents.entries()) {
    const componentId =
      asString(component.pcb_component_id) || `pcb_component_${index}`
    const sourceComponent = context.sourceComponents.get(
      asString(component.source_component_id),
    )
    const altiumCenter = context.circuitToAltiumPcbPoint(
      asPoint(component.center) ?? { x: 0, y: 0 },
    )
    const designator =
      sanitizeField(sourceComponent?.name) || `Component-${index + 1}`
    const pattern = `TSCIRCUIT-${formatNumber(asPositiveNumber(component.width, 1))}x${formatNumber(asPositiveNumber(component.height, 1))}mm`
    const componentLayer =
      asString(component.layer).toLowerCase() === "bottom" ? "BOTTOM" : "TOP"
    context.lines.push(
      [
        "|RECORD=Component",
        `ID=${index}`,
        `LAYER=${componentLayer}`,
        `X=${formatMil(altiumCenter.x)}`,
        `Y=${formatMil(altiumCenter.y)}`,
        `ROTATION=${formatNumber(convertCircuitPcbCcwRotationDegreesToAltium(asNumber(component.rotation)))}`,
        `PATTERN=${pattern}`,
        `SOURCEDESIGNATOR=${designator}`,
        "NAMEON=TRUE",
        "COMMENTON=TRUE",
        `SOURCEUNIQUEID=${sanitizeField(componentId)}`,
      ].join("|"),
    )
  }
}
