import { createAltiumSchematicNetLabelRecordFields } from "./create-altium-schematic-net-label-record-fields"
import { createAltiumSchematicNoConnectRecordFields } from "./create-altium-schematic-no-connect-record-fields"
import { createAltiumSchematicOffSheetPortRecordFields } from "./create-altium-schematic-off-sheet-port-record-fields"
import { createSchematicWireRecords } from "./create-schematic-wire-records"
import { asPoint, asString, sanitizeField } from "./format"
import { addSchematicRecord } from "./schematic-document-records"
import type { SchematicDocumentContext } from "./schematic-document-types"

type AltiumSchematicPointKey = string

const ALTIUM_SMALLEST_JUNCTION_SIZE = 0

function appendOffSheetPortRecords(context: SchematicDocumentContext): void {
  for (const schematicPort of context.schematicElements.filter(
    (element) =>
      element.type === "schematic_port" &&
      !asString(element.schematic_component_id),
  )) {
    const sourcePort = context.sourcePorts.get(
      asString(schematicPort.source_port_id),
    )
    const isStandaloneNoConnectMarker =
      sourcePort?.do_not_connect === true &&
      schematicPort.is_internal_circuit_port !== true
    if (isStandaloneNoConnectMarker) continue
    const portName =
      sanitizeField(schematicPort.display_pin_label) ||
      sanitizeField(sourcePort?.name)
    const circuitPortPosition = asPoint(schematicPort.center)
    if (!portName || !circuitPortPosition) continue
    addSchematicRecord(
      createAltiumSchematicOffSheetPortRecordFields({
        scale: context.scaleRatio,
        altiumPortPosition:
          context.circuitToAltiumSchematicPoint(circuitPortPosition),
        facingDirection: asString(schematicPort.facing_direction),
        hasInputArrow: schematicPort.has_input_arrow === true,
        hasOutputArrow: schematicPort.has_output_arrow === true,
        portName,
      }),
      context.recordContext,
    )
  }
}

function appendWireRecords(context: SchematicDocumentContext): void {
  for (const recordFields of createSchematicWireRecords({
    circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
    schematicElements: context.schematicElements,
  })) {
    addSchematicRecord(recordFields, context.recordContext)
  }
}

function appendExplicitJunctionRecords(
  context: SchematicDocumentContext,
): void {
  const emittedJunctions = new Set<AltiumSchematicPointKey>()
  for (const schematicTrace of context.schematicElements.filter(
    (element) => element.type === "schematic_trace",
  )) {
    if (!Array.isArray(schematicTrace.junctions)) continue
    for (const junction of schematicTrace.junctions) {
      const circuitJunctionPoint = asPoint(junction)
      if (!circuitJunctionPoint) continue
      const altiumJunctionPoint =
        context.circuitToAltiumSchematicPoint(circuitJunctionPoint)
      const altiumJunctionPointKey = `${altiumJunctionPoint.x}:${altiumJunctionPoint.y}`
      if (emittedJunctions.has(altiumJunctionPointKey)) continue
      emittedJunctions.add(altiumJunctionPointKey)
      addSchematicRecord(
        [
          "RECORD=29",
          "OWNERPARTID=-1",
          `INDEXINSHEET=${context.recordContext.nextRecordIndex}`,
          `LOCATION.X=${altiumJunctionPoint.x}`,
          `LOCATION.Y=${altiumJunctionPoint.y}`,
          "COLOR=34816",
          `SIZE=${ALTIUM_SMALLEST_JUNCTION_SIZE}`,
          "LOCKED=T",
        ],
        context.recordContext,
      )
    }
  }
}

function appendNetLabelRecords(context: SchematicDocumentContext): void {
  for (const {
    circuitLabelPosition,
    labelText,
    netLabelIndex,
    schematicNetLabel,
    textPresentation,
  } of context.netLabelPlans) {
    const recordFieldsList = createAltiumSchematicNetLabelRecordFields({
      anchorSide: asString(schematicNetLabel.anchor_side),
      altiumLabelCenter: context.circuitToAltiumSchematicPoint(
        asPoint(schematicNetLabel.center) ?? circuitLabelPosition,
      ),
      altiumLabelPosition:
        context.circuitToAltiumSchematicPoint(circuitLabelPosition),
      decorationIndex: netLabelIndex,
      fontTable: asString(textPresentation?.source_trace_id)
        ? context.nativeTextFontTable
        : context.altiumSchematicFontTable,
      labelText,
      symbolName: asString(schematicNetLabel.symbol_name),
      textPresentation,
    })
    for (const recordFields of recordFieldsList) {
      addSchematicRecord(recordFields, context.recordContext)
    }
  }
}

function appendNoConnectRecords(context: SchematicDocumentContext): void {
  for (const schematicPort of context.schematicElements.filter(
    (element) => element.type === "schematic_port",
  )) {
    const sourcePort = context.sourcePorts.get(
      asString(schematicPort.source_port_id),
    )
    if (sourcePort?.do_not_connect !== true) continue
    const circuitPortPosition = asPoint(schematicPort.center)
    if (!circuitPortPosition) continue
    addSchematicRecord(
      createAltiumSchematicNoConnectRecordFields({
        altiumNoConnectPosition:
          context.circuitToAltiumSchematicPoint(circuitPortPosition),
      }),
      context.recordContext,
    )
  }
}

export function appendSchematicConnectivityRecords(
  context: SchematicDocumentContext,
): void {
  appendOffSheetPortRecords(context)
  appendWireRecords(context)
  appendExplicitJunctionRecords(context)
  appendNetLabelRecords(context)
  appendNoConnectRecords(context)
}
