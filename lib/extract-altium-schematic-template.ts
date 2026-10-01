import {
  type AltiumPrjPcb,
  type AltiumRecord,
  AltiumSchDoc,
  type AltiumSchematicEmbeddedImageInput,
  parseAltiumFile,
  resolveSchematicParameterReferenceWithContext,
} from "altiumts"

export type AltiumSchematicTemplateFontFields = {
  fields: string[]
  sourceFontId: number
}

export type AltiumSchematicTemplate = {
  embeddedImages: AltiumSchematicEmbeddedImageInput[]
  fontFields: AltiumSchematicTemplateFontFields[]
  recordFields: string[][]
  sheetRecordFields: string[]
}

type ResolveSchematicTemplateProjectContext = {
  currentDate?: string
  currentTime?: string
  documentName?: string
  project?: AltiumPrjPcb
  projectName?: string
}

const TEMPLATE_RECORD_KIND = "39"
const IMAGE_RECORD_KIND = "30"
const GENERATED_SHEET_FIELD_NAMES = new Set([
  "AREACOLOR",
  "CUSTOMX",
  "CUSTOMY",
  "FONTIDCOUNT",
  "RECORD",
  "SNAPGRIDON",
  "SNAPGRIDSIZE",
  "USECUSTOMSHEET",
])
const FONT_FIELD_PATTERN =
  /^(?:BOLD|FONTNAME|ITALIC|ROTATION|SIZE|STRIKEOUT|UNDERLINE)(\d+)$/u

function hasRecordAncestor({
  ancestor,
  document,
  record,
}: {
  ancestor: AltiumRecord
  document: AltiumSchDoc
  record: AltiumRecord
}): boolean {
  const visitedRecords = new Set<AltiumRecord>()
  let currentRecord = document.getParent(record)
  while (currentRecord && !visitedRecords.has(currentRecord)) {
    if (currentRecord === ancestor) return true
    visitedRecords.add(currentRecord)
    currentRecord = document.getParent(currentRecord)
  }
  return false
}

function getTemplateFontFields(
  sheetRecord: AltiumRecord | undefined,
): AltiumSchematicTemplateFontFields[] {
  if (!sheetRecord) return []
  const fieldsByFontId = new Map<number, string[]>()
  for (const field of sheetRecord.fields) {
    const match = FONT_FIELD_PATTERN.exec(field.key.toUpperCase())
    const sourceFontId = Number(match?.[1])
    if (!Number.isSafeInteger(sourceFontId) || sourceFontId < 1) continue
    fieldsByFontId.set(sourceFontId, [
      ...(fieldsByFontId.get(sourceFontId) ?? []),
      `${field.key}=${field.value}`,
    ])
  }
  return [...fieldsByFontId.entries()]
    .sort(([leftFontId], [rightFontId]) => leftFontId - rightFontId)
    .map(([sourceFontId, fields]) => ({ fields, sourceFontId }))
}

function getTemplateSheetRecordFields(
  sheetRecord: AltiumRecord | undefined,
): string[] {
  if (!sheetRecord) return []
  return sheetRecord.fields.flatMap((field) => {
    const normalizedFieldName = field.key.toUpperCase()
    if (
      GENERATED_SHEET_FIELD_NAMES.has(normalizedFieldName) ||
      FONT_FIELD_PATTERN.test(normalizedFieldName)
    ) {
      return []
    }
    return [`${field.key}=${field.value}`]
  })
}

function getReferencedTemplateParameterNames(
  templateRecords: AltiumRecord[],
): Set<string> {
  return new Set(
    templateRecords.flatMap((record) => {
      const text = record.getDecoded("TEXT") ?? ""
      return text.startsWith("=") && text.length > 1 ? [text.slice(1)] : []
    }),
  )
}

function resolveTemplateRecordText({
  defaultText,
  document,
  projectContext,
  reference,
}: {
  defaultText: string
  document: AltiumSchDoc
  projectContext?: ResolveSchematicTemplateProjectContext
  reference: string
}): string {
  const parameterReferenceValue =
    resolveSchematicParameterReferenceWithContext({
      document,
      reference,
      ...projectContext,
    }) ?? undefined
  if (parameterReferenceValue !== undefined) return parameterReferenceValue

  if (reference.startsWith("=") && projectContext) {
    const parameterName = reference.slice(1).toLowerCase()
    if (
      parameterName === "currentdate" &&
      projectContext.currentDate !== undefined
    ) {
      return projectContext.currentDate
    }
    if (
      parameterName === "currenttime" &&
      projectContext.currentTime !== undefined
    ) {
      return projectContext.currentTime
    }
  }

  return defaultText
}

export function extractAltiumSchematicTemplate({
  content,
  projectContext,
}: {
  content: Uint8Array
  projectContext?: ResolveSchematicTemplateProjectContext
}): AltiumSchematicTemplate {
  const document = parseAltiumFile(content).document
  if (!(document instanceof AltiumSchDoc)) {
    throw new TypeError(
      `Expected an Altium SchDot or SchDoc template, got ${document.type}`,
    )
  }
  const sourceRecords = document.records
  const templateRecord = sourceRecords.find(
    (record) => record.recordKind === TEMPLATE_RECORD_KIND,
  )
  if (!templateRecord) {
    throw new TypeError("Altium schematic template has no RECORD=39 template")
  }
  const templateRecords = sourceRecords.filter(
    (record) =>
      record === templateRecord ||
      hasRecordAncestor({ ancestor: templateRecord, document, record }),
  )
  const referencedParameterNames =
    getReferencedTemplateParameterNames(templateRecords)
  const preservedRecords = sourceRecords.filter((record) => {
    if (templateRecords.includes(record)) return true
    if (
      record.recordKind === IMAGE_RECORD_KIND &&
      document.getParent(record) === undefined
    ) {
      return true
    }
    return (
      record.recordKind === "41" &&
      document.getParent(record) === undefined &&
      referencedParameterNames.has(record.getDecoded("NAME") ?? "")
    )
  })
  const preservedRecordSet = new Set(preservedRecords)
  const generatedRecordIndexBySourceRecord = new Map(
    preservedRecords.map((record, index) => [record, index + 1]),
  )
  const recordFields = preservedRecords.map((record) => {
    const parent = document.getParent(record)
    const generatedOwnerIndex = parent
      ? generatedRecordIndexBySourceRecord.get(parent)
      : undefined
    return record.fields.map((field) => {
      if (field.key.toUpperCase() !== "OWNERINDEX") {
        const sourceFieldText = `${field.value}`
        if (field.key.toUpperCase() !== "TEXT") {
          return `${field.key}=${sourceFieldText}`
        }
        return `${field.key}=${resolveTemplateRecordText({
          defaultText: sourceFieldText,
          document,
          projectContext,
          reference: sourceFieldText,
        })}`
      }
      if (generatedOwnerIndex === undefined) {
        throw new TypeError(
          "Altium schematic template record has an owner outside its template",
        )
      }
      return `${field.key}=${generatedOwnerIndex}`
    })
  })
  const sheetRecord = sourceRecords.find((record) => record.recordKind === "31")

  return {
    embeddedImages: document.embeddedImages.flatMap((image) =>
      preservedRecordSet.has(image.record)
        ? [
            {
              compressedBytes: image.getCompressedBytes(),
              name: image.name,
            },
          ]
        : [],
    ),
    fontFields: getTemplateFontFields(sheetRecord),
    recordFields,
    sheetRecordFields: getTemplateSheetRecordFields(sheetRecord),
  }
}
