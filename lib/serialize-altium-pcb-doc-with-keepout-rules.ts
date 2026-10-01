import { parseAltiumPcbDoc } from "altiumts"
import CFB from "cfb"
import { serializeAltiumPcbDocWithBoardCutouts } from "./serialize-altium-pcb-doc-with-board-cutouts"

const streams = {
  Fill: "Fills6",
  Track: "Tracks6",
  Region: "ShapeBasedRegions6",
} as const

/** Bridge fields absent from the pinned altiumts writer into native PCB streams. */
export function serializeAltiumPcbDocWithKeepoutRules(
  source: string,
): Uint8Array {
  const parsed = parseAltiumPcbDoc(source, { mode: "strict" })
  const rules = parsed.getRecordsByKind("Rule")
  if (!rules.length) return serializeAltiumPcbDocWithBoardCutouts(source)
  const stripped = source
    .split(/\r?\n/u)
    .filter((line) => !/^\|RECORD=Rule\|/u.test(line))
    .map((line) => line.replace(/\|UNIONINDEX=\d+/gu, ""))
    .join("\r\n")
  const compound = CFB.read(serializeAltiumPcbDocWithBoardCutouts(stripped), {
    type: "buffer",
  })
  const rulePayloads = rules.map((rule) => {
    if (
      rule.get("RULEKIND") !== "Clearance" ||
      rule.getNumber("BINARYRECORDTYPE") !== 0
    ) {
      throw new Error(
        "Keepout rule serializer only supports native Clearance rules",
      )
    }
    const text = rule
      .getString()
      .trim()
      .replace(/\|(?:RECORD|BINARYRECORDTYPE)=[^|]*/gu, "")
    if (/[^\x20-\x7e]/u.test(text))
      throw new Error("Keepout rule serialization requires ASCII query names")
    const payload = new TextEncoder().encode(`${text}\0`)
    const record = new Uint8Array(payload.length + 6)
    new DataView(record.buffer).setUint32(2, payload.length, true)
    record.set(payload, 6)
    return record
  })
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, rules.length, true)
  CFB.utils.cfb_add(compound, "Rules6/Header", header)
  CFB.utils.cfb_add(compound, "Rules6/Data", concatenate(rulePayloads))

  for (const [kind, family] of Object.entries(streams)) {
    const records = parsed.getRecordsByKind(kind)
    if (!records.some((record) => record.getNumber("UNIONINDEX") !== undefined))
      continue
    const stream = CFB.find(compound, `/${family}/Data`)
    if (!stream) throw new Error(`Missing Altium ${family} stream`)
    const bytes = Uint8Array.from(stream.content)
    const view = new DataView(bytes.buffer)
    const output: Uint8Array[] = []
    let offset = 0
    for (const record of records) {
      if (offset + 5 > bytes.length)
        throw new Error(`Truncated ${family} header`)
      const length = view.getUint32(offset + 1, true)
      const end = offset + 5 + length
      if (end > bytes.length) throw new Error(`Truncated ${family} record`)
      const union = record.getNumber("UNIONINDEX")
      const payload = bytes.slice(offset + 5, end)
      const updated =
        union === undefined ? payload : addUnion({ payload, kind, union })
      const frame = new Uint8Array(5 + updated.length)
      frame[0] = bytes[offset]!
      new DataView(frame.buffer).setUint32(1, updated.length, true)
      frame.set(updated, 5)
      output.push(frame)
      offset = end
    }
    if (offset !== bytes.length)
      throw new Error(`Unexpected trailing ${family} records`)
    stream.content = concatenate(output)
    stream.size = stream.content.length
  }
  return new Uint8Array(
    CFB.write(compound, { fileType: "cfb", type: "buffer" }),
  )
}

function addUnion({
  payload,
  kind,
  union,
}: {
  payload: Uint8Array
  kind: string
  union: number
}): Uint8Array {
  if (!Number.isInteger(union) || union <= 0 || union > 0xffffffff)
    throw new Error("Invalid keepout union index")
  if (kind === "Region") {
    if (payload.length < 22) throw new Error("Truncated region properties")
    const length = new DataView(payload.buffer).getUint32(18, true)
    if (22 + length > payload.length)
      throw new Error("Truncated region property block")
    const properties = new TextDecoder().decode(
      payload.subarray(22, 22 + length),
    )
    if (!properties.includes("UNIONINDEX=0"))
      throw new Error("Missing region union field")
    const updated = new TextEncoder().encode(
      properties.replace("UNIONINDEX=0", `UNIONINDEX=${union}`),
    )
    const result = concatenate([
      payload.subarray(0, 22),
      updated,
      payload.subarray(22 + length),
    ])
    new DataView(result.buffer).setUint32(18, updated.length, true)
    return result
  }
  // Native V7 tails: tracks have a reserved byte after subpolyindex;
  // fills store the union directly after rotation. Both then have a reserved
  // byte and a 32-bit V7 layer. Zero V7 layer leaves the V6 layer authoritative.
  const expectedLength = kind === "Track" ? 35 : 37
  const unionOffset = kind === "Track" ? 36 : 37
  if (payload.length !== expectedLength)
    throw new Error(`Unexpected ${kind} binary layout`)
  const result = new Uint8Array(unionOffset + 9)
  result.set(payload)
  new DataView(result.buffer).setUint32(unionOffset, union, true)
  return result
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  )
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}
