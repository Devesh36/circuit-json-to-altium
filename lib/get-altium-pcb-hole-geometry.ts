import { convertCircuitPcbCcwRotationDegreesToAltium } from "./convert-circuit-pcb-ccw-rotation-degrees-to-altium"

/** Convert Circuit JSON's local X/Y dimensions into Altium's pad-local hole geometry. */
export function getAltiumPcbHoleGeometry({
  widthMm,
  heightMm,
  holeCcwRotationDegrees,
  padCcwRotationDegrees,
}: {
  widthMm: number
  heightMm: number
  holeCcwRotationDegrees: number
  padCcwRotationDegrees: number
}): {
  shape: "SLOT" | "ROUND"
  sizeMm: number
  lengthMm: number
  rotationDegrees: number
} {
  const isSlot = Math.abs(widthMm - heightMm) > 1e-9
  let rotationDegrees = holeCcwRotationDegrees
  if (isSlot) {
    // Altium slots extend along X and rotate relative to the copper pad.
    rotationDegrees =
      holeCcwRotationDegrees +
      (heightMm > widthMm ? 90 : 0) -
      padCcwRotationDegrees
  }
  return {
    shape: isSlot ? "SLOT" : "ROUND",
    sizeMm: Math.min(widthMm, heightMm),
    lengthMm: Math.max(widthMm, heightMm),
    rotationDegrees:
      convertCircuitPcbCcwRotationDegreesToAltium(rotationDegrees),
  }
}
