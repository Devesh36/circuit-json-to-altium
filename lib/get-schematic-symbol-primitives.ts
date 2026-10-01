import { asString } from "./format"
import { isSchematicSymbolPrimitive } from "./is-schematic-symbol-primitive"
import type {
  CircuitElement,
  SchematicComponentId,
  SchematicSymbolId,
} from "./types"

export type SchematicSymbolPrimitiveMaps = {
  byComponentId: Map<SchematicComponentId, CircuitElement[]>
  bySymbolId: Map<SchematicSymbolId, CircuitElement[]>
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

export function createSchematicSymbolPrimitiveMaps(
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

export function getSchematicSymbolPrimitives({
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
