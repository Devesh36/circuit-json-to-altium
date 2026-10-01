import { expect, test } from "bun:test"
import ts from "typescript"

// These are repository-specific review budgets, not tscircuit handbook rules.
const MAX_FUNCTION_LINES = 250
const MAX_LIBRARY_FILE_LINES = 400

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node)
  )
}

function collectOversizedFunctions({
  node,
  path,
  sourceFile,
  violations,
}: {
  node: ts.Node
  path: string
  sourceFile: ts.SourceFile
  violations: string[]
}): void {
  if (isFunctionLike(node) && node.body) {
    const startLine = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    ).line
    const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line
    const lineCount = endLine - startLine + 1
    if (lineCount > MAX_FUNCTION_LINES) {
      violations.push(
        `${path}:${startLine + 1} exceeds the repository budget of ${MAX_FUNCTION_LINES} function lines (${lineCount})`,
      )
    }
  }

  node.forEachChild((childNode) =>
    collectOversizedFunctions({
      node: childNode,
      path,
      sourceFile,
      violations,
    }),
  )
}

test("library source stays within repository maintainability budgets", async () => {
  const violations: string[] = []
  const sourceGlob = new Bun.Glob("lib/**/*.ts")
  for await (const path of sourceGlob.scan(".")) {
    const sourceText = await Bun.file(path).text()
    const sourceFile = ts.createSourceFile(
      path,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
    )
    const fileLineCount = sourceText.split(/\r?\n/u).length
    if (fileLineCount > MAX_LIBRARY_FILE_LINES) {
      violations.push(
        `${path}:1 exceeds the repository budget of ${MAX_LIBRARY_FILE_LINES} file lines (${fileLineCount})`,
      )
    }
    collectOversizedFunctions({
      node: sourceFile,
      path,
      sourceFile,
      violations,
    })
  }

  expect(violations).toEqual([])
})
