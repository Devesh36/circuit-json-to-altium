import type { AltiumSchematicSymbolRecords } from "./create-altium-schematic-symbol-records"
import { getAltiumSchematicTextPresentation } from "./get-altium-schematic-text-presentation"
import type { AltiumSchematicBoxBounds } from "./schematic-box-geometry"
import { addSchematicRecord } from "./schematic-document-records"
import type { SchematicDocumentContext } from "./schematic-document-types"
import type { CircuitElement } from "./types"

const ALTIUM_SCHEMATIC_DEFAULT_COLOR = 0x37_29_1f

export function appendSchematicComponentFieldRecords(
  {
    commentText,
    componentComment,
    designator,
    designatorText,
    fallbackBounds,
    shouldHideInferredDesignator,
    symbolRecords,
    altiumComponentRecordIndex,
  }: {
    commentText: CircuitElement | undefined
    componentComment: string
    designator: string
    designatorText: CircuitElement | undefined
    fallbackBounds: AltiumSchematicBoxBounds
    shouldHideInferredDesignator: boolean
    symbolRecords: AltiumSchematicSymbolRecords | undefined
    altiumComponentRecordIndex: number
  },
  context: SchematicDocumentContext,
): void {
  const designatorPresentation = getAltiumSchematicTextPresentation({
    circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
    fallbackAltiumColor: ALTIUM_SCHEMATIC_DEFAULT_COLOR,
    fallbackAltiumPosition: symbolRecords?.designatorPlacement?.position ?? {
      x: fallbackBounds.left,
      y: fallbackBounds.top + 12 * context.scaleRatio,
    },
    fallbackFontId: 1,
    fallbackJustification:
      symbolRecords?.designatorPlacement?.justification ?? 0,
    fontTable: context.nativeTextFontTable,
    schematicText: designatorText,
  })
  const commentPresentation = getAltiumSchematicTextPresentation({
    circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
    fallbackAltiumColor: ALTIUM_SCHEMATIC_DEFAULT_COLOR,
    fallbackAltiumPosition: symbolRecords?.commentPlacement?.position ?? {
      x: fallbackBounds.left,
      y: fallbackBounds.bottom - 12 * context.scaleRatio,
    },
    fallbackFontId: 2,
    fallbackJustification: symbolRecords?.commentPlacement?.justification ?? 0,
    fontTable: context.nativeTextFontTable,
    schematicText: commentText,
  })
  addSchematicRecord(
    [
      "RECORD=34",
      `OWNERINDEX=${altiumComponentRecordIndex}`,
      "OWNERPARTID=-1",
      `LOCATION.X=${designatorPresentation.position.x}`,
      `LOCATION.Y=${designatorPresentation.position.y}`,
      `FONTID=${designatorPresentation.fontId}`,
      "NAME=Designator",
      `TEXT=${designator}`,
      `COLOR=${designatorPresentation.color}`,
      "SHOWNAME=F",
      `ISHIDDEN=${shouldHideInferredDesignator ? "T" : "F"}`,
      `ORIENTATION=${designatorPresentation.orientation}`,
      `JUSTIFICATION=${designatorPresentation.justification}`,
    ],
    context.recordContext,
  )
  addSchematicRecord(
    [
      "RECORD=41",
      `OWNERINDEX=${altiumComponentRecordIndex}`,
      "OWNERPARTID=-1",
      `LOCATION.X=${commentPresentation.position.x}`,
      `LOCATION.Y=${commentPresentation.position.y}`,
      `FONTID=${commentPresentation.fontId}`,
      "NAME=Comment",
      `TEXT=${componentComment}`,
      `COLOR=${commentPresentation.color}`,
      "SHOWNAME=F",
      `ISHIDDEN=${componentComment ? "F" : "T"}`,
      `ORIENTATION=${commentPresentation.orientation}`,
      `JUSTIFICATION=${commentPresentation.justification}`,
    ],
    context.recordContext,
  )
}
