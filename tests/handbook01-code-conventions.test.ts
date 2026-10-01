import { expect, test } from "bun:test"
import ts from "typescript"

type CodeConventionScanContext = {
  functionDepth: number
  path: string
  sourceFile: ts.SourceFile
  violations: string[]
}

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

function scanNode(node: ts.Node, context: CodeConventionScanContext): void {
  if (isFunctionLike(node) && node.parameters.length > 2) {
    context.violations.push(
      `${getNodeLocation(node, context)} uses more than two function parameters`,
    )
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
    const sourceFile = ts.createSourceFile(
      path,
      await Bun.file(path).text(),
      ts.ScriptTarget.Latest,
      true,
    )
    scanNode(sourceFile, {
      functionDepth: 0,
      path,
      sourceFile,
      violations,
    })
  }

  expect(violations).toEqual([])
})
