// Regenerates src/lib/geist-widths.json, the Geist advance widths that
// geist-measurer.ts gives Pele when it lays out diagrams on the server.
// Re-run after upgrading the geist package: node scripts/geist-widths.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// geist's exports map hides package.json, so read the install directly
const geist = fileURLToPath(new URL("../node_modules/geist/", import.meta.url));
const { version } = JSON.parse(readFileSync(`${geist}package.json`));

// Glyphs further apart than this start a new run instead of padding with zeros
const MAX_GAP = 8;

// Reads the Unicode BMP cmap (format 4) and hmtx tables of a TrueType font,
// returning each mapped code point's advance width in 1/1000 em.
function advanceWidths(file) {
  const buf = readFileSync(file);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = {};
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    tables[buf.toString("latin1", record, record + 4)] = view.getUint32(
      record + 8,
    );
  }

  const unitsPerEm = view.getUint16(tables.head + 18);
  const metricCount = view.getUint16(tables.hhea + 34);
  const advance = (glyph) =>
    view.getUint16(tables.hmtx + 4 * Math.min(glyph, metricCount - 1));

  let cmap;
  for (let i = 0; i < view.getUint16(tables.cmap + 2); i++) {
    const record = tables.cmap + 4 + i * 8;
    const offset = tables.cmap + view.getUint32(record + 4);
    const isWindowsUnicode =
      view.getUint16(record) === 3 && view.getUint16(record + 2) === 1;
    if (isWindowsUnicode && view.getUint16(offset) === 4) cmap = offset;
  }

  const widths = new Map();
  const segments = view.getUint16(cmap + 6) / 2;
  const ends = cmap + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  for (let s = 0; s < segments; s++) {
    const start = view.getUint16(starts + s * 2);
    const end = view.getUint16(ends + s * 2);
    const delta = view.getInt16(deltas + s * 2);
    const rangeOffset = view.getUint16(rangeOffsets + s * 2);
    for (let code = Math.max(start, 32); code <= end && code < 0xffff; code++) {
      let glyph = rangeOffset
        ? view.getUint16(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2)
        : code;
      if (glyph === 0) continue;
      glyph = (glyph + delta) & 0xffff;
      widths.set(code, Math.round((advance(glyph) * 1000) / unitsPerEm));
    }
  }
  return widths;
}

// Packs widths into runs of [firstCodePoint, ...widths], 0 marking a gap
function runs(widths) {
  const codes = [...widths.keys()].sort((a, b) => a - b);
  const result = [];
  let run;
  for (const code of codes) {
    const gap = run ? code - (run[0] + run.length - 2) : Infinity;
    if (gap > MAX_GAP) result.push((run = [code]));
    else for (let i = 1; i < gap; i++) run.push(0);
    run.push(widths.get(code));
  }
  return result;
}

const font = (name) => `${geist}dist/fonts/geist-sans/${name}`;
const output = {
  source: `geist@${version}`,
  regular: runs(advanceWidths(font("Geist-Regular.ttf"))),
  bold: runs(advanceWidths(font("Geist-Bold.ttf"))),
};

const target = new URL("../src/lib/geist-widths.json", import.meta.url);
writeFileSync(target, JSON.stringify(output) + "\n");
console.log(`Wrote ${target.pathname} from geist@${version}`);
