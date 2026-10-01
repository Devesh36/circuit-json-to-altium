import { expect, test } from "bun:test"
import { board, type CircuitElement, extractArchive } from "./fixtures"

test("avoids filename collisions while reusing intentional sheet links", async () => {
  const elements: CircuitElement[] = [
    board(),
    {
      type: "schematic_sheet",
      schematic_sheet_id: "root-name-collision",
      sheet_index: 0,
      source_filename: "project.SchDoc",
    },
    {
      type: "schematic_sheet",
      schematic_sheet_id: "reserved-windows-name",
      sheet_index: 1,
      source_filename: "CON.backup.SchDoc",
    },
    {
      type: "schematic_sheet",
      schematic_sheet_id: "duplicate-name-a",
      sheet_index: 2,
      source_filename: "shared.SchDoc",
    },
    {
      type: "schematic_sheet",
      schematic_sheet_id: "duplicate-name-b",
      sheet_index: 3,
      source_filename: "SHARED.schdoc",
    },
  ]

  const result = await extractArchive(elements, "project")
  const schematicFilenames = result.schematicSources.map(
    ({ filename }) => filename,
  )

  expect(schematicFilenames).toEqual([
    "board-CON.backup.SchDoc",
    "project-2.SchDoc",
    "project.SchDoc",
    "shared.SchDoc",
  ])
  expect(new Set(schematicFilenames).size).toBe(4)
  expect(
    result.project.documents
      .map(({ path }) => path)
      .filter((path) => path.endsWith(".SchDoc")),
  ).toEqual([
    "project.SchDoc",
    "project-2.SchDoc",
    "board-CON.backup.SchDoc",
    "shared.SchDoc",
  ])
  const rootSchematicIndex = result.schematicSources.findIndex(
    ({ filename }) => filename === "project.SchDoc",
  )
  expect(
    result.schematics[rootSchematicIndex]?.sheetLinks.map(
      ({ fileName }) => fileName,
    ),
  ).toEqual([
    "project-2.SchDoc",
    "board-CON.backup.SchDoc",
    "shared.SchDoc",
    "shared.SchDoc",
  ])
})
