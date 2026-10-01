import { appendPcbComponentRecords } from "./append-pcb-component-records"
import { appendPcbPadRecords } from "./append-pcb-pad-records"
import { appendPcbRouteRecords } from "./append-pcb-route-records"
import { appendPcbSilkscreenRecords } from "./append-pcb-silkscreen-records"
import { createPcbComponentBodyRecords } from "./create-pcb-component-body-records"
import { createPcbCopperPourRecords } from "./create-pcb-copper-pour-records"
import { createPcbCourtyardRecords } from "./create-pcb-courtyard-records"
import { createPcbCutoutRecords } from "./create-pcb-cutout-records"
import { createPcbDocumentContext } from "./create-pcb-document-context"
import { createPcbDocumentationRecords } from "./create-pcb-documentation-records"
import { createPcbKeepoutRecords } from "./create-pcb-keepout-records"
import { sanitizeField } from "./format"
import type { CircuitElement } from "./types"

export function createPcbDocument(circuitJson: CircuitElement[]): string {
  const context = createPcbDocumentContext(circuitJson)
  for (const net of context.netEntries) {
    context.lines.push(
      `|RECORD=Net|ID=${net.index}|NAME=${sanitizeField(net.name)}|VISIBLE=FALSE|JUMPERSVISIBLE=FALSE`,
    )
  }
  context.lines.push(
    ...createPcbCutoutRecords({
      circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
    }),
    ...createPcbCopperPourRecords({
      circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
      componentIndex: context.componentIndex,
      netEntries: context.netEntries,
    }),
  )
  appendPcbComponentRecords(context)
  context.lines.push(
    ...createPcbComponentBodyRecords({
      circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
      componentIndex: context.componentIndex,
    }),
    ...createPcbKeepoutRecords({
      circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
    }),
    ...createPcbCourtyardRecords({
      circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
      componentIndex: context.componentIndex,
    }),
    ...createPcbDocumentationRecords({
      circuitJson,
      circuitToAltiumPcbPoint: context.circuitToAltiumPcbPoint,
      componentIndex: context.componentIndex,
    }),
  )
  appendPcbPadRecords(context)
  appendPcbRouteRecords(context)
  appendPcbSilkscreenRecords(context)
  return `${context.lines.join("\r\n")}\r\n`
}
