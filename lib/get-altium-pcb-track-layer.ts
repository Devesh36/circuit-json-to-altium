export function getAltiumPcbTrackLayer(layer: string): string {
  const normalized = layer.toLowerCase()
  if (normalized === "top") return "TOP"
  if (normalized === "bottom") return "BOTTOM"
  const inner = /^inner([1-8])$/.exec(normalized)
  if (inner) return `MID-LAYER${inner[1]}`
  throw new Error(`Unsupported PCB track layer: ${layer}`)
}
