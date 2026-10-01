import {
  parseAltiumBinaryPcbDoc,
  parseAltiumPcbDoc,
  parseAltiumPrjPcb,
  parseAltiumSchDoc,
} from "altiumts"
import { ConverterStage } from "../converter-stage"
import type { NormalizedCircuitJson } from "../types"

export class ValidateAltiumDocumentsStage extends ConverterStage<
  NormalizedCircuitJson,
  true
> {
  _step(): void {
    const { pcb, project, schematics } = this.context
    if (!pcb || !project || !schematics) {
      throw new Error("Every document stage must finish before validation")
    }

    if (this.iteration === 1) {
      parseAltiumPcbDoc(pcb.asciiContent, { mode: "strict" })
      return
    }
    if (this.iteration === 2) {
      parseAltiumBinaryPcbDoc(pcb.content)
      return
    }
    const schematic = schematics[this.iteration - 3]
    if (schematic) {
      parseAltiumSchDoc(schematic.content)
      return
    }
    parseAltiumPrjPcb(project.content)
    this.context.validated = true
    this.finished = true
  }

  getOutput(): true {
    if (!this.context.validated) {
      throw new Error("Altium document validation has not finished")
    }
    return true
  }
}
