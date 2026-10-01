import type { AltiumSchematicFontTable } from "./create-altium-schematic-font-table"
import type { AltiumSchematicChildSheet } from "./create-altium-schematic-sheet-symbol-records"
import type { AltiumSchematicTemplate } from "./extract-altium-schematic-template"
import type {
  AltiumSchematicSheetSettings,
  CircuitElement,
  LengthTransform,
  Point,
  PointTransform,
  SourcePortId,
} from "./types"

export type CreateSchematicDocumentOptions = {
  unitsPerCircuitUnit?: number
  childSheets?: AltiumSchematicChildSheet[]
  circuitJson: CircuitElement[]
  includeAllSchematicElements: boolean
  schematicSheetId: string | undefined
  sheetSettings?: AltiumSchematicSheetSettings
  template?: AltiumSchematicTemplate
}

export type SchematicRecordContext = {
  lines: string[]
  nextRecordIndex: number
}

export type SchematicNetLabelPlan = {
  circuitLabelPosition: Point
  labelText: string
  netLabelIndex: number
  schematicNetLabel: CircuitElement
  textPresentation: CircuitElement | undefined
}

export type SchematicDocumentContext = {
  altiumSchematicFontTable: AltiumSchematicFontTable
  childSheets: AltiumSchematicChildSheet[]
  circuitJson: CircuitElement[]
  circuitToAltiumSchematicLength: LengthTransform
  circuitToAltiumSchematicPoint: PointTransform
  circuitToAltiumSchematicPrecisePoint: PointTransform
  consumedSheetTexts: Set<CircuitElement>
  contentHeight: number
  contentWidth: number
  explicitlyPositionedSheetSymbolComponents: Set<CircuitElement>
  filledSheetBackgrounds: Set<CircuitElement>
  nativeTextFontTable: AltiumSchematicFontTable
  netLabelPlans: SchematicNetLabelPlan[]
  recordContext: SchematicRecordContext
  scaleRatio: number
  schematicElements: CircuitElement[]
  sourcePorts: Map<SourcePortId, CircuitElement>
  template: AltiumSchematicTemplate | undefined
  unitsPerCircuitUnit: number
}
