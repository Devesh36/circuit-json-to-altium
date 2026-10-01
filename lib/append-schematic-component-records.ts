import { ALTIUM_SCHEMATIC_HAIRLINE_WIDTH } from "./altium-schematic-line-width"
import { appendSchematicComponentFieldRecords } from "./append-schematic-component-field-records"
import { appendSchematicComponentPinRecords } from "./append-schematic-component-pin-records"
import { createAltiumSchematicSymbolPrimitiveRecordFields } from "./create-altium-schematic-symbol-primitive-record-fields"
import {
  type AltiumSchematicSymbolRecords,
  createAltiumSchematicSymbolRecords,
} from "./create-altium-schematic-symbol-records"
import { createAltiumSchematicTextRecordFields } from "./create-altium-schematic-text-record-fields"
import { findSchematicComponentText } from "./find-schematic-component-text"
import {
  asPoint,
  asPositiveNumber,
  asString,
  byType,
  isCircuitElement,
  sanitizeField,
} from "./format"
import {
  createSchematicSymbolPrimitiveMaps,
  getSchematicSymbolPrimitives,
  type SchematicSymbolPrimitiveMaps,
} from "./get-schematic-symbol-primitives"
import { isSchematicSymbolPrimitive } from "./is-schematic-symbol-primitive"
import {
  type AltiumSchematicBoxBounds,
  getFallbackSchematicBoxBounds,
} from "./schematic-box-geometry"
import { addSchematicRecord } from "./schematic-document-records"
import type { SchematicDocumentContext } from "./schematic-document-types"
import type {
  CircuitElement,
  SchematicComponentId,
  SchematicSymbolId,
  SourceComponentId,
} from "./types"

const ALTIUM_SCHEMATIC_FALLBACK_BODY_COLOR = 0xc2_ffff

type SchematicComponentLookups = {
  portsByComponentId: Map<SchematicComponentId, CircuitElement[]>
  primitiveMaps: SchematicSymbolPrimitiveMaps
  sourceComponents: Map<SourceComponentId, CircuitElement>
  symbols: Map<SchematicSymbolId, CircuitElement>
  textsByComponentId: Map<SchematicComponentId, CircuitElement[]>
}

type SchematicComponentRenderState = {
  altiumComponentRecordIndex: number
  componentGraphicTexts: CircuitElement[]
  hasCustomSymbolPrimitives: boolean
  hasExplicitComponentTextPresentation: boolean
  schematicComponentId: SchematicComponentId
  schematicSymbolRecords: AltiumSchematicSymbolRecords | undefined
}

function appendElementByComponentId({
  element,
  map,
}: {
  element: CircuitElement
  map: Map<SchematicComponentId, CircuitElement[]>
}): void {
  const schematicComponentId = asString(element.schematic_component_id)
  if (!schematicComponentId) return
  map.set(schematicComponentId, [
    ...(map.get(schematicComponentId) ?? []),
    element,
  ])
}

function createSchematicComponentLookups(
  context: SchematicDocumentContext,
): SchematicComponentLookups {
  const portsByComponentId = new Map<SchematicComponentId, CircuitElement[]>()
  const textsByComponentId = new Map<SchematicComponentId, CircuitElement[]>()
  for (const schematicPort of context.schematicElements.filter(
    (element) => element.type === "schematic_port",
  )) {
    appendElementByComponentId({
      element: schematicPort,
      map: portsByComponentId,
    })
  }
  for (const schematicText of context.schematicElements.filter(
    (element) =>
      element.type === "schematic_text" && !isSchematicSymbolPrimitive(element),
  )) {
    appendElementByComponentId({
      element: schematicText,
      map: textsByComponentId,
    })
  }
  return {
    portsByComponentId,
    primitiveMaps: createSchematicSymbolPrimitiveMaps(
      context.schematicElements,
    ),
    sourceComponents: new Map<SourceComponentId, CircuitElement>(
      byType(context.circuitJson, "source_component")
        .filter((element) => typeof element.source_component_id === "string")
        .map((element) => [asString(element.source_component_id), element]),
    ),
    symbols: new Map<SchematicSymbolId, CircuitElement>(
      byType(context.circuitJson, "schematic_symbol").map((schematicSymbol) => [
        asString(schematicSymbol.schematic_symbol_id),
        schematicSymbol,
      ]),
    ),
    textsByComponentId,
  }
}

function appendComponentSymbolGraphics(
  {
    altiumComponentRecordIndex,
    circuitComponentCenter,
    fallbackBounds,
    primitiveMaps,
    schematicComponent,
  }: {
    altiumComponentRecordIndex: number
    circuitComponentCenter: { x: number; y: number }
    fallbackBounds: AltiumSchematicBoxBounds
    primitiveMaps: SchematicSymbolPrimitiveMaps
    schematicComponent: CircuitElement
  },
  context: SchematicDocumentContext,
): {
  hasCustomSymbolPrimitives: boolean
  schematicSymbolRecords: AltiumSchematicSymbolRecords | undefined
} {
  const customSymbolPrimitiveRecordFields = getSchematicSymbolPrimitives({
    maps: primitiveMaps,
    schematicComponent,
  }).flatMap((graphic) => {
    const recordFields = createAltiumSchematicSymbolPrimitiveRecordFields({
      altiumComponentRecordIndex,
      circuitToAltiumSchematicLength: context.circuitToAltiumSchematicLength,
      circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
      fontTable: context.nativeTextFontTable,
      graphic,
    })
    return recordFields ? [recordFields] : []
  })
  const hasCustomSymbolPrimitives = customSymbolPrimitiveRecordFields.length > 0
  const schematicSymbolRecords = !hasCustomSymbolPrimitives
    ? createAltiumSchematicSymbolRecords({
        altiumComponentRecordIndex,
        circuitComponentCenter,
        circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
        circuitToAltiumSchematicPrecisePoint:
          context.circuitToAltiumSchematicPrecisePoint,
        symbolName: asString(schematicComponent.symbol_name),
      })
    : undefined
  if (hasCustomSymbolPrimitives) {
    for (const recordFields of customSymbolPrimitiveRecordFields) {
      addSchematicRecord(recordFields, context.recordContext)
    }
  } else if (schematicSymbolRecords) {
    for (const recordFields of schematicSymbolRecords.graphicRecordFields) {
      addSchematicRecord(recordFields, context.recordContext)
    }
  } else {
    addSchematicRecord(
      [
        "RECORD=14",
        `OWNERINDEX=${altiumComponentRecordIndex}`,
        "OWNERPARTID=1",
        `LOCATION.X=${fallbackBounds.left}`,
        `LOCATION.Y=${fallbackBounds.bottom}`,
        `CORNER.X=${fallbackBounds.right}`,
        `CORNER.Y=${fallbackBounds.top}`,
        `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
        "COLOR=136",
        `AREACOLOR=${ALTIUM_SCHEMATIC_FALLBACK_BODY_COLOR}`,
        "ISSOLID=T",
      ],
      context.recordContext,
    )
  }
  return { hasCustomSymbolPrimitives, schematicSymbolRecords }
}

function appendSchematicComponent(
  {
    componentNumber,
    lookups,
    schematicComponent,
  }: {
    componentNumber: number
    lookups: SchematicComponentLookups
    schematicComponent: CircuitElement
  },
  context: SchematicDocumentContext,
): void {
  const circuitComponentCenter = asPoint(schematicComponent.center) ?? {
    x: 0,
    y: 0,
  }
  const sourceComponent = lookups.sourceComponents.get(
    asString(schematicComponent.source_component_id),
  )
  const designator =
    sanitizeField(sourceComponent?.name) || `U${componentNumber + 1}`
  const componentComment = sanitizeField(
    schematicComponent.symbol_display_value,
  )
  const schematicComponentId = asString(
    schematicComponent.schematic_component_id,
  )
  const componentTexts =
    lookups.textsByComponentId.get(schematicComponentId) ?? []
  const designatorText = findSchematicComponentText({
    componentTexts,
    excludedText: undefined,
    renderedText: designator,
  })
  const commentText = findSchematicComponentText({
    componentTexts,
    excludedText: designatorText,
    renderedText: componentComment,
  })
  const componentGraphicTexts = componentTexts.filter(
    (componentText) =>
      componentText !== designatorText && componentText !== commentText,
  )
  const schematicSymbol = lookups.symbols.get(
    asString(schematicComponent.schematic_symbol_id),
  )
  const libraryReference =
    sanitizeField(schematicSymbol?.name) ||
    sanitizeField(schematicComponent.symbol_name) ||
    designator
  const altiumComponentCenter = context.circuitToAltiumSchematicPoint(
    circuitComponentCenter,
  )
  const altiumComponentRecordIndex = addSchematicRecord(
    [
      "RECORD=1",
      `LOCATION.X=${altiumComponentCenter.x}`,
      `LOCATION.Y=${altiumComponentCenter.y}`,
      "ORIENTATION=0",
      `LIBREFERENCE=${libraryReference}`,
      "SHOWHIDDENPINS=F",
      "CURRENTPARTID=1",
      "ISMIRRORED=F",
      `UNIQUEID=${sanitizeField(schematicComponent.schematic_component_id)}`,
    ],
    context.recordContext,
  )
  const componentSize = isCircuitElement(schematicComponent.size)
    ? schematicComponent.size
    : {}
  const fallbackBounds = getFallbackSchematicBoxBounds({
    circuitComponentCenter,
    circuitComponentHeight: asPositiveNumber(componentSize.height, 1.5),
    circuitComponentWidth: asPositiveNumber(componentSize.width, 2),
    circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
  })
  const { hasCustomSymbolPrimitives, schematicSymbolRecords } =
    appendComponentSymbolGraphics(
      {
        altiumComponentRecordIndex,
        circuitComponentCenter,
        fallbackBounds,
        primitiveMaps: lookups.primitiveMaps,
        schematicComponent,
      },
      context,
    )
  const hasExplicitComponentTextPresentation = componentTexts.length > 0
  appendSchematicComponentFieldRecords(
    {
      altiumComponentRecordIndex,
      commentText,
      componentComment,
      designator,
      designatorText,
      fallbackBounds,
      shouldHideInferredDesignator:
        !designatorText &&
        (hasExplicitComponentTextPresentation || hasCustomSymbolPrimitives),
      symbolRecords: schematicSymbolRecords,
    },
    context,
  )
  const renderState: SchematicComponentRenderState = {
    altiumComponentRecordIndex,
    componentGraphicTexts,
    hasCustomSymbolPrimitives,
    hasExplicitComponentTextPresentation,
    schematicComponentId,
    schematicSymbolRecords,
  }
  const schematicPorts =
    lookups.portsByComponentId.get(renderState.schematicComponentId) ?? []
  for (const [pinIndex, schematicPort] of schematicPorts.entries()) {
    appendSchematicComponentPinRecords(
      {
        altiumComponentRecordIndex: renderState.altiumComponentRecordIndex,
        componentGraphicTexts: renderState.componentGraphicTexts,
        hasCustomSymbolPrimitives: renderState.hasCustomSymbolPrimitives,
        hasExplicitComponentTextPresentation:
          renderState.hasExplicitComponentTextPresentation,
        pinIndex,
        schematicPort,
        schematicSymbolRecords: renderState.schematicSymbolRecords,
      },
      context,
    )
  }
  for (const componentGraphicText of renderState.componentGraphicTexts) {
    const recordFields = createAltiumSchematicTextRecordFields({
      altiumComponentRecordIndex: renderState.altiumComponentRecordIndex,
      circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
      fontTable: context.nativeTextFontTable,
      schematicText: componentGraphicText,
    })
    if (recordFields) addSchematicRecord(recordFields, context.recordContext)
  }
}

export function appendSchematicComponentRecords(
  context: SchematicDocumentContext,
): void {
  const lookups = createSchematicComponentLookups(context)
  const schematicComponents = context.schematicElements.filter(
    (element) =>
      element.type === "schematic_component" &&
      !context.explicitlyPositionedSheetSymbolComponents.has(element),
  )
  for (const [
    componentNumber,
    schematicComponent,
  ] of schematicComponents.entries()) {
    appendSchematicComponent(
      { componentNumber, lookups, schematicComponent },
      context,
    )
  }
}
