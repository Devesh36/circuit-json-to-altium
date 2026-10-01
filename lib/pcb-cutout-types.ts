import type { Point } from "./types"

export type PcbCutoutRegion = {
  innerRings?: Point[][]
  outerRing: Point[]
}
