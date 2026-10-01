import {
  asPoint,
  asPositiveNumber,
  DEFAULT_BOARD_HEIGHT_MM,
  DEFAULT_BOARD_WIDTH_MM,
  getPolygonArea,
  pointsEqual,
} from "./format"
import type { CircuitElement, Point } from "./types"

export const getBoardOutline = (board: CircuitElement | undefined): Point[] => {
  if (board?.outline !== undefined) {
    if (!Array.isArray(board.outline)) {
      throw new TypeError("pcb_board.outline must be an array of finite points")
    }
    const explicitOutline = board.outline.map((point, index) => {
      const parsedPoint = asPoint(point)
      if (!parsedPoint) {
        throw new TypeError(
          `pcb_board.outline[${index}] must contain finite x and y coordinates`,
        )
      }
      return parsedPoint
    })
    const firstOutlinePoint = explicitOutline[0]
    const lastOutlinePoint = explicitOutline.at(-1)
    if (
      explicitOutline.length > 1 &&
      firstOutlinePoint &&
      lastOutlinePoint &&
      pointsEqual(firstOutlinePoint, lastOutlinePoint)
    ) {
      explicitOutline.pop()
    }
    if (explicitOutline.length < 3 || getPolygonArea(explicitOutline) <= 1e-9) {
      throw new RangeError(
        "pcb_board.outline must contain at least three points with non-zero area",
      )
    }
    return explicitOutline
  }

  const center =
    board?.center === undefined ? { x: 0, y: 0 } : asPoint(board.center)
  if (!center) {
    throw new TypeError(
      "pcb_board.center must contain finite x and y coordinates",
    )
  }
  const width = getBoardDimension({
    dimension: board?.width,
    fallback: DEFAULT_BOARD_WIDTH_MM,
    fieldName: "width",
  })
  const height = getBoardDimension({
    dimension: board?.height,
    fallback: DEFAULT_BOARD_HEIGHT_MM,
    fieldName: "height",
  })
  return [
    { x: center.x - width / 2, y: center.y - height / 2 },
    { x: center.x + width / 2, y: center.y - height / 2 },
    { x: center.x + width / 2, y: center.y + height / 2 },
    { x: center.x - width / 2, y: center.y + height / 2 },
  ]
}

function getBoardDimension({
  dimension,
  fallback,
  fieldName,
}: {
  dimension: unknown
  fallback: number
  fieldName: "height" | "width"
}): number {
  if (dimension === undefined) return fallback
  const parsedDimension = asPositiveNumber(dimension, Number.NaN)
  if (!Number.isFinite(parsedDimension)) {
    throw new RangeError(
      `pcb_board.${fieldName} must be a positive finite number`,
    )
  }
  return parsedDimension
}
