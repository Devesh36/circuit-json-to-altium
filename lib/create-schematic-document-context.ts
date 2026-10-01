import { createAltiumSchematicFontTable } from "./create-altium-schematic-font-table"
import { getAltiumPowerPortStyle } from "./create-altium-schematic-net-label-record-fields"
import { findSchematicTextPresentation } from "./find-schematic-text-presentation"
import { asPoint, asString, byType, sanitizeField } from "./format"
import { getSchematicTransform } from "./get-schematic-transform"
import { isSchematicSheetAnnotation } from "./is-schematic-sheet-annotation"
import { createSchematicRecordContext } from "./schematic-document-records"
import type {
  CreateSchematicDocumentOptions,
  SchematicDocumentContext,
  SchematicNetLabelPlan,
} from "./schematic-document-types"
import type { CircuitElement, SourcePortId } from "./types"

function doesElementBelongToSchematicSheet({
  element,
  includeAllSchematicElements,
  schematicSheetId,
}: {
  element: CircuitElement
  includeAllSchematicElements: boolean
  schematicSheetId: string | undefined
}): boolean {
  const elementSchematicSheetId = asString(element.schematic_sheet_id)
  return schematicSheetId
    ? elementSchematicSheetId === schematicSheetId ||
        (includeAllSchematicElements && !elementSchematicSheetId)
    : !elementSchematicSheetId || includeAllSchematicElements
}

function createNetLabelPlans({
  consumedSheetTexts,
  schematicElements,
}: {
  consumedSheetTexts: Set<CircuitElement>
  schematicElements: CircuitElement[]
}): SchematicNetLabelPlan[] {
  const sheetTexts = schematicElements.filter(
    (element) =>
      element.type === "schematic_text" && isSchematicSheetAnnotation(element),
  )
  const netLabelPlans: SchematicNetLabelPlan[] = []
  for (const [netLabelIndex, schematicNetLabel] of schematicElements
    .filter((element) => element.type === "schematic_net_label")
    .entries()) {
    const labelText = sanitizeField(schematicNetLabel.text)
    if (!labelText) continue
    const circuitLabelPosition = asPoint(schematicNetLabel.anchor_position) ??
      asPoint(schematicNetLabel.center) ?? { x: 0, y: 0 }
    const textPresentation = findSchematicTextPresentation({
      excludedTexts: consumedSheetTexts,
      renderedText: labelText,
      schematicTexts: sheetTexts,
      targetPosition: circuitLabelPosition,
    })
    if (textPresentation) consumedSheetTexts.add(textPresentation)
    netLabelPlans.push({
      circuitLabelPosition,
      labelText,
      netLabelIndex,
      schematicNetLabel,
      textPresentation,
    })
  }
  return netLabelPlans
}

export function createSchematicDocumentContext({
  unitsPerCircuitUnit = 20,
  childSheets = [],
  circuitJson,
  includeAllSchematicElements,
  schematicSheetId,
  sheetSettings,
  template,
}: CreateSchematicDocumentOptions): SchematicDocumentContext {
  const sourcePorts = new Map<SourcePortId, CircuitElement>(
    byType(circuitJson, "source_port").map((sourcePort) => [
      asString(sourcePort.source_port_id),
      sourcePort,
    ]),
  )
  const schematicElements = circuitJson.filter(
    (element) =>
      element.type?.startsWith("schematic_") === true &&
      element.type !== "schematic_sheet" &&
      !(
        element.type === "schematic_port" &&
        !asString(element.schematic_component_id) &&
        element.is_connected === false &&
        sourcePorts.get(asString(element.source_port_id))?.do_not_connect !==
          true
      ) &&
      doesElementBelongToSchematicSheet({
        element,
        includeAllSchematicElements,
        schematicSheetId,
      }),
  )
  const schematicTransform = getSchematicTransform(schematicElements, {
    sheetSettings,
    unitsPerCircuitUnit,
  })
  const consumedSheetTexts = new Set<CircuitElement>()
  const netLabelPlans = createNetLabelPlans({
    consumedSheetTexts,
    schematicElements,
  })
  const altiumSchematicFontTable = createAltiumSchematicFontTable({
    unitsPerCircuitUnit,
    netLabelTextPresentations: netLabelPlans.flatMap(
      ({ schematicNetLabel, textPresentation }) =>
        textPresentation &&
        !getAltiumPowerPortStyle(asString(schematicNetLabel.symbol_name))
          ? [textPresentation]
          : [],
    ),
    schematicElements,
    templateFontFields: template?.fontFields,
  })

  return {
    altiumSchematicFontTable,
    childSheets,
    circuitJson,
    circuitToAltiumSchematicLength:
      schematicTransform.circuitToAltiumSchematicLength,
    circuitToAltiumSchematicPoint:
      schematicTransform.circuitToAltiumSchematicPoint,
    circuitToAltiumSchematicPrecisePoint:
      schematicTransform.circuitToAltiumSchematicPrecisePoint,
    consumedSheetTexts,
    contentHeight: schematicTransform.height,
    contentWidth: schematicTransform.width,
    explicitlyPositionedSheetSymbolComponents: new Set<CircuitElement>(),
    filledSheetBackgrounds: new Set<CircuitElement>(),
    nativeTextFontTable: {
      ...altiumSchematicFontTable,
      fontIdBySizeCircuitUnits:
        altiumSchematicFontTable.nativeTextFontIdBySizeCircuitUnits,
    },
    netLabelPlans,
    recordContext: createSchematicRecordContext(),
    scaleRatio: unitsPerCircuitUnit / 20,
    schematicElements,
    sourcePorts,
    template,
    unitsPerCircuitUnit,
  }
}
