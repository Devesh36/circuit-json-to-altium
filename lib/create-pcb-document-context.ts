import { createCircuitToAltiumPcbPointTransform } from "./create-circuit-to-altium-pcb-point-transform"
import { createPcbNetEntries, type PcbNetEntry } from "./create-pcb-net-entries"
import { asString, byType, formatMil } from "./format"
import { getBoardOutline } from "./get-board-outline"
import type { PcbDocumentContext } from "./pcb-document-types"
import type {
  CircuitElement,
  PcbComponentId,
  PcbPortId,
  SourceComponentId,
  SourcePortId,
  SourceTraceId,
} from "./types"

export function createPcbDocumentContext(
  circuitJson: CircuitElement[],
): PcbDocumentContext {
  const outline = getBoardOutline(byType(circuitJson, "pcb_board")[0])
  const circuitToAltiumPcbPoint =
    createCircuitToAltiumPcbPointTransform(outline)
  const firstOutlinePoint = outline[0] ?? { x: 0, y: 0 }
  const boardFields = [...outline, firstOutlinePoint].flatMap(
    (point, index) => {
      const altiumPoint = circuitToAltiumPcbPoint(point)
      return [
        `KIND${index}=0`,
        `VX${index}=${formatMil(altiumPoint.x)}`,
        `VY${index}=${formatMil(altiumPoint.y)}`,
      ]
    },
  )
  const netEntries = createPcbNetEntries(circuitJson)
  const pcbComponents = byType(circuitJson, "pcb_component")
  return {
    circuitJson,
    circuitToAltiumPcbPoint,
    componentIndex: new Map<PcbComponentId, number>(
      pcbComponents.map((component, index) => [
        asString(component.pcb_component_id) || `pcb_component_${index}`,
        index,
      ]),
    ),
    lines: [
      [
        "|RECORD=Board",
        "KIND=Protel_Advanced_PCB",
        "VERSION=5.00",
        ...boardFields,
      ].join("|"),
    ],
    netBySourcePortId: new Map<SourcePortId, PcbNetEntry>(
      netEntries.flatMap((net) =>
        net.sourcePortIds.map((sourcePortId) => [sourcePortId, net] as const),
      ),
    ),
    netByTraceId: new Map<SourceTraceId, PcbNetEntry>(
      netEntries.flatMap((net) =>
        net.traceIds.map((traceId) => [traceId, net] as const),
      ),
    ),
    netEntries,
    pcbComponents,
    pcbPorts: new Map<PcbPortId, CircuitElement>(
      byType(circuitJson, "pcb_port").map((port) => [
        asString(port.pcb_port_id),
        port,
      ]),
    ),
    sourceComponents: new Map<SourceComponentId, CircuitElement>(
      byType(circuitJson, "source_component")
        .filter((element) => typeof element.source_component_id === "string")
        .map((element) => [asString(element.source_component_id), element]),
    ),
    sourcePorts: new Map<SourcePortId, CircuitElement>(
      byType(circuitJson, "source_port").map((port) => [
        asString(port.source_port_id),
        port,
      ]),
    ),
  }
}
