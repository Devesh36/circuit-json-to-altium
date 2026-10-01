import { getAltiumColorFromCss } from "./altium-color"
import {
  ALTIUM_SCHEMATIC_GRAPHIC_COLOR,
  ALTIUM_SCHEMATIC_SHEET_AREA_COLOR,
} from "./altium-schematic-colors"
import { ALTIUM_SCHEMATIC_HAIRLINE_WIDTH } from "./altium-schematic-line-width"
import { appendSchematicConnectionJunctions } from "./append-schematic-connection-junctions"
import { createAltiumSchematicCoordinateFields } from "./create-altium-schematic-coordinate-fields"
import {
  createAltiumSchematicFontTable,
  SCHEMATIC_PIN_NAME_FONT_SIZE_CIRCUIT_UNITS,
  SCHEMATIC_PIN_NUMBER_FONT_SIZE_CIRCUIT_UNITS,
} from "./create-altium-schematic-font-table"
import { createOwnedSchematicRecordFields } from "./create-altium-schematic-graphic-record-fields"
import {
  createAltiumSchematicNetLabelRecordFields,
  getAltiumPowerPortStyle,
} from "./create-altium-schematic-net-label-record-fields"
import { createAltiumSchematicNoConnectRecordFields } from "./create-altium-schematic-no-connect-record-fields"
import { createAltiumSchematicOffSheetPortRecordFields } from "./create-altium-schematic-off-sheet-port-record-fields"
import { createAltiumSchematicSheetAnnotationRecordFields } from "./create-altium-schematic-sheet-annotation-record-fields"
import {
  type AltiumSchematicChildSheet,
  createAltiumSchematicSheetEntryNoConnectRecordFields,
  createAltiumSchematicSheetSymbolOwnedRecordFields,
  createAltiumSchematicSheetSymbolPlans,
  createAltiumSchematicSheetSymbolRecordFields,
} from "./create-altium-schematic-sheet-symbol-records"
import { createAltiumSchematicSymbolPrimitiveRecordFields } from "./create-altium-schematic-symbol-primitive-record-fields"
import { createAltiumSchematicSymbolRecords } from "./create-altium-schematic-symbol-records"
import { createAltiumSchematicTextRecordFields } from "./create-altium-schematic-text-record-fields"
import { createSchematicPinMarkerRecords } from "./create-schematic-pin-marker-records"
import { createSchematicWireRecords } from "./create-schematic-wire-records"
import type { AltiumSchematicTemplate } from "./extract-altium-schematic-template"
import { findSchematicComponentText } from "./find-schematic-component-text"
import { findSchematicTextPresentation } from "./find-schematic-text-presentation"
import {
  asNumber,
  asPoint,
  asPositiveNumber,
  asString,
  byType,
  isCircuitElement,
  sanitizeField,
} from "./format"
import { getAltiumSchematicTextPresentation } from "./get-altium-schematic-text-presentation"
import { getSchematicTransform } from "./get-schematic-transform"
import { isSchematicSheetAnnotation } from "./is-schematic-sheet-annotation"
import { isSchematicSymbolPrimitive } from "./is-schematic-symbol-primitive"
import type {
  AltiumSchematicSheetSettings,
  CircuitElement,
  Point,
  PointTransform,
  SchematicComponentId,
  SchematicSheetId,
  SchematicSymbolId,
  SourceComponentId,
  SourcePortId,
} from "./types"

type CreateSchematicDocumentParams = {
  unitsPerCircuitUnit?: number
  childSheets?: AltiumSchematicChildSheet[]
  circuitJson: CircuitElement[]
  includeAllSchematicElements: boolean
  schematicSheetId: SchematicSheetId | undefined
  sheetSettings?: AltiumSchematicSheetSettings
  template?: AltiumSchematicTemplate
}

type SchematicSheetMembershipParams = {
  element: CircuitElement
  includeAllSchematicElements: boolean
  schematicSheetId: SchematicSheetId | undefined
}

type SchematicRecordContext = {
  lines: string[]
  nextRecordIndex: number
}

type AltiumSchematicPointKey = string

type AltiumSchematicBoxBounds = {
  bottom: number
  left: number
  right: number
  top: number
}

type BoxedSchematicPinLocationParams = {
  circuitPinTerminal: Point
  circuitToAltiumSchematicPoint: PointTransform
  distanceFromComponentEdge: number
  facingDirection: string
}

type FallbackSchematicBoxBoundsParams = {
  circuitComponentCenter: Point
  circuitComponentHeight: number
  circuitComponentWidth: number
  circuitToAltiumSchematicPoint: PointTransform
}

type SchematicSymbolPrimitiveMaps = {
  byComponentId: Map<SchematicComponentId, CircuitElement[]>
  bySymbolId: Map<SchematicSymbolId, CircuitElement[]>
}

const ALTIUM_PIN_STANDARD_FLAGS = 0x20
const ALTIUM_PIN_NAME_VISIBLE_FLAG = 0x08
const ALTIUM_PIN_DESIGNATOR_VISIBLE_FLAG = 0x10
const ALTIUM_PIN_CUSTOM_FONT_FLAG = 0x10
const ALTIUM_PIN_CUSTOM_POSITION_FLAG = 0x01
// Altium junction SIZE is a TSize enum, not a radius in schematic units.
const ALTIUM_SMALLEST_JUNCTION_SIZE = 0
// Match Circuit JSON's pin-name inset from the body edge, independently of font size.
const SCHEMATIC_PIN_NAME_INSET_CIRCUIT_UNITS = 0.1
// Keep pin numbers near the body instead of Altium's default 9-unit margin.
const SCHEMATIC_PIN_NUMBER_MARGIN_CIRCUIT_UNITS = 0.15
const ALTIUM_SCHEMATIC_DEFAULT_COLOR = 0x37_29_1f
const ALTIUM_SCHEMATIC_FALLBACK_BODY_COLOR = 0xc2_ffff
const ALTIUM_PIN_ORIENTATION_BY_FACING_DIRECTION: Record<string, number> = {
  left: 2,
  right: 0,
  up: 1,
  down: 3,
}
const DEFAULT_PIN_OUTWARD_DIRECTION: Point = { x: -1, y: 0 }
const PIN_OUTWARD_DIRECTION_BY_FACING_DIRECTION: Record<string, Point> = {
  left: DEFAULT_PIN_OUTWARD_DIRECTION,
  right: { x: 1, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
}

function appendElementToIdMap<OwnerId extends string>({
  element,
  id,
  map,
}: {
  element: CircuitElement
  id: OwnerId
  map: Map<OwnerId, CircuitElement[]>
}): void {
  if (!id) return
  map.set(id, [...(map.get(id) ?? []), element])
}

function createSchematicSymbolPrimitiveMaps(
  schematicElements: CircuitElement[],
): SchematicSymbolPrimitiveMaps {
  const maps: SchematicSymbolPrimitiveMaps = {
    byComponentId: new Map<SchematicComponentId, CircuitElement[]>(),
    bySymbolId: new Map<SchematicSymbolId, CircuitElement[]>(),
  }
  for (const primitive of schematicElements.filter(
    isSchematicSymbolPrimitive,
  )) {
    appendElementToIdMap({
      element: primitive,
      id: asString(primitive.schematic_component_id),
      map: maps.byComponentId,
    })
    appendElementToIdMap({
      element: primitive,
      id: asString(primitive.schematic_symbol_id),
      map: maps.bySymbolId,
    })
  }
  return maps
}

function getSchematicSymbolPrimitives({
  maps,
  schematicComponent,
}: {
  maps: SchematicSymbolPrimitiveMaps
  schematicComponent: CircuitElement
}): CircuitElement[] {
  const schematicComponentId = asString(
    schematicComponent.schematic_component_id,
  )
  const declaredSchematicSymbolId = asString(
    schematicComponent.schematic_symbol_id,
  )
  const allComponentPrimitives =
    maps.byComponentId.get(schematicComponentId) ?? []
  const componentPrimitives = allComponentPrimitives.filter((primitive) => {
    const primitiveSymbolId = asString(primitive.schematic_symbol_id)
    return (
      !declaredSchematicSymbolId ||
      !primitiveSymbolId ||
      primitiveSymbolId === declaredSchematicSymbolId
    )
  })
  const associatedSchematicSymbolIds = new Set(
    declaredSchematicSymbolId
      ? [declaredSchematicSymbolId]
      : allComponentPrimitives
          .map((primitive) => asString(primitive.schematic_symbol_id))
          .filter(Boolean),
  )
  const symbolPrimitives = [...associatedSchematicSymbolIds].flatMap(
    (schematicSymbolId) => maps.bySymbolId.get(schematicSymbolId) ?? [],
  )
  return [...new Set([...componentPrimitives, ...symbolPrimitives])]
}

function getFallbackSchematicBoxBounds({
  circuitComponentCenter,
  circuitComponentHeight,
  circuitComponentWidth,
  circuitToAltiumSchematicPoint,
}: FallbackSchematicBoxBoundsParams): AltiumSchematicBoxBounds {
  const firstCorner = circuitToAltiumSchematicPoint({
    x: circuitComponentCenter.x - circuitComponentWidth / 2,
    y: circuitComponentCenter.y - circuitComponentHeight / 2,
  })
  const oppositeCorner = circuitToAltiumSchematicPoint({
    x: circuitComponentCenter.x + circuitComponentWidth / 2,
    y: circuitComponentCenter.y + circuitComponentHeight / 2,
  })
  return {
    bottom: Math.min(firstCorner.y, oppositeCorner.y),
    left: Math.min(firstCorner.x, oppositeCorner.x),
    right: Math.max(firstCorner.x, oppositeCorner.x),
    top: Math.max(firstCorner.y, oppositeCorner.y),
  }
}

function getBoxedSchematicPinLocation({
  circuitPinTerminal,
  circuitToAltiumSchematicPoint,
  distanceFromComponentEdge,
  facingDirection,
}: BoxedSchematicPinLocationParams): Point {
  const outwardDirection =
    PIN_OUTWARD_DIRECTION_BY_FACING_DIRECTION[facingDirection] ??
    DEFAULT_PIN_OUTWARD_DIRECTION
  return circuitToAltiumSchematicPoint({
    x: circuitPinTerminal.x - outwardDirection.x * distanceFromComponentEdge,
    y: circuitPinTerminal.y - outwardDirection.y * distanceFromComponentEdge,
  })
}

function doesElementBelongToSchematicSheet({
  element,
  includeAllSchematicElements,
  schematicSheetId,
}: SchematicSheetMembershipParams): boolean {
  const elementSchematicSheetId = asString(element.schematic_sheet_id)
  return schematicSheetId
    ? elementSchematicSheetId === schematicSheetId ||
        (includeAllSchematicElements && !elementSchematicSheetId)
    : !elementSchematicSheetId || includeAllSchematicElements
}

function isFilledSchematicSheetBackground({
  element,
  schematicComponents,
}: {
  element: CircuitElement
  schematicComponents: CircuitElement[]
}): boolean {
  if (
    element.type !== "schematic_rect" ||
    element.is_filled !== true ||
    !isSchematicSheetAnnotation(element)
  ) {
    return false
  }
  const center = asPoint(element.center)
  const halfWidth = asNumber(element.width) / 2
  const halfHeight = asNumber(element.height) / 2
  if (!center || halfWidth <= 0 || halfHeight <= 0) return false

  return schematicComponents.some((component) => {
    const componentCenter = asPoint(component.center)
    const componentSize = isCircuitElement(component.size)
      ? component.size
      : undefined
    const componentHalfWidth = asNumber(componentSize?.width) / 2
    const componentHalfHeight = asNumber(componentSize?.height) / 2
    return (
      componentCenter !== undefined &&
      componentHalfWidth > 0 &&
      componentHalfHeight > 0 &&
      Math.abs(componentCenter.x - center.x) + componentHalfWidth <=
        halfWidth &&
      Math.abs(componentCenter.y - center.y) + componentHalfHeight <= halfHeight
    )
  })
}

function addSchematicRecord(
  recordFields: string[],
  ctx: SchematicRecordContext,
): number {
  const altiumRecordIndex = ctx.nextRecordIndex
  recordFields = recordFields.flatMap((field) => {
    const match =
      /^((?:LOCATION|CORNER)\.[XY]|[XY]\d+|RADIUS|SECONDARYRADIUS|PINLENGTH|WIDTH|HEIGHT|XSIZE|YSIZE|DISTANCEFROMTOP)=([+-]?[\d.]+)$/iu.exec(
        field,
      )
    if (!match || Number.isInteger(Number(match[2]))) return [field]
    if (match[1] === "DISTANCEFROMTOP") {
      // Sheet entries use 10-unit bases and _FRAC1 in 1/100,000 units.
      const ticks = Math.round(Number(match[2]) * 1_000_000)
      const base = Math.trunc(ticks / 1_000_000)
      const fraction = ticks - base * 1_000_000
      return [`DISTANCEFROMTOP=${base}`, `DISTANCEFROMTOP_FRAC1=${fraction}`]
    }
    return createAltiumSchematicCoordinateFields(match[1]!, Number(match[2]))
  })
  ctx.lines.push(`|${recordFields.join("|")}`)
  ctx.nextRecordIndex++
  return altiumRecordIndex
}

function remapTemplateFontId({
  fontIdBySourceFontId,
  recordFields,
}: {
  fontIdBySourceFontId: Map<number, number>
  recordFields: string[]
}): string[] {
  return recordFields.map((field) => {
    const match = /^FONTID=(\d+)$/iu.exec(field)
    const sourceFontId = Number(match?.[1])
    const fontId = fontIdBySourceFontId.get(sourceFontId)
    return fontId === undefined ? field : `FONTID=${fontId}`
  })
}

export function createSchematicDocument({
  unitsPerCircuitUnit = 20,
  childSheets = [],
  circuitJson,
  includeAllSchematicElements,
  schematicSheetId,
  sheetSettings,
  template,
}: CreateSchematicDocumentParams): string {
  const scaleRatio = unitsPerCircuitUnit / 20
  const sourcePorts = new Map<SourcePortId, CircuitElement>(
    byType(circuitJson, "source_port").map((sourcePort) => [
      asString(sourcePort.source_port_id),
      sourcePort,
    ]),
  )
  const schematicElements = circuitJson.filter(
    (element) =>
      element.type?.startsWith("schematic_") === true &&
      element.type !== "schematic_sheet" &&
      !(
        element.type === "schematic_port" &&
        !asString(element.schematic_component_id) &&
        element.is_connected === false &&
        sourcePorts.get(asString(element.source_port_id))?.do_not_connect !==
          true
      ) &&
      doesElementBelongToSchematicSheet({
        element,
        includeAllSchematicElements,
        schematicSheetId,
      }),
  )
  const {
    circuitToAltiumSchematicLength,
    circuitToAltiumSchematicPoint,
    circuitToAltiumSchematicPrecisePoint,
    width: contentWidth,
    height: contentHeight,
  } = getSchematicTransform(
    schematicElements,
    sheetSettings,
    unitsPerCircuitUnit,
  )
  const sheetSymbolPlans = createAltiumSchematicSheetSymbolPlans({
    scale: scaleRatio,
    childSheets,
    circuitJson,
  })
  const hasRenderableSchematicContent = schematicElements.some(
    (element) =>
      element.type !== "schematic_graphic" &&
      element.type !== "schematic_group" &&
      element.type !== "schematic_symbol",
  )
  const explicitlyPositionedSheetSymbolComponents = new Set(
    sheetSymbolPlans.flatMap((plan) =>
      plan.placementComponent ? [plan.placementComponent] : [],
    ),
  )
  const automaticallyPlacedSheetSymbolPlans = sheetSymbolPlans.filter(
    (plan) => !plan.placementComponent,
  )
  const sheetSymbolColumnCount = Math.max(
    Math.ceil(Math.sqrt(automaticallyPlacedSheetSymbolPlans.length)),
    1,
  )
  const sheetSymbolRowCount = Math.ceil(
    automaticallyPlacedSheetSymbolPlans.length / sheetSymbolColumnCount,
  )
  const sheetSymbolColumnWidth = Math.max(
    ...automaticallyPlacedSheetSymbolPlans.map((plan) => plan.width),
    0,
  )
  const sheetSymbolRowHeight = Math.max(
    ...automaticallyPlacedSheetSymbolPlans.map((plan) => plan.height),
    0,
  )
  const sheetSymbolStartX = hasRenderableSchematicContent
    ? contentWidth + 40 * scaleRatio
    : 60 * scaleRatio
  const sheetSymbolLayoutWidth =
    sheetSymbolColumnCount * sheetSymbolColumnWidth +
    Math.max(sheetSymbolColumnCount - 1, 0) * 40 * scaleRatio
  const sheetSymbolLayoutHeight =
    sheetSymbolRowCount * sheetSymbolRowHeight +
    Math.max(sheetSymbolRowCount - 1, 0) * 40 * scaleRatio
  const altiumSheetWidth = Math.max(
    contentWidth,
    automaticallyPlacedSheetSymbolPlans.length > 0
      ? sheetSymbolStartX + sheetSymbolLayoutWidth + 60 * scaleRatio
      : 0,
  )
  const altiumSheetHeight = Math.max(
    contentHeight,
    automaticallyPlacedSheetSymbolPlans.length > 0
      ? sheetSymbolLayoutHeight + 120 * scaleRatio
      : 0,
  )
  const sheetTexts = schematicElements.filter(
    (element) =>
      element.type === "schematic_text" && isSchematicSheetAnnotation(element),
  )
  const consumedSheetTexts = new Set<CircuitElement>()
  const netLabelPlans = []
  for (const [netLabelIndex, schematicNetLabel] of schematicElements
    .filter((element) => element.type === "schematic_net_label")
    .entries()) {
    const labelText = sanitizeField(schematicNetLabel.text)
    if (!labelText) continue
    const circuitLabelPosition = asPoint(schematicNetLabel.anchor_position) ??
      asPoint(schematicNetLabel.center) ?? { x: 0, y: 0 }
    const textPresentation = findSchematicTextPresentation({
      excludedTexts: consumedSheetTexts,
      renderedText: labelText,
      schematicTexts: sheetTexts,
      targetPosition: circuitLabelPosition,
    })
    if (textPresentation) consumedSheetTexts.add(textPresentation)
    netLabelPlans.push({
      circuitLabelPosition,
      labelText,
      netLabelIndex,
      schematicNetLabel,
      textPresentation,
    })
  }
  const altiumSchematicFontTable = createAltiumSchematicFontTable({
    unitsPerCircuitUnit,
    netLabelTextPresentations: netLabelPlans.flatMap(
      ({ schematicNetLabel, textPresentation }) =>
        textPresentation &&
        !getAltiumPowerPortStyle(asString(schematicNetLabel.symbol_name))
          ? [textPresentation]
          : [],
    ),
    schematicElements,
    templateFontFields: template?.fontFields,
  })
  const nativeTextFontTable = {
    ...altiumSchematicFontTable,
    fontIdBySizeCircuitUnits:
      altiumSchematicFontTable.nativeTextFontIdBySizeCircuitUnits,
  }
  const schematicRecordContext: SchematicRecordContext = {
    lines: [
      "|HEADER=Protel for Windows - Schematic Capture Ascii File Version 5.0",
    ],
    nextRecordIndex: 0,
  }
  addSchematicRecord(
    [
      "RECORD=31",
      ...altiumSchematicFontTable.sheetRecordFields,
      `AREACOLOR=${ALTIUM_SCHEMATIC_SHEET_AREA_COLOR}`,
      `CUSTOMX=${unitsPerCircuitUnit === 20 ? altiumSheetWidth : Math.ceil(altiumSheetWidth)}`,
      `CUSTOMY=${unitsPerCircuitUnit === 20 ? altiumSheetHeight : Math.ceil(altiumSheetHeight)}`,
      "USECUSTOMSHEET=T",
      "SNAPGRIDON=T",
      `SNAPGRIDSIZE=${Math.max(1, Math.round(10 * scaleRatio))}`,
      ...(template?.sheetRecordFields ?? []),
    ],
    schematicRecordContext,
  )

  for (const recordFields of template?.recordFields ?? []) {
    addSchematicRecord(
      remapTemplateFontId({
        fontIdBySourceFontId:
          altiumSchematicFontTable.templateFontIdBySourceFontId,
        recordFields,
      }),
      schematicRecordContext,
    )
  }

  const schematicComponents = schematicElements.filter(
    (element) => element.type === "schematic_component",
  )
  const filledSheetBackgrounds = new Set(
    schematicElements.filter((element) =>
      isFilledSchematicSheetBackground({ element, schematicComponents }),
    ),
  )
  for (const background of filledSheetBackgrounds) {
    const backgroundRecordFields =
      createAltiumSchematicSheetAnnotationRecordFields({
        annotation: background,
        circuitToAltiumSchematicPoint,
        fontTable: altiumSchematicFontTable,
      })
    if (backgroundRecordFields) {
      addSchematicRecord(backgroundRecordFields, schematicRecordContext)
    }
  }

  let automaticallyPlacedPlanIndex = 0
  for (const plan of sheetSymbolPlans) {
    let placedPlan = plan
    let location: Point
    if (plan.placementComponent) {
      const circuitCenter = asPoint(plan.placementComponent.center) ?? {
        x: 0,
        y: 0,
      }
      const circuitSize = isCircuitElement(plan.placementComponent.size)
        ? plan.placementComponent.size
        : {}
      const width = circuitToAltiumSchematicLength(
        asPositiveNumber(circuitSize.width, plan.width / unitsPerCircuitUnit),
      )
      const height = circuitToAltiumSchematicLength(
        asPositiveNumber(circuitSize.height, plan.height / unitsPerCircuitUnit),
      )
      const altiumCenter = circuitToAltiumSchematicPoint(circuitCenter)
      location = {
        x: altiumCenter.x - width / 2,
        y: altiumCenter.y + height / 2,
      }
      placedPlan = { ...plan, height, width }
      if (unitsPerCircuitUnit !== 20) {
        const bounds = getFallbackSchematicBoxBounds({
          circuitComponentCenter: circuitCenter,
          circuitComponentHeight: height / unitsPerCircuitUnit,
          circuitComponentWidth: width / unitsPerCircuitUnit,
          circuitToAltiumSchematicPoint,
        })
        location = { x: bounds.left, y: bounds.top }
        placedPlan = {
          ...plan,
          width: bounds.right - bounds.left,
          height: bounds.top - bounds.bottom,
          entries: plan.entries.map((entry) => ({
            ...entry,
            distanceFromTop: entry.circuitPosition
              ? Math.max(
                  0,
                  (location.y -
                    circuitToAltiumSchematicPoint(entry.circuitPosition).y) /
                    10,
                )
              : entry.distanceFromTop,
          })),
        }
      }
    } else {
      const columnIndex = automaticallyPlacedPlanIndex % sheetSymbolColumnCount
      const rowIndex = Math.floor(
        automaticallyPlacedPlanIndex / sheetSymbolColumnCount,
      )
      location = {
        x:
          sheetSymbolStartX +
          columnIndex * (sheetSymbolColumnWidth + 40 * scaleRatio),
        y:
          altiumSheetHeight -
          60 * scaleRatio -
          rowIndex * (sheetSymbolRowHeight + 40 * scaleRatio),
      }
      automaticallyPlacedPlanIndex++
    }
    const altiumSymbolRecordIndex = addSchematicRecord(
      createAltiumSchematicSheetSymbolRecordFields({
        location,
        plan: placedPlan,
      }),
      schematicRecordContext,
    )
    for (const recordFields of createAltiumSchematicSheetSymbolOwnedRecordFields(
      {
        altiumSymbolRecordIndex,
        location,
        plan: placedPlan,
        scale: scaleRatio,
      },
    )) {
      addSchematicRecord(recordFields, schematicRecordContext)
    }
    for (const recordFields of createAltiumSchematicSheetEntryNoConnectRecordFields(
      {
        location,
        plan: placedPlan,
      },
    )) {
      addSchematicRecord(recordFields, schematicRecordContext)
    }
  }

  const sourceComponents = new Map<SourceComponentId, CircuitElement>(
    byType(circuitJson, "source_component")
      .filter((element) => typeof element.source_component_id === "string")
      .map((element) => [asString(element.source_component_id), element]),
  )
  const schematicSymbols = new Map<SchematicSymbolId, CircuitElement>(
    byType(circuitJson, "schematic_symbol").map((schematicSymbol) => [
      asString(schematicSymbol.schematic_symbol_id),
      schematicSymbol,
    ]),
  )
  const schematicPortsByComponentId = new Map<
    SchematicComponentId,
    CircuitElement[]
  >()
  const schematicTextsByComponentId = new Map<
    SchematicComponentId,
    CircuitElement[]
  >()
  const schematicSymbolPrimitiveMaps =
    createSchematicSymbolPrimitiveMaps(schematicElements)
  for (const schematicPort of schematicElements.filter(
    (element) => element.type === "schematic_port",
  )) {
    const schematicComponentId = asString(schematicPort.schematic_component_id)
    if (!schematicComponentId) continue
    schematicPortsByComponentId.set(schematicComponentId, [
      ...(schematicPortsByComponentId.get(schematicComponentId) ?? []),
      schematicPort,
    ])
  }
  for (const schematicText of schematicElements.filter(
    (element) =>
      element.type === "schematic_text" && !isSchematicSymbolPrimitive(element),
  )) {
    appendElementToIdMap({
      element: schematicText,
      id: asString(schematicText.schematic_component_id),
      map: schematicTextsByComponentId,
    })
  }

  for (const [componentNumber, schematicComponent] of schematicElements
    .filter(
      (element) =>
        element.type === "schematic_component" &&
        !explicitlyPositionedSheetSymbolComponents.has(element),
    )
    .entries()) {
    const circuitComponentCenter = asPoint(schematicComponent.center) ?? {
      x: 0,
      y: 0,
    }
    const altiumComponentCenter = circuitToAltiumSchematicPoint(
      circuitComponentCenter,
    )
    const sourceComponent = sourceComponents.get(
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
      schematicTextsByComponentId.get(schematicComponentId) ?? []
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
    const hasExplicitComponentTextPresentation = componentTexts.length > 0
    const schematicSymbol = schematicSymbols.get(
      asString(schematicComponent.schematic_symbol_id),
    )
    const libraryReference =
      sanitizeField(schematicSymbol?.name) ||
      sanitizeField(schematicComponent.symbol_name) ||
      designator
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
      schematicRecordContext,
    )
    const componentSize = isCircuitElement(schematicComponent.size)
      ? schematicComponent.size
      : {}
    const circuitComponentWidth = asPositiveNumber(componentSize.width, 2)
    const circuitComponentHeight = asPositiveNumber(componentSize.height, 1.5)
    const fallbackSchematicBoxBounds = getFallbackSchematicBoxBounds({
      circuitComponentCenter,
      circuitComponentHeight,
      circuitComponentWidth,
      circuitToAltiumSchematicPoint,
    })
    const customSymbolPrimitiveRecordFields = getSchematicSymbolPrimitives({
      maps: schematicSymbolPrimitiveMaps,
      schematicComponent,
    }).flatMap((graphic) => {
      const recordFields = createAltiumSchematicSymbolPrimitiveRecordFields({
        altiumComponentRecordIndex,
        circuitToAltiumSchematicLength,
        circuitToAltiumSchematicPoint,
        fontTable: nativeTextFontTable,
        graphic,
      })
      return recordFields ? [recordFields] : []
    })
    const hasCustomSymbolPrimitives =
      customSymbolPrimitiveRecordFields.length > 0
    const shouldHideInferredDesignator =
      !designatorText &&
      (hasExplicitComponentTextPresentation || hasCustomSymbolPrimitives)
    const schematicSymbolRecords = !hasCustomSymbolPrimitives
      ? createAltiumSchematicSymbolRecords({
          altiumComponentRecordIndex,
          circuitComponentCenter,
          circuitToAltiumSchematicPoint,
          circuitToAltiumSchematicPrecisePoint,
          symbolName: asString(schematicComponent.symbol_name),
        })
      : undefined
    if (hasCustomSymbolPrimitives) {
      for (const primitiveRecordFields of customSymbolPrimitiveRecordFields) {
        addSchematicRecord(primitiveRecordFields, schematicRecordContext)
      }
    } else if (schematicSymbolRecords) {
      for (const graphicRecordFields of schematicSymbolRecords.graphicRecordFields) {
        addSchematicRecord(graphicRecordFields, schematicRecordContext)
      }
    } else {
      addSchematicRecord(
        [
          "RECORD=14",
          `OWNERINDEX=${altiumComponentRecordIndex}`,
          "OWNERPARTID=1",
          `LOCATION.X=${fallbackSchematicBoxBounds.left}`,
          `LOCATION.Y=${fallbackSchematicBoxBounds.bottom}`,
          `CORNER.X=${fallbackSchematicBoxBounds.right}`,
          `CORNER.Y=${fallbackSchematicBoxBounds.top}`,
          `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
          "COLOR=136",
          `AREACOLOR=${ALTIUM_SCHEMATIC_FALLBACK_BODY_COLOR}`,
          "ISSOLID=T",
        ],
        schematicRecordContext,
      )
    }
    const designatorPlacement = schematicSymbolRecords?.designatorPlacement
    const commentPlacement = schematicSymbolRecords?.commentPlacement
    const designatorPresentation = getAltiumSchematicTextPresentation({
      circuitToAltiumSchematicPoint,
      fallbackAltiumColor: ALTIUM_SCHEMATIC_DEFAULT_COLOR,
      fallbackAltiumPosition: designatorPlacement?.position ?? {
        x: fallbackSchematicBoxBounds.left,
        y: fallbackSchematicBoxBounds.top + 12 * scaleRatio,
      },
      fallbackFontId: 1,
      fallbackJustification: designatorPlacement?.justification ?? 0,
      fontTable: nativeTextFontTable,
      schematicText: designatorText,
    })
    const commentPresentation = getAltiumSchematicTextPresentation({
      circuitToAltiumSchematicPoint,
      fallbackAltiumColor: ALTIUM_SCHEMATIC_DEFAULT_COLOR,
      fallbackAltiumPosition: commentPlacement?.position ?? {
        x: fallbackSchematicBoxBounds.left,
        y: fallbackSchematicBoxBounds.bottom - 12 * scaleRatio,
      },
      fallbackFontId: 2,
      fallbackJustification: commentPlacement?.justification ?? 0,
      fontTable: nativeTextFontTable,
      schematicText: commentText,
    })
    addSchematicRecord(
      [
        "RECORD=34",
        `OWNERINDEX=${altiumComponentRecordIndex}`,
        "OWNERPARTID=-1",
        `LOCATION.X=${designatorPresentation.position.x}`,
        `LOCATION.Y=${designatorPresentation.position.y}`,
        `FONTID=${designatorPresentation.fontId}`,
        "NAME=Designator",
        `TEXT=${designator}`,
        `COLOR=${designatorPresentation.color}`,
        "SHOWNAME=F",
        `ISHIDDEN=${shouldHideInferredDesignator ? "T" : "F"}`,
        `ORIENTATION=${designatorPresentation.orientation}`,
        `JUSTIFICATION=${designatorPresentation.justification}`,
      ],
      schematicRecordContext,
    )
    addSchematicRecord(
      [
        "RECORD=41",
        `OWNERINDEX=${altiumComponentRecordIndex}`,
        "OWNERPARTID=-1",
        `LOCATION.X=${commentPresentation.position.x}`,
        `LOCATION.Y=${commentPresentation.position.y}`,
        `FONTID=${commentPresentation.fontId}`,
        "NAME=Comment",
        `TEXT=${componentComment}`,
        `COLOR=${commentPresentation.color}`,
        "SHOWNAME=F",
        `ISHIDDEN=${componentComment ? "F" : "T"}`,
        `ORIENTATION=${commentPresentation.orientation}`,
        `JUSTIFICATION=${commentPresentation.justification}`,
      ],
      schematicRecordContext,
    )

    const schematicPorts =
      schematicPortsByComponentId.get(schematicComponentId) ?? []
    for (const [pinIndex, schematicPort] of schematicPorts.entries()) {
      const sourcePort = sourcePorts.get(asString(schematicPort.source_port_id))
      const circuitPinTerminal = asPoint(schematicPort.center) ?? { x: 0, y: 0 }
      const facingDirection = asString(schematicPort.facing_direction)
      const boxedSchematicPinLocation = getBoxedSchematicPinLocation({
        circuitPinTerminal,
        circuitToAltiumSchematicPoint,
        distanceFromComponentEdge: Math.max(
          asNumber(schematicPort.distance_from_component_edge),
          0,
        ),
        facingDirection,
      })
      const altiumPinOrientation =
        ALTIUM_PIN_ORIENTATION_BY_FACING_DIRECTION[facingDirection] ?? 2
      const isPinTextVisibleByDefault =
        !schematicSymbolRecords && !hasCustomSymbolPrimitives
      const pinName =
        sanitizeField(schematicPort.display_pin_label) ||
        sanitizeField(sourcePort?.name) ||
        `Pin ${pinIndex + 1}`
      const pinDesignator =
        sanitizeField(sourcePort?.pin_number) || `${pinIndex + 1}`
      const pinGeometryLabels = [
        asString(schematicPort.display_pin_label),
        asString(sourcePort?.name),
        ...(Array.isArray(sourcePort?.port_hints)
          ? sourcePort.port_hints.flatMap((portHint) =>
              typeof portHint === "string" ? [portHint] : [],
            )
          : []),
        pinDesignator,
      ]
      const altiumPinTerminal =
        circuitToAltiumSchematicPoint(circuitPinTerminal)
      const builtinPinGeometry =
        schematicSymbolRecords?.pinGeometryByTerminal.get(
          `${altiumPinTerminal.x}:${altiumPinTerminal.y}`,
        ) ??
        pinGeometryLabels
          .map((label) => schematicSymbolRecords?.pinGeometryByLabel.get(label))
          .find((pinGeometry) => pinGeometry !== undefined)
      const altiumPinLocation =
        builtinPinGeometry?.location ??
        (schematicSymbolRecords
          ? circuitToAltiumSchematicPoint(circuitPinTerminal)
          : boxedSchematicPinLocation)
      const pinNameText =
        typeof schematicPort.display_pin_label === "string"
          ? findSchematicComponentText({
              componentTexts: componentGraphicTexts,
              excludedText: undefined,
              renderedText: pinName,
            })
          : undefined
      const pinNumberText =
        typeof schematicPort.pin_number === "number"
          ? findSchematicComponentText({
              componentTexts: componentGraphicTexts,
              excludedText: pinNameText,
              renderedText: pinDesignator,
            })
          : undefined
      const hasVisibleCustomPinName =
        hasCustomSymbolPrimitives &&
        typeof schematicPort.display_pin_label === "string"
      const hasVisibleRegularPinName =
        !hasCustomSymbolPrimitives &&
        (hasExplicitComponentTextPresentation
          ? typeof schematicPort.display_pin_label === "string"
          : isPinTextVisibleByDefault)
      const isPinNameVisible =
        pinNameText === undefined &&
        (hasVisibleCustomPinName || hasVisibleRegularPinName)
      const isPinNumberVisible =
        pinNumberText === undefined &&
        !hasCustomSymbolPrimitives &&
        (hasExplicitComponentTextPresentation
          ? typeof schematicPort.pin_number === "number"
          : isPinTextVisibleByDefault)
      const altiumPinTextVisibilityFlags =
        (isPinNameVisible ? ALTIUM_PIN_NAME_VISIBLE_FLAG : 0) |
        (isPinNumberVisible ? ALTIUM_PIN_DESIGNATOR_VISIBLE_FLAG : 0)
      const altiumPinConglomerate =
        ALTIUM_PIN_STANDARD_FLAGS |
        altiumPinTextVisibilityFlags |
        altiumPinOrientation
      const explicitPinText = pinNameText ?? pinNumberText
      const pinColor = getAltiumColorFromCss({
        cssColor: asString(explicitPinText?.color),
        fallbackAltiumColor: ALTIUM_SCHEMATIC_GRAPHIC_COLOR,
      })
      const pinNameFontId = nativeTextFontTable.fontIdBySizeCircuitUnits.get(
        asPositiveNumber(
          schematicPort.display_pin_label_font_size,
          SCHEMATIC_PIN_NAME_FONT_SIZE_CIRCUIT_UNITS,
        ),
      )!
      const pinNumberFontId = nativeTextFontTable.fontIdBySizeCircuitUnits.get(
        SCHEMATIC_PIN_NUMBER_FONT_SIZE_CIRCUIT_UNITS,
      )!
      const hasInputArrow = schematicPort.has_input_arrow === true
      const hasOutputArrow = schematicPort.has_output_arrow === true
      const nameInset = circuitToAltiumSchematicLength(
        SCHEMATIC_PIN_NAME_INSET_CIRCUIT_UNITS,
      )
      const numberMargin = circuitToAltiumSchematicLength(
        SCHEMATIC_PIN_NUMBER_MARGIN_CIRCUIT_UNITS,
      )
      const pinMarkers = createSchematicPinMarkerRecords({
        body: altiumPinLocation,
        orientation: altiumPinOrientation,
        hasInversionCircle:
          schematicPort.is_drawn_with_inversion_circle === true,
        hasInputArrow,
        hasOutputArrow,
        ownerIndex: altiumComponentRecordIndex,
        color: pinColor,
        toAltiumLength: circuitToAltiumSchematicLength,
      })
      for (const record of pinMarkers.records) {
        addSchematicRecord(record, schematicRecordContext)
      }
      const outwardDirection =
        PIN_OUTWARD_DIRECTION_BY_FACING_DIRECTION[facingDirection] ??
        DEFAULT_PIN_OUTWARD_DIRECTION
      // A zero-length native pin belongs at the Circuit JSON terminal. Text
      // margins compensate for its distance from the original symbol body.
      const pinBodyOffset =
        (altiumPinTerminal.x - altiumPinLocation.x) * outwardDirection.x +
        (altiumPinTerminal.y - altiumPinLocation.y) * outwardDirection.y
      addSchematicRecord(
        [
          "RECORD=2",
          `OWNERINDEX=${altiumComponentRecordIndex}`,
          "OWNERPARTID=1",
          `DESIGNATOR=${pinDesignator}`,
          `NAME=${pinName}`,
          `PINCONGLOMERATE=${altiumPinConglomerate}`,
          ...createAltiumSchematicCoordinateFields(
            "LOCATION.X",
            altiumPinTerminal.x,
          ),
          ...createAltiumSchematicCoordinateFields(
            "LOCATION.Y",
            altiumPinTerminal.y,
          ),
          "PINLENGTH=0",
          // This preset controls native pin symbols, not the straight stem.
          `SYMBOL_LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
          // Direction arrows are exported as sized graphics. Inferring native
          // Input/Output types adds Altium's fixed-size automatic indicators.
          "ELECTRICAL=4",
          `COLOR=${pinColor}`,
          // Native pins require independently enabled name/designator fonts.
          // Custom settings also select text color, so retain the pin color.
          `PINNAME_POSITIONCONGLOMERATE=${ALTIUM_PIN_CUSTOM_FONT_FLAG | ALTIUM_PIN_CUSTOM_POSITION_FLAG}`,
          ...createAltiumSchematicCoordinateFields(
            "NAME_CUSTOMPOSITION_MARGIN",
            // Native names start 2 units inside the pin body; custom margins
            // add to that inset, unlike designator margins which point outward.
            nameInset - 2 + pinBodyOffset,
          ),
          `NAME_CUSTOMFONTID=${pinNameFontId}`,
          `NAME_CUSTOMCOLOR=${pinColor}`,
          `PINDESIGNATOR_POSITIONCONGLOMERATE=${ALTIUM_PIN_CUSTOM_FONT_FLAG | ALTIUM_PIN_CUSTOM_POSITION_FLAG}`,
          ...createAltiumSchematicCoordinateFields(
            "DESIGNATOR_CUSTOMPOSITION_MARGIN",
            numberMargin - pinBodyOffset,
          ),
          `DESIGNATOR_CUSTOMFONTID=${pinNumberFontId}`,
          `DESIGNATOR_CUSTOMCOLOR=${pinColor}`,
        ],
        schematicRecordContext,
      )
      if (
        pinMarkers.stemStart.x !== altiumPinTerminal.x ||
        pinMarkers.stemStart.y !== altiumPinTerminal.y
      ) {
        // The thin stem is component artwork; only the outer native terminal
        // connects to sheet wires. Stop at the filled markers' outer edge.
        addSchematicRecord(
          [
            "RECORD=13",
            ...createOwnedSchematicRecordFields(altiumComponentRecordIndex),
            ...createAltiumSchematicCoordinateFields(
              "LOCATION.X",
              pinMarkers.stemStart.x,
            ),
            ...createAltiumSchematicCoordinateFields(
              "LOCATION.Y",
              pinMarkers.stemStart.y,
            ),
            ...createAltiumSchematicCoordinateFields(
              "CORNER.X",
              altiumPinTerminal.x,
            ),
            ...createAltiumSchematicCoordinateFields(
              "CORNER.Y",
              altiumPinTerminal.y,
            ),
            `COLOR=${pinColor}`,
            `LINEWIDTH=${ALTIUM_SCHEMATIC_HAIRLINE_WIDTH}`,
          ],
          schematicRecordContext,
        )
      }
    }
    for (const componentGraphicText of componentGraphicTexts) {
      const recordFields = createAltiumSchematicTextRecordFields({
        altiumComponentRecordIndex,
        circuitToAltiumSchematicPoint,
        fontTable: nativeTextFontTable,
        schematicText: componentGraphicText,
      })
      if (recordFields) addSchematicRecord(recordFields, schematicRecordContext)
    }
  }

  for (const schematicPort of schematicElements.filter(
    (element) =>
      element.type === "schematic_port" &&
      !asString(element.schematic_component_id),
  )) {
    const sourcePort = sourcePorts.get(asString(schematicPort.source_port_id))
    const isStandaloneNoConnectMarker =
      sourcePort?.do_not_connect === true &&
      schematicPort.is_internal_circuit_port !== true
    if (isStandaloneNoConnectMarker) continue
    const portName =
      sanitizeField(schematicPort.display_pin_label) ||
      sanitizeField(sourcePort?.name)
    const circuitPortPosition = asPoint(schematicPort.center)
    if (!portName || !circuitPortPosition) continue
    addSchematicRecord(
      createAltiumSchematicOffSheetPortRecordFields({
        scale: scaleRatio,
        altiumPortPosition: circuitToAltiumSchematicPoint(circuitPortPosition),
        facingDirection: asString(schematicPort.facing_direction),
        hasInputArrow: schematicPort.has_input_arrow === true,
        hasOutputArrow: schematicPort.has_output_arrow === true,
        portName,
      }),
      schematicRecordContext,
    )
  }

  for (const recordFields of createSchematicWireRecords({
    circuitToAltiumSchematicPoint,
    schematicElements,
  })) {
    addSchematicRecord(recordFields, schematicRecordContext)
  }

  const emittedJunctions = new Set<AltiumSchematicPointKey>()
  for (const schematicTrace of schematicElements.filter(
    (element) => element.type === "schematic_trace",
  )) {
    if (!Array.isArray(schematicTrace.junctions)) continue
    for (const junction of schematicTrace.junctions) {
      const circuitJunctionPoint = asPoint(junction)
      if (!circuitJunctionPoint) continue
      const altiumJunctionPoint =
        circuitToAltiumSchematicPoint(circuitJunctionPoint)
      const altiumJunctionPointKey = `${altiumJunctionPoint.x}:${altiumJunctionPoint.y}`
      if (emittedJunctions.has(altiumJunctionPointKey)) continue
      emittedJunctions.add(altiumJunctionPointKey)
      addSchematicRecord(
        [
          "RECORD=29",
          "OWNERPARTID=-1",
          `INDEXINSHEET=${schematicRecordContext.nextRecordIndex}`,
          `LOCATION.X=${altiumJunctionPoint.x}`,
          `LOCATION.Y=${altiumJunctionPoint.y}`,
          "COLOR=34816",
          `SIZE=${ALTIUM_SMALLEST_JUNCTION_SIZE}`,
          // Preserve explicit source junctions and their color when Altium
          // rebuilds its automatic junctions on document load.
          "LOCKED=T",
        ],
        schematicRecordContext,
      )
    }
  }

  for (const {
    circuitLabelPosition,
    labelText,
    netLabelIndex,
    schematicNetLabel,
    textPresentation,
  } of netLabelPlans) {
    const netLabelRecordFields = createAltiumSchematicNetLabelRecordFields({
      anchorSide: asString(schematicNetLabel.anchor_side),
      altiumLabelCenter: circuitToAltiumSchematicPoint(
        asPoint(schematicNetLabel.center) ?? circuitLabelPosition,
      ),
      altiumLabelPosition: circuitToAltiumSchematicPoint(circuitLabelPosition),
      decorationIndex: netLabelIndex,
      fontTable: asString(textPresentation?.source_trace_id)
        ? nativeTextFontTable
        : altiumSchematicFontTable,
      labelText,
      symbolName: asString(schematicNetLabel.symbol_name),
      textPresentation,
    })
    for (const recordFields of netLabelRecordFields) {
      addSchematicRecord(recordFields, schematicRecordContext)
    }
  }

  for (const schematicPort of schematicElements.filter(
    (element) => element.type === "schematic_port",
  )) {
    const sourcePort = sourcePorts.get(asString(schematicPort.source_port_id))
    if (sourcePort?.do_not_connect !== true) continue
    const circuitPortPosition = asPoint(schematicPort.center)
    if (!circuitPortPosition) continue
    addSchematicRecord(
      createAltiumSchematicNoConnectRecordFields({
        altiumNoConnectPosition:
          circuitToAltiumSchematicPoint(circuitPortPosition),
      }),
      schematicRecordContext,
    )
  }

  for (const annotation of schematicElements) {
    if (
      consumedSheetTexts.has(annotation) ||
      filledSheetBackgrounds.has(annotation)
    ) {
      continue
    }
    const annotationRecordFields =
      createAltiumSchematicSheetAnnotationRecordFields({
        annotation,
        circuitToAltiumSchematicPoint,
        fontTable: nativeTextFontTable,
      })
    if (!annotationRecordFields) continue
    addSchematicRecord(annotationRecordFields, schematicRecordContext)
  }

  return appendSchematicConnectionJunctions(
    `${schematicRecordContext.lines.join("\r\n")}\r\n`,
  )
}
