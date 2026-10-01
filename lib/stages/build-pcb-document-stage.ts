import { ConverterStage } from "../converter-stage"
import { createPcbDocument } from "../create-pcb-document"
import { serializeAltiumPcbDocWithKeepoutRules } from "../serialize-altium-pcb-doc-with-keepout-rules"
import type { AltiumPcbFile, NormalizedCircuitJson } from "../types"

export class BuildPcbDocumentStage extends ConverterStage<
  NormalizedCircuitJson,
  AltiumPcbFile
> {
  private asciiContent: string | undefined

  _step(): void {
    if (this.asciiContent === undefined) {
      this.asciiContent = createPcbDocument(this.input)
      return
    }
    this.context.pcb = {
      asciiContent: this.asciiContent,
      content: serializeAltiumPcbDocWithKeepoutRules(this.asciiContent),
      filename: `${this.context.safeProjectName}.PcbDoc`,
    }
    this.finished = true
  }

  getOutput(): AltiumPcbFile {
    if (!this.context.pcb) {
      throw new Error("PCB document stage has not finished")
    }
    return this.context.pcb
  }
}
