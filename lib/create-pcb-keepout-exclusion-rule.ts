import { createPcbNetEntries } from "./create-pcb-net-entries"
import { asString, byType, sanitizeField } from "./format"
import type { CircuitElement } from "./types"

/** Keep scope expressions literal: membership functions interpret * and ? as wildcards. */
function queryString(queryName: string): string {
  if (/[\r\n|*?]/u.test(queryName)) {
    throw new Error(
      `Cannot represent keepout exclusion query name: ${JSON.stringify(queryName)}`,
    )
  }
  return `'${queryName.replaceAll("'", "''")}'`
}

export function createPcbKeepoutExclusionRule({
  circuitJson,
  excludedComponentIds,
  unionIndex,
}: {
  circuitJson: CircuitElement[]
  excludedComponentIds: string[]
  unionIndex: number
}): string {
  const components = byType(circuitJson, "pcb_component")
  const sources = byType(circuitJson, "source_component")
  const names = components.map((component, index) => {
    const source = sources.find(
      (item) => item.source_component_id === component.source_component_id,
    )
    return sanitizeField(source?.name) || `Component-${index + 1}`
  })
  const sourceIds = new Set<string>()
  const excludedNames = [...new Set(excludedComponentIds)].map((id) => {
    const index = components.findIndex(
      (component) => component.pcb_component_id === id,
    )
    if (index === -1)
      throw new Error(
        `Keepout exclusion references missing PCB component ${id}`,
      )
    const name = names[index]!
    if (
      names.filter(
        (candidate) => candidate.toLowerCase() === name.toLowerCase(),
      ).length !== 1
    ) {
      throw new Error(
        `Keepout exclusion has ambiguous Altium component name ${name}`,
      )
    }
    sourceIds.add(asString(components[index]!.source_component_id))
    return queryString(name)
  })
  const portIds = new Set(
    byType(circuitJson, "source_port")
      .filter((port) => sourceIds.has(asString(port.source_component_id)))
      .map((port) => asString(port.source_port_id)),
  )
  const nets = createPcbNetEntries(circuitJson)
    .filter((net) => net.sourcePortIds.some((id) => portIds.has(id)))
    .map((net) => queryString(net.name))
  // tscircuit checks also exempt routed traces connected to excluded components.
  // Do not exempt unrelated pads or pours just because they share one of these nets.
  const scope = [`InComponent(${excludedNames.join(", ")})`]
  if (nets.length)
    scope.push(`((IsTrack Or IsArc) And InNet(${nets.join(", ")}))`)
  return [
    "|RECORD=Rule",
    "BINARYRECORDTYPE=0",
    "RULEKIND=Clearance",
    "NETSCOPE=AnyNet",
    "LAYERKIND=SameLayer",
    `SCOPE1EXPRESSION=IsKeepOut And InUnion(${unionIndex})`,
    `SCOPE2EXPRESSION=${scope.join(" Or ")}`,
    `NAME=TscircuitKeepoutExclusion${unionIndex}`,
    "ENABLED=TRUE",
    `PRIORITY=${unionIndex}`,
    "GAP=0mil",
    "DEFINEDBYLOGICALDOCUMENT=FALSE",
  ].join("|")
}
