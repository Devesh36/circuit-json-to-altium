import { serializeAltiumSchDocToBinary } from "altiumts"
import { ConverterStage } from "../converter-stage"
import type { AltiumSchematicChildSheet } from "../create-altium-schematic-sheet-symbol-records"
import { createHairlinePowerPortDefinitions } from "../create-hairline-power-port-definitions"
import { createSchematicDocument } from "../create-schematic-document"
import { extractAltiumSchematicTemplate } from "../extract-altium-schematic-template"
import {
  asNumber,
  asString,
  byType,
  isWindowsReservedFilename,
} from "../format"
import type {
  AltiumSchematicFile,
  AltiumSchematicSheetOptions,
  CircuitJsonToAltiumConverterContext,
  NormalizedCircuitJson,
  SchematicSheetId,
} from "../types"

function getSchematicSheetSettings(
  schematicSheets: AltiumSchematicSheetOptions[],
  schematicSheetId: SchematicSheetId | undefined,
): AltiumSchematicSheetOptions | undefined {
  return schematicSheets.find(
    (sheet) => sheet.schematicSheetId === schematicSheetId,
  )
}

type SchematicSourceFilenameKey = string

type SchematicFilenameCandidate = {
  identityKey: SchematicSourceFilenameKey
  preferredFilename: string
}

function getSchematicFilenameCandidate({
  fallbackFilename,
  sourceFilename,
}: {
  fallbackFilename: string
  sourceFilename: string
}): SchematicFilenameCandidate {
  const normalizedSourceFilename = sourceFilename.replaceAll("\\", "/").trim()
  const filenameWithoutDirectories = normalizedSourceFilename.split("/").at(-1)
  const filenameWithoutExtension = filenameWithoutDirectories?.replace(
    /\.SchDoc$/iu,
    "",
  )
  let safeFilename = filenameWithoutExtension
    ?.replace(/[<>:"/\\|?*]/gu, "-")
    .replace(/[. ]+$/gu, "")
    .trim()
  for (let characterCode = 0; characterCode <= 31; characterCode++) {
    safeFilename = safeFilename?.replaceAll(
      String.fromCharCode(characterCode),
      "-",
    )
  }
  if (!safeFilename) {
    return {
      identityKey: `fallback:${fallbackFilename.toLocaleLowerCase("en-US")}`,
      preferredFilename: fallbackFilename,
    }
  }
  const preferredFilename = `${isWindowsReservedFilename(safeFilename) ? `board-${safeFilename}` : safeFilename}.SchDoc`
  return {
    identityKey: `source:${normalizedSourceFilename.toLocaleLowerCase("en-US")}`,
    preferredFilename,
  }
}

function reserveUniqueSchematicFilename({
  preferredFilename,
  reservedFilenames,
}: {
  preferredFilename: string
  reservedFilenames: Set<string>
}): string {
  const extension = ".SchDoc"
  const baseFilename = preferredFilename.endsWith(extension)
    ? preferredFilename.slice(0, -extension.length)
    : preferredFilename
  let suffix = 1
  let filename = `${baseFilename}${extension}`
  while (reservedFilenames.has(filename.toLocaleLowerCase("en-US"))) {
    suffix++
    filename = `${baseFilename}-${suffix}${extension}`
  }
  reservedFilenames.add(filename.toLocaleLowerCase("en-US"))
  return filename
}

type SchematicDocumentDefinition = {
  childSheets: AltiumSchematicChildSheet[]
  filename: string
  includeAllSchematicElements: boolean
  schematicSheetId: SchematicSheetId | undefined
}

export class BuildSchematicDocumentsStage extends ConverterStage<
  NormalizedCircuitJson,
  AltiumSchematicFile[]
> {
  private readonly documentDefinitions: SchematicDocumentDefinition[]
  private documentIndex = 0

  constructor(
    input: NormalizedCircuitJson,
    context: CircuitJsonToAltiumConverterContext,
  ) {
    super(input, context)
    this.documentDefinitions = this.createDocumentDefinitions()
    this.context.schematics = []
  }

  private createDocumentDefinitions(): SchematicDocumentDefinition[] {
    const sheets = byType(this.input, "schematic_sheet").sort(
      (leftSheet, rightSheet) =>
        asNumber(leftSheet.sheet_index) - asNumber(rightSheet.sheet_index),
    )
    const rootFilename = `${this.context.safeProjectName}.SchDoc`
    const reservedFilenames = new Set([rootFilename.toLocaleLowerCase("en-US")])
    const filenameBySource = new Map<SchematicSourceFilenameKey, string>()
    const childSheets: AltiumSchematicChildSheet[] = sheets.map(
      (sheet, index) => {
        const fallbackFilename = `${this.context.safeProjectName}-${String(index + 1).padStart(2, "0")}.SchDoc`
        const candidate = getSchematicFilenameCandidate({
          fallbackFilename,
          sourceFilename: asString(sheet.source_filename),
        })
        let filename = filenameBySource.get(candidate.identityKey)
        if (!filename) {
          filename = reserveUniqueSchematicFilename({
            preferredFilename: candidate.preferredFilename,
            reservedFilenames,
          })
          filenameBySource.set(candidate.identityKey, filename)
        }
        return {
          filename,
          name:
            asString(sheet.display_name) ||
            asString(sheet.name) ||
            `Sheet ${index + 1}`,
          schematicSheetId: asString(sheet.schematic_sheet_id),
          subcircuitId: asString(sheet.subcircuit_id) || undefined,
        }
      },
    )
    const seenChildFilenames = new Set<string>()
    const uniqueChildSheets = childSheets.filter((childSheet) => {
      const normalizedFilename = childSheet.filename.toLocaleLowerCase("en-US")
      if (seenChildFilenames.has(normalizedFilename)) return false
      seenChildFilenames.add(normalizedFilename)
      return true
    })
    return childSheets.length === 0
      ? [
          {
            childSheets: [],
            filename: rootFilename,
            includeAllSchematicElements: true,
            schematicSheetId: undefined,
          },
        ]
      : [
          {
            childSheets,
            filename: rootFilename,
            includeAllSchematicElements: false,
            schematicSheetId: undefined,
          },
          ...uniqueChildSheets.map((childSheet) => ({
            childSheets: [],
            filename: childSheet.filename,
            includeAllSchematicElements: false,
            schematicSheetId: childSheet.schematicSheetId,
          })),
        ]
  }

  _step(): void {
    const definition = this.documentDefinitions[this.documentIndex]
    if (!definition) {
      this.finished = true
      return
    }
    const sheetOptions = getSchematicSheetSettings(
      this.context.schematicSheets,
      definition.schematicSheetId,
    )
    const template = sheetOptions?.templateContent
      ? extractAltiumSchematicTemplate({
          content: sheetOptions.templateContent,
          projectContext: this.context.schematicProjectContext,
        })
      : undefined
    const asciiContent = createSchematicDocument({
      unitsPerCircuitUnit: this.context.schematicUnitsPerCircuitUnit,
      childSheets: definition.childSheets,
      circuitJson: this.input,
      schematicSheetId: definition.schematicSheetId,
      includeAllSchematicElements: definition.includeAllSchematicElements,
      sheetSettings: sheetOptions,
      template,
    })
    const schematics = this.context.schematics
    if (!schematics) {
      throw new Error("Schematic document stage was not initialized")
    }
    schematics.push({
      asciiContent,
      content: serializeAltiumSchDocToBinary(asciiContent, {
        embeddedImages: template?.embeddedImages,
        objectDefinitionRecords: createHairlinePowerPortDefinitions(
          asciiContent,
          this.context.schematicUnitsPerCircuitUnit / 20,
        ),
      }),
      filename: definition.filename,
    })
    this.documentIndex++
    this.finished = this.documentIndex >= this.documentDefinitions.length
  }

  getOutput(): AltiumSchematicFile[] {
    if (!this.context.schematics) {
      throw new Error("Schematic document stage has not finished")
    }
    return this.context.schematics
  }
}
