import { appendSchematicAnnotationRecords } from "./append-schematic-annotation-records"
import { appendSchematicComponentRecords } from "./append-schematic-component-records"
import { appendSchematicConnectionJunctions } from "./append-schematic-connection-junctions"
import { appendSchematicConnectivityRecords } from "./append-schematic-connectivity-records"
import { appendSchematicSheetRecords } from "./append-schematic-sheet-records"
import { createSchematicDocumentContext } from "./create-schematic-document-context"
import type { CreateSchematicDocumentOptions } from "./schematic-document-types"

export function createSchematicDocument(
  options: CreateSchematicDocumentOptions,
): string {
  const context = createSchematicDocumentContext(options)
  appendSchematicSheetRecords(context)
  appendSchematicComponentRecords(context)
  appendSchematicConnectivityRecords(context)
  appendSchematicAnnotationRecords(context)
  return appendSchematicConnectionJunctions(
    `${context.recordContext.lines.join("\r\n")}\r\n`,
  )
}
