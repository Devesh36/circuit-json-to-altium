import { ALTIUM_SCHEMATIC_SHEET_AREA_COLOR } from "./altium-schematic-colors"
import { createAltiumSchematicSheetAnnotationRecordFields } from "./create-altium-schematic-sheet-annotation-record-fields"
import {
  type AltiumSchematicSheetSymbolPlan,
  createAltiumSchematicSheetEntryNoConnectRecordFields,
  createAltiumSchematicSheetSymbolOwnedRecordFields,
  createAltiumSchematicSheetSymbolPlans,
  createAltiumSchematicSheetSymbolRecordFields,
} from "./create-altium-schematic-sheet-symbol-records"
import { asNumber, asPoint, asPositiveNumber, isCircuitElement } from "./format"
import { isSchematicSheetAnnotation } from "./is-schematic-sheet-annotation"
import { getFallbackSchematicBoxBounds } from "./schematic-box-geometry"
import {
  addSchematicRecord,
  remapTemplateFontId,
} from "./schematic-document-records"
import type { SchematicDocumentContext } from "./schematic-document-types"
import type { CircuitElement, Point } from "./types"

type SchematicSheetLayout = {
  altiumSheetHeight: number
  altiumSheetWidth: number
  automaticallyPlacedPlans: AltiumSchematicSheetSymbolPlan[]
  columnCount: number
  columnWidth: number
  rowHeight: number
  startX: number
}

type SheetSymbolPlacement = {
  location: Point
  plan: AltiumSchematicSheetSymbolPlan
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

function getSchematicSheetLayout(
  plans: AltiumSchematicSheetSymbolPlan[],
  context: SchematicDocumentContext,
): SchematicSheetLayout {
  const automaticallyPlacedPlans = plans.filter(
    (plan) => !plan.placementComponent,
  )
  const columnCount = Math.max(
    Math.ceil(Math.sqrt(automaticallyPlacedPlans.length)),
    1,
  )
  const rowCount = Math.ceil(automaticallyPlacedPlans.length / columnCount)
  const columnWidth = Math.max(
    ...automaticallyPlacedPlans.map((plan) => plan.width),
    0,
  )
  const rowHeight = Math.max(
    ...automaticallyPlacedPlans.map((plan) => plan.height),
    0,
  )
  const hasRenderableSchematicContent = context.schematicElements.some(
    (element) =>
      element.type !== "schematic_graphic" &&
      element.type !== "schematic_group" &&
      element.type !== "schematic_symbol",
  )
  const startX = hasRenderableSchematicContent
    ? context.contentWidth + 40 * context.scaleRatio
    : 60 * context.scaleRatio
  const layoutWidth =
    columnCount * columnWidth +
    Math.max(columnCount - 1, 0) * 40 * context.scaleRatio
  const layoutHeight =
    rowCount * rowHeight + Math.max(rowCount - 1, 0) * 40 * context.scaleRatio
  return {
    altiumSheetWidth: Math.max(
      context.contentWidth,
      automaticallyPlacedPlans.length > 0
        ? startX + layoutWidth + 60 * context.scaleRatio
        : 0,
    ),
    altiumSheetHeight: Math.max(
      context.contentHeight,
      automaticallyPlacedPlans.length > 0
        ? layoutHeight + 120 * context.scaleRatio
        : 0,
    ),
    automaticallyPlacedPlans,
    columnCount,
    columnWidth,
    rowHeight,
    startX,
  }
}

function getSheetSymbolPlacement(
  {
    automaticallyPlacedPlanIndex,
    plan,
  }: {
    automaticallyPlacedPlanIndex: number
    plan: AltiumSchematicSheetSymbolPlan
  },
  context: SchematicDocumentContext & { sheetLayout: SchematicSheetLayout },
): SheetSymbolPlacement {
  if (!plan.placementComponent) {
    const columnIndex =
      automaticallyPlacedPlanIndex % context.sheetLayout.columnCount
    const rowIndex = Math.floor(
      automaticallyPlacedPlanIndex / context.sheetLayout.columnCount,
    )
    return {
      location: {
        x:
          context.sheetLayout.startX +
          columnIndex *
            (context.sheetLayout.columnWidth + 40 * context.scaleRatio),
        y:
          context.sheetLayout.altiumSheetHeight -
          60 * context.scaleRatio -
          rowIndex * (context.sheetLayout.rowHeight + 40 * context.scaleRatio),
      },
      plan,
    }
  }

  const circuitCenter = asPoint(plan.placementComponent.center) ?? {
    x: 0,
    y: 0,
  }
  const circuitSize = isCircuitElement(plan.placementComponent.size)
    ? plan.placementComponent.size
    : {}
  const width = context.circuitToAltiumSchematicLength(
    asPositiveNumber(
      circuitSize.width,
      plan.width / context.unitsPerCircuitUnit,
    ),
  )
  const height = context.circuitToAltiumSchematicLength(
    asPositiveNumber(
      circuitSize.height,
      plan.height / context.unitsPerCircuitUnit,
    ),
  )
  const altiumCenter = context.circuitToAltiumSchematicPoint(circuitCenter)
  let location = {
    x: altiumCenter.x - width / 2,
    y: altiumCenter.y + height / 2,
  }
  let placedPlan = { ...plan, height, width }
  if (context.unitsPerCircuitUnit !== 20) {
    const bounds = getFallbackSchematicBoxBounds({
      circuitComponentCenter: circuitCenter,
      circuitComponentHeight: height / context.unitsPerCircuitUnit,
      circuitComponentWidth: width / context.unitsPerCircuitUnit,
      circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
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
                context.circuitToAltiumSchematicPoint(entry.circuitPosition)
                  .y) /
                10,
            )
          : entry.distanceFromTop,
      })),
    }
  }
  return { location, plan: placedPlan }
}

function appendSheetSymbol(
  placement: SheetSymbolPlacement,
  context: SchematicDocumentContext,
): void {
  const altiumSymbolRecordIndex = addSchematicRecord(
    createAltiumSchematicSheetSymbolRecordFields({
      location: placement.location,
      plan: placement.plan,
    }),
    context.recordContext,
  )
  for (const recordFields of createAltiumSchematicSheetSymbolOwnedRecordFields({
    altiumSymbolRecordIndex,
    location: placement.location,
    plan: placement.plan,
    scale: context.scaleRatio,
  })) {
    addSchematicRecord(recordFields, context.recordContext)
  }
  for (const recordFields of createAltiumSchematicSheetEntryNoConnectRecordFields(
    {
      location: placement.location,
      plan: placement.plan,
    },
  )) {
    addSchematicRecord(recordFields, context.recordContext)
  }
}

export function appendSchematicSheetRecords(
  context: SchematicDocumentContext,
): void {
  const plans = createAltiumSchematicSheetSymbolPlans({
    scale: context.scaleRatio,
    childSheets: context.childSheets,
    circuitJson: context.circuitJson,
  })
  for (const plan of plans) {
    if (plan.placementComponent) {
      context.explicitlyPositionedSheetSymbolComponents.add(
        plan.placementComponent,
      )
    }
  }
  const sheetLayout = getSchematicSheetLayout(plans, context)
  addSchematicRecord(
    [
      "RECORD=31",
      ...context.altiumSchematicFontTable.sheetRecordFields,
      `AREACOLOR=${ALTIUM_SCHEMATIC_SHEET_AREA_COLOR}`,
      `CUSTOMX=${context.unitsPerCircuitUnit === 20 ? sheetLayout.altiumSheetWidth : Math.ceil(sheetLayout.altiumSheetWidth)}`,
      `CUSTOMY=${context.unitsPerCircuitUnit === 20 ? sheetLayout.altiumSheetHeight : Math.ceil(sheetLayout.altiumSheetHeight)}`,
      "USECUSTOMSHEET=T",
      "SNAPGRIDON=T",
      `SNAPGRIDSIZE=${Math.max(1, Math.round(10 * context.scaleRatio))}`,
      ...(context.template?.sheetRecordFields ?? []),
    ],
    context.recordContext,
  )
  for (const recordFields of context.template?.recordFields ?? []) {
    addSchematicRecord(
      remapTemplateFontId({
        fontIdBySourceFontId:
          context.altiumSchematicFontTable.templateFontIdBySourceFontId,
        recordFields,
      }),
      context.recordContext,
    )
  }

  const schematicComponents = context.schematicElements.filter(
    (element) => element.type === "schematic_component",
  )
  for (const element of context.schematicElements) {
    if (isFilledSchematicSheetBackground({ element, schematicComponents })) {
      context.filledSheetBackgrounds.add(element)
      const recordFields = createAltiumSchematicSheetAnnotationRecordFields({
        annotation: element,
        circuitToAltiumSchematicPoint: context.circuitToAltiumSchematicPoint,
        fontTable: context.altiumSchematicFontTable,
      })
      if (recordFields) addSchematicRecord(recordFields, context.recordContext)
    }
  }

  let automaticallyPlacedPlanIndex = 0
  const placementContext = { ...context, sheetLayout }
  for (const plan of plans) {
    appendSheetSymbol(
      getSheetSymbolPlacement(
        { automaticallyPlacedPlanIndex, plan },
        placementContext,
      ),
      context,
    )
    if (!plan.placementComponent) automaticallyPlacedPlanIndex++
  }
}
