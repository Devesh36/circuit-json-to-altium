import { expect, test } from "bun:test"
import { CircuitJsonToAltiumConverter } from "../lib"

test("runs the Altium conversion pipeline one inspectable stage at a time", () => {
  const converter = new CircuitJsonToAltiumConverter(
    [
      { type: "pcb_board", width: 20, height: 12 },
      {
        type: "schematic_sheet",
        schematic_sheet_id: "sheet-a",
        sheet_index: 0,
      },
      {
        type: "schematic_sheet",
        schematic_sheet_id: "sheet-b",
        sheet_index: 1,
      },
    ],
    { projectName: "pipeline-board" },
  )
  const completedStages: Array<{ iterations: number; name: string }> = []

  while (!converter.finished) {
    const currentStage = converter.currentStage
    converter.step()
    if (currentStage?.finished) {
      completedStages.push({
        iterations: currentStage.iteration,
        name: currentStage.constructor.name,
      })
    }
  }

  expect(completedStages).toEqual([
    { iterations: 2, name: "BuildPcbDocumentStage" },
    { iterations: 3, name: "BuildSchematicDocumentsStage" },
    { iterations: 1, name: "BuildProjectDocumentStage" },
    { iterations: 6, name: "ValidateAltiumDocumentsStage" },
  ])
  expect(converter.getOutput().project.filename).toBe("pipeline-board.PrjPcb")
})
