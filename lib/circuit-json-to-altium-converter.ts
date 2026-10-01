import JSZip from "jszip"
import type { ConverterStage } from "./converter-stage"
import { sanitizeFilename } from "./format"
import { DEFAULT_SCHEMATIC_UNITS_PER_CIRCUIT_UNIT } from "./schematic-scale"
import { BuildPcbDocumentStage } from "./stages/build-pcb-document-stage"
import { BuildProjectDocumentStage } from "./stages/build-project-document-stage"
import { BuildSchematicDocumentsStage } from "./stages/build-schematic-documents-stage"
import { ValidateAltiumDocumentsStage } from "./stages/validate-altium-documents-stage"
import type {
  AltiumSchematicProjectContext,
  AltiumSchematicSheetOptions,
  CircuitElement,
  CircuitJsonInput,
  CircuitJsonToAltiumConverterContext,
  CircuitJsonToAltiumOutput,
  NormalizedCircuitJson,
} from "./types"

export type CircuitJsonToAltiumConverterOptions = {
  projectName?: string
  schematicSheets?: AltiumSchematicSheetOptions[]
  schematicProjectContext?: AltiumSchematicProjectContext
  /** Default 200 / 3, matching Circuit JSON junction size; imported templates retain 20. */
  schematicUnitsPerCircuitUnit?: number
}

function assertUniqueArchiveFilenames(filenames: string[]): void {
  const seenFilenames = new Set<string>()
  for (const filename of filenames) {
    const normalizedFilename = filename.toLocaleLowerCase("en-US")
    if (seenFilenames.has(normalizedFilename)) {
      throw new Error(`Duplicate Altium archive filename: ${filename}`)
    }
    seenFilenames.add(normalizedFilename)
  }
}

function normalizeCircuitJson(
  circuitJson: CircuitJsonInput,
): NormalizedCircuitJson {
  return circuitJson.map((element) => {
    const normalizedElement: CircuitElement = {}
    for (const [fieldName, field] of Object.entries(element)) {
      normalizedElement[fieldName] = field
    }
    return normalizedElement
  })
}

export class CircuitJsonToAltiumConverter {
  readonly context: CircuitJsonToAltiumConverterContext
  readonly pipeline: ConverterStage<NormalizedCircuitJson, unknown>[]
  currentStageIndex = 0
  finished = false

  constructor(
    circuitJson: CircuitJsonInput,
    options: CircuitJsonToAltiumConverterOptions = {},
  ) {
    const projectName = options.projectName ?? "board"
    const normalizedCircuitJson = normalizeCircuitJson(circuitJson)
    const hasTemplate = options.schematicSheets?.some(
      (sheet) => sheet.templateContent,
    )
    const schematicUnitsPerCircuitUnit =
      options.schematicUnitsPerCircuitUnit ??
      (hasTemplate ? 20 : DEFAULT_SCHEMATIC_UNITS_PER_CIRCUIT_UNIT)
    if (
      !Number.isFinite(schematicUnitsPerCircuitUnit) ||
      schematicUnitsPerCircuitUnit <= 0
    ) {
      throw new RangeError(
        "schematicUnitsPerCircuitUnit must be a positive finite number",
      )
    }
    if (schematicUnitsPerCircuitUnit !== 20 && hasTemplate) {
      throw new Error(
        "Custom schematic templates currently require schematicUnitsPerCircuitUnit=20",
      )
    }
    this.context = {
      circuitJson: normalizedCircuitJson,
      projectName,
      schematicProjectContext: options.schematicProjectContext,
      safeProjectName: sanitizeFilename(projectName),
      schematicSheets: options.schematicSheets ?? [],
      schematicUnitsPerCircuitUnit,
      validated: false,
    }
    this.pipeline = [
      new BuildPcbDocumentStage(normalizedCircuitJson, this.context),
      new BuildSchematicDocumentsStage(normalizedCircuitJson, this.context),
      new BuildProjectDocumentStage(normalizedCircuitJson, this.context),
      new ValidateAltiumDocumentsStage(normalizedCircuitJson, this.context),
    ]
  }

  get currentStage():
    | ConverterStage<NormalizedCircuitJson, unknown>
    | undefined {
    return this.pipeline[this.currentStageIndex]
  }

  step(): void {
    const stage = this.currentStage
    if (!stage) {
      this.finished = true
      return
    }
    stage.step()
    if (stage.finished) {
      this.currentStageIndex++
      this.finished = this.currentStageIndex >= this.pipeline.length
    }
  }

  runUntilFinished(): void {
    while (!this.finished) this.step()
  }

  getOutput(): CircuitJsonToAltiumOutput {
    const { pcb, project, schematics, validated } = this.context
    if (!this.finished || !validated || !pcb || !project || !schematics) {
      throw new Error("Converter must finish before its output is read")
    }
    return { pcb, project, schematics }
  }

  async getOutputZip(): Promise<Uint8Array> {
    const { pcb, project, schematics } = this.getOutput()
    assertUniqueArchiveFilenames([
      project.filename,
      pcb.filename,
      ...schematics.map(({ filename }) => filename),
      "README.txt",
    ])
    const zip = new JSZip()
    zip.file(project.filename, project.content)
    zip.file(pcb.filename, pcb.content)
    for (const schematic of schematics) {
      zip.file(schematic.filename, schematic.content)
    }
    zip.file(
      "README.txt",
      [
        `${this.context.projectName} — Altium Designer project`,
        "",
        "Generated in Altium's native binary document format from the board's routed Circuit JSON.",
        `Open ${project.filename} in Altium Designer.`,
      ].join("\r\n"),
    )
    return zip.generateAsync({ type: "uint8array" })
  }
}
