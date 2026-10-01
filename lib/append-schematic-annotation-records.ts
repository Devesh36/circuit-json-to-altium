import { createAltiumSchematicSheetAnnotationRecordFields } from "./create-altium-schematic-sheet-annotation-record-fields"
import { addSchematicRecord } from "./schematic-document-records"
import type { SchematicDocumentContext } from "./schematic-document-types"

export function appendSchematicAnnotationRecords(
  context: SchematicDocumentContext,
): void {
  for (const annotation of context.schematicElements) {
    if (
      context.consumedSheetTexts.has(annotation) ||
      context.filledSheetBackgrounds.has(annotation)
    ) {
      continue
    }
    const recordFields = createAltiumSchematicSheetAnnotationRecordFields({
      annotation,
      circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
      fontTable: context.nativeTextFontTable,
    })
    if (recordFields) addSchematicRecord(recordFields, context.recordContext)
  }
}
