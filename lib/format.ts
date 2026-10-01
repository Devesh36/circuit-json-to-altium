import { sanitizeAltiumFieldText } from "altiumts"
import type { CircuitElement, Point } from "./types"

export const MILLIMETERS_TO_MILS = 39.3700787402
export const DEFAULT_BOARD_WIDTH_MM = 100
export const DEFAULT_BOARD_HEIGHT_MM = 80

export const asNumber = (input: unknown, fallback = 0): number =>
  typeof input === "number" && Number.isFinite(input) ? input : fallback

export const asPositiveNumber = (input: unknown, fallback: number): number => {
  const number = asNumber(input, fallback)
  return number > 0 ? number : fallback
}

export const asString = (input: unknown, fallback = ""): string =>
  typeof input === "string" ? input : fallback

export const isCircuitElement = (input: unknown): input is CircuitElement =>
  input !== null && typeof input === "object" && !Array.isArray(input)

export const asPoint = (input: unknown): Point | undefined => {
  if (!isCircuitElement(input)) return undefined
  if (
    typeof input.x !== "number" ||
    !Number.isFinite(input.x) ||
    typeof input.y !== "number" ||
    !Number.isFinite(input.y)
  ) {
    return undefined
  }
  return { x: input.x, y: input.y }
}

export const sanitizeField = (field: unknown): string => {
  const rawField =
    typeof field === "number" && Number.isFinite(field)
      ? String(field)
      : asString(field)
  return sanitizeAltiumFieldText(rawField).trim()
}

export const isWindowsReservedFilename = (filename: string): boolean =>
  /^(?:aux|con|nul|prn|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(filename)

export const sanitizeFilename = (filename: string): string => {
  const sanitizedFilename = filename
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^[.-]+|[.-]+$/gu, "")
    .slice(0, 80)
  if (!sanitizedFilename) return "board"
  if (isWindowsReservedFilename(sanitizedFilename)) {
    return `board-${sanitizedFilename}`
  }
  return sanitizedFilename
}

export const formatNumber = (number: number): string => {
  const rounded = Math.round(number * 10_000) / 10_000
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(4)
}

export const formatMil = (mils: number): string => `${formatNumber(mils)}mil`

export const byType = (circuitJson: CircuitElement[], type: string) =>
  circuitJson.filter((element) => element.type === type)

export const pointsEqual = (left: Point, right: Point) =>
  Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9

export const getPolygonArea = (points: Point[]): number => {
  let signedArea = 0
  for (const [index, point] of points.entries()) {
    const nextPoint = points[(index + 1) % points.length]
    if (!nextPoint) continue
    signedArea += point.x * nextPoint.y - nextPoint.x * point.y
  }
  return Math.abs(signedArea / 2)
}
