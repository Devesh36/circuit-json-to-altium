import { expect, test } from "bun:test"
import ts from "typescript"

type CodeConventionScanContext = {
  functionDepth: number
  path: string
  sourceFile: ts.SourceFile
  violations: string[]
}

const BANNED_STANDALONE_NAMES = new Set(["data", "info", "param", "value"])
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

function getNodeLocation(node: ts.Node, context: CodeConventionScanContext) {
  const { line } = context.sourceFile.getLineAndCharacterOfPosition(
    node.getStart(context.sourceFile),
  )
  return `${context.path}:${line + 1}`
}

function isDeclaredIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node)
  )
}

function scanNode(node: ts.Node, context: CodeConventionScanContext): void {
  if (isFunctionLike(node) && node.parameters.length > 2) {
    context.violations.push(
      `${getNodeLocation(node, context)} uses more than two function parameters`,
    )
  }
  if (isFunctionLike(node) && node.body) {
    const startLine = context.sourceFile.getLineAndCharacterOfPosition(
      node.getStart(context.sourceFile),
    ).line
    const endLine = context.sourceFile.getLineAndCharacterOfPosition(
      node.end,
    ).line
    if (endLine - startLine + 1 > MAX_FUNCTION_LINES) {
      context.violations.push(
        `${getNodeLocation(node, context)} exceeds ${MAX_FUNCTION_LINES} lines`,
      )
    }
  }
  if (
    context.functionDepth > 0 &&
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    context.violations.push(
      `${getNodeLocation(node, context)} declares a named closure`,
    )
  }
  if (
    ts.isIdentifier(node) &&
    isDeclaredIdentifier(node) &&
    BANNED_STANDALONE_NAMES.has(node.text.toLowerCase())
  ) {
    context.violations.push(
      `${getNodeLocation(node, context)} uses banned vague name ${node.text}`,
    )
  }
  if (
    context.functionDepth > 0 &&
    ts.isFunctionDeclaration(node) &&
    node.name
  ) {
    context.violations.push(
      `${getNodeLocation(node, context)} declares a nested named function`,
    )
  }
  if (
    ts.isTypeReferenceNode(node) &&
    node.typeName.getText(context.sourceFile) === "Map" &&
    node.typeArguments?.[0]?.kind === ts.SyntaxKind.StringKeyword
  ) {
    context.violations.push(
      `${getNodeLocation(node, context)} uses Map<string, ...>`,
    )
  }
  if (
    ts.isAsExpression(node) &&
    (node.type.kind === ts.SyntaxKind.AnyKeyword ||
      node.type.kind === ts.SyntaxKind.UnknownKeyword)
  ) {
    context.violations.push(
      `${getNodeLocation(node, context)} uses an unsafe type assertion`,
    )
  }

  const functionDepth = context.functionDepth + (isFunctionLike(node) ? 1 : 0)
  node.forEachChild((childNode) =>
    scanNode(childNode, { ...context, functionDepth }),
  )
}

test("library code follows the enforceable handbook conventions", async () => {
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
    scanNode(sourceFile, {
      functionDepth: 0,
      path,
      sourceFile,
      violations,
    })
    const lineCount = sourceText.split(/\r?\n/u).length
    if (lineCount > MAX_LIBRARY_FILE_LINES) {
      violations.push(
        `${path}:1 exceeds ${MAX_LIBRARY_FILE_LINES} lines (${lineCount})`,
      )
    }
    if (
      path === "lib/index.ts" &&
      sourceFile.statements.some(
        (statement) => !ts.isExportDeclaration(statement),
      )
    ) {
      violations.push("lib/index.ts:1 contains implementation code")
    }
  }

  expect(violations).toEqual([])
})
