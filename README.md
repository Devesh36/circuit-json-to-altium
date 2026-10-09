# circuit-json-to-altium

Convert Circuit JSON schematic and PCB content into an Altium Designer project archive.

## Installation

```bash
bun add circuit-json-to-altium
```

## Usage

```ts
import { CircuitJsonToAltiumConverter } from "circuit-json-to-altium"

const converter = new CircuitJsonToAltiumConverter(circuitJson, {
  projectName: "motor-controller",
})

converter.runUntilFinished()

const { pcb, project, schematics } = converter.getOutput()
const archiveBytes = await converter.getOutputZip()
```

The converter follows the same inspectable pipeline pattern as
`circuit-json-to-kicad`. Call `step()` to advance one stage at a time, inspect
`currentStage`, or use `runUntilFinished()` for ordinary conversion. The stages
build the PCB, schematics, and project before validating every generated
document.

For callers that only need an archive, the convenience function wraps the same
pipeline:

```ts
import { convertCircuitJsonToAltiumZip } from "circuit-json-to-altium"

const archiveBytes = await convertCircuitJsonToAltiumZip(
  circuitJson,
  "motor-controller",
)

await Bun.write("motor-controller-altium.zip", archiveBytes)
```

The returned ZIP archive contains:

- a native binary `.PcbDoc`
- one native binary `.SchDoc` per Circuit JSON schematic sheet
- a native binary `.PrjPcb`
- a short conversion note

The converter validates its generated PCB and schematic documents before returning the archive. Invalid geometry is rejected with a descriptive error instead of producing a corrupt project.

## Schematic junction scale

New schematics default to **200 / 3 (66.67) Altium units per Circuit JSON
unit**. Altium's smallest native junction has radius 2, so its relative radius
is **0.03 Circuit JSON units**. The native `SIZE=0` field stays a size preset.
Coordinates and fonts are converted directly from the source before rounding;
physical sheet dimensions and font-point values increase with this scale.
PCB geometry is unchanged.

For the previous physical sheet scale, use:

```ts
const converter = new CircuitJsonToAltiumConverter(circuitJson, {
  schematicUnitsPerCircuitUnit: 20,
})
```

Imported Altium templates keep scale 20 by default to preserve their original
native geometry. Explicitly selecting another scale with a template is rejected.

Final wires, including generated net-label leaders, are normalized before
junction detection. Coincident wire records contribute distinct connection
directions, so a label on a straight wire does not create extra dots. Real
branches and connected crossings retain their vertices.

The TI TPS61288 export was checked in the native Altium Viewer: 62 green dots,
radius 2 at the new scale, and no exposed blue automatic junctions. Native pin
markers and the automotive microcontroller sheet were also inspected. Integer
font sizes still require rounding. The pinned Altiumts preview uses a different
junction radius, so local SVGs are not exact native dot-size references.

Run `bun scripts/generate-junction-review-files.ts` to regenerate the native
review files and source/preview comparisons in `tests/assets`.

## Supported content

The current converter handles board outlines, components, pads, plated and non-plated holes, routed copper with vias, nets, PCB silkscreen, schematic components, custom component symbol graphics, component pins, intentionally unconnected source ports, off-sheet ports, labels, native power ports, junctions, traces, and free-standing schematic sheet text and graphics. It also preserves multiple schematic sheets and sanitizes Altium field and filename text.

`schematic_graphic` elements with inline `svg_content` or SVG asset data URLs
are rendered into embedded native schematic images. Graphics retain their
centered sheet placement, optional width and height, aspect ratio, and PNG
transparency. Raster output is limited to 2048 pixels on its longest side.
External assets need materialized `svg_content`, and images referenced within
the SVG must use embedded data URLs.

`altiumts` owns the Altium document model, parsing, and native binary serialization. This package owns the Circuit JSON-to-Altium mapping and archive assembly.

## Development

```bash
bun install
bun run download-references
bun run check
```

Tests follow the tscircuit convention of one test case per test file. The suite covers archive structure, filename sanitization, PCB geometry and connectivity, schematic primitives and sheets, randomized inputs, and native binary round trips.

Five board and five schematic round-trip tests use SHA-256-pinned,
permissively licensed Altium references downloaded from immutable GitHub
revisions. `altiumts` parses each native file, a narrow test fixture projects
its supported primitives into Circuit JSON, and the converter writes a new
native document that `altiumts` parses and renders again. The PCB tests require
exact primitive and rotation counts and sub-0.03 mm relative geometry drift.
The corpus covers binary CFB and ASCII Altium documents without GPL or
reciprocal/copyleft fixtures.

Every visual comparison embeds the unchanged source and generated SVGs side by
side in one snapshot. Visual baselines live in `tests/__snapshots__` so mapping
regressions can be reviewed directly in a pull request.

Schematic previews use a pinned `altiumts` renderer commit to expose native-format
errors in the current export. These are local previews, not official Altium
captures, and a passing snapshot does not establish correct conversion. See
[Altium rendering](docs/altium-rendering.md) for the modeled rules, known gaps,
and the microcontroller example with intentionally visible conversion issues.

```bash
# Update visual snapshots after reviewing an intentional rendering change
BUN_UPDATE_SNAPSHOTS=1 bun test tests/visual01-pcb-comparison.test.tsx
BUN_UPDATE_SNAPSHOTS=1 bun test tests/visual02-schematic-comparison.test.tsx
BUN_UPDATE_SNAPSHOTS=1 bun test tests/roundtrip*.test.ts
```

## Project structure

```text
lib/
├── circuit-json-to-altium-converter.ts  # Step-driven converter pipeline
├── converter-stage.ts                   # Shared stage contract
├── stages/                              # PCB, schematic, project, validation
├── create-pcb-document.ts               # Circuit JSON PCB mapping
└── create-schematic-document.ts         # Circuit JSON schematic mapping
tests/
├── fixtures/                            # Shared round-trip and archive helpers
└── __snapshots__/                       # Raw renderer baselines
references/                               # Downloaded test inputs and provenance
scripts/                                  # Reference download and integrity checks
```

## Native keepout exclusion rules (pending Altium Designer verification)

Keepouts with `excluded_pcb_component_ids` are assigned separate native union
indices. Their clearance rules use `IsKeepOut And InUnion(n)` against the
excluded components and traces on their connected nets. Geometry, layers,
other keepouts, and unrelated copper are retained. Component designators that
would make membership queries ambiguous are rejected.

The binary writer bridge adds `Rules6` records and union membership omitted
by the pinned serializer. This approach follows Altium's documented local
zero-clearance treatment for footprint keepout conflicts:
https://www.altium.com/documentation/knowledge-base/altium-designer/keepout-region-error-within-the-same-footprint-primitives

Automated tests verify the native rule scope and binary fields, not Altium's
DRC or routing behavior. Before merging, verify in Altium Designer that an
exempt component's pads and connected traces can overlap the keepout while
unrelated copper remains blocked, including another keepout at the same
location. In particular, confirm that `GAP=0mil` permits the required overlap;
a zero gap alone must not be assumed to disable a collision check.
