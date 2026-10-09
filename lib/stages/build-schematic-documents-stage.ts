import { serializeAltiumSchDocToBinary } from "altiumts"
import { ConverterStage } from "../converter-stage"
import type { AltiumSchematicChildSheet } from "../create-altium-schematic-sheet-symbol-records"
import { createHairlinePowerPortDefinitions } from "../create-hairline-power-port-definitions"
import { createSchematicDocument } from "../create-schematic-document"
import { extractAltiumSchematicTemplate } from "../extract-altium-schematic-template"
import { asNumber, asString, byType } from "../format"
import type {
  AltiumSchematicFile,
  AltiumSchematicSheetOptions,
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

function getSchematicFilename({
  fallbackFilename,
  sourceFilename,
}: {
  fallbackFilename: string
  sourceFilename: string
}): string {
  const filenameWithoutDirectories = sourceFilename
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)
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

  return safeFilename ? `${safeFilename}.SchDoc` : fallbackFilename
}

export class BuildSchematicDocumentsStage extends ConverterStage<
  NormalizedCircuitJson,
  AltiumSchematicFile[]
> {
  _step(): void {
    const sheets = byType(this.input, "schematic_sheet").sort(
      (leftSheet, rightSheet) =>
        asNumber(leftSheet.sheet_index) - asNumber(rightSheet.sheet_index),
    )
    const childSheets: AltiumSchematicChildSheet[] = sheets.map(
      (sheet, index) => {
        const fallbackFilename = `${this.context.safeProjectName}-${String(index + 1).padStart(2, "0")}.SchDoc`
        return {
          filename: getSchematicFilename({
            fallbackFilename,
            sourceFilename: asString(sheet.source_filename),
          }),
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
    const documentDefinitions =
      childSheets.length === 0
        ? [
            {
              childSheets: [],
              filename: `${this.context.safeProjectName}.SchDoc`,
              includeAllSchematicElements: true,
              schematicSheetId: undefined,
            },
          ]
        : [
            {
              childSheets,
              filename: `${this.context.safeProjectName}.SchDoc`,
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
    this.context.schematics = documentDefinitions.map((definition) => {
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
      const embeddedImages = [...(template?.embeddedImages ?? [])]
      const asciiContent = createSchematicDocument({
        unitsPerCircuitUnit: this.context.schematicUnitsPerCircuitUnit,
        childSheets: definition.childSheets,
        circuitJson: this.input,
        schematicSheetId: definition.schematicSheetId,
        includeAllSchematicElements: definition.includeAllSchematicElements,
        sheetSettings: sheetOptions,
        template,
        embeddedImages,
      })
      return {
        asciiContent,
        content: serializeAltiumSchDocToBinary(asciiContent, {
          embeddedImages,
          objectDefinitionRecords: createHairlinePowerPortDefinitions(
            asciiContent,
            this.context.schematicUnitsPerCircuitUnit / 20,
          ),
        }),
        filename: definition.filename,
      }
    })
    this.finished = true
  }

  getOutput(): AltiumSchematicFile[] {
    if (!this.context.schematics) {
      throw new Error("Schematic document stage has not finished")
    }
    return this.context.schematics
  }
}
