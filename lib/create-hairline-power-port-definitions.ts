import { parseAltiumSchDoc } from "altiumts"
import { createAltiumSchematicCoordinateFields } from "./create-altium-schematic-coordinate-fields"

type HairlineDefinitionRecordContext = {
  color: number
  definitions: string[]
  ownerIndex: number
  scale: number
}

function appendHairlineDefinitionRecord(
  {
    start,
    end,
  }: {
    start: { x: number; y: number }
    end: { x: number; y: number }
  },
  context: HairlineDefinitionRecordContext,
): void {
  const scaledStart = {
    x: start.x * context.scale,
    y: start.y * context.scale,
  }
  const scaledEnd = {
    x: end.x * context.scale,
    y: end.y * context.scale,
  }
  context.definitions.push(
    `|RECORD=13|OwnerIndex=${context.ownerIndex}|OwnerPartId=-1|${[...createAltiumSchematicCoordinateFields("Location.X", scaledStart.x), ...createAltiumSchematicCoordinateFields("Location.Y", scaledStart.y), ...createAltiumSchematicCoordinateFields("Corner.X", scaledEnd.x), ...createAltiumSchematicCoordinateFields("Corner.Y", scaledEnd.y)].join("|")}|LineWidth=0|Color=${context.color}`,
  )
}

export function getHairlinePowerPortDefinitionId(
  style: number,
  color: number,
): string {
  return `{6DC32C5D-B174-46EC-${style.toString(16).padStart(4, "0")}-${color.toString(16).padStart(12, "0")}}`.toUpperCase()
}

/** Native power ports retain their global-net semantics and native text. */
export function createHairlinePowerPortDefinitions(
  asciiContent: string,
  scale = 1,
): string[] {
  const definitions: string[] = []
  const seen = new Set<string>()
  for (const port of parseAltiumSchDoc(asciiContent).powerPorts) {
    const id = port.getCaseInsensitive("ObjectDefinitionId")
    if (!id || seen.has(id)) continue
    const color = port.getNumber("COLOR") ?? 132
    const style = port.getNumber("STYLE")
    if (
      (style !== 2 && style !== 4) ||
      id !== getHairlinePowerPortDefinitionId(style, color)
    )
      continue
    seen.add(id)
    const owner = definitions.length
    definitions.push(
      `|RECORD=129|ObjectDefinitionId=${id}|LibReference=HairlinePower${style}|PartCount=2|CurrentPartId=1|DisplayModeCount=1|Location.X=0|Location.Y=0|OwnerPartId=-1`,
    )
    const hairlineContext = { color, definitions, ownerIndex: owner, scale }
    if (style === 2) {
      appendHairlineDefinitionRecord(
        {
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
        },
        hairlineContext,
      )
      appendHairlineDefinitionRecord(
        {
          start: { x: 10, y: -5 },
          end: { x: 10, y: 5 },
        },
        hairlineContext,
      )
    } else if (style === 4) {
      appendHairlineDefinitionRecord(
        {
          start: { x: 0, y: 0 },
          end: { x: 4, y: 0 },
        },
        hairlineContext,
      )
      appendHairlineDefinitionRecord(
        {
          start: { x: 4, y: -7 },
          end: { x: 4, y: 7 },
        },
        hairlineContext,
      )
      appendHairlineDefinitionRecord(
        {
          start: { x: 8, y: -4.5 },
          end: { x: 8, y: 4.5 },
        },
        hairlineContext,
      )
      appendHairlineDefinitionRecord(
        {
          start: { x: 12, y: -2 },
          end: { x: 12, y: 2 },
        },
        hairlineContext,
      )
    }
  }
  return definitions
}
