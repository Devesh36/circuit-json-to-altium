import type { PcbNetEntry } from "./create-pcb-net-entries"
import type {
  CircuitElement,
  PcbComponentId,
  PcbPortId,
  PointTransform,
  SourceComponentId,
  SourcePortId,
  SourceTraceId,
} from "./types"

export type PcbDocumentContext = {
  circuitJson: CircuitElement[]
  circuitToAltiumPcbPoint: PointTransform
  componentIndex: Map<PcbComponentId, number>
  lines: string[]
  netBySourcePortId: Map<SourcePortId, PcbNetEntry>
  netByTraceId: Map<SourceTraceId, PcbNetEntry>
  netEntries: PcbNetEntry[]
  pcbComponents: CircuitElement[]
  pcbPorts: Map<PcbPortId, CircuitElement>
  sourceComponents: Map<SourceComponentId, CircuitElement>
  sourcePorts: Map<SourcePortId, CircuitElement>
}
