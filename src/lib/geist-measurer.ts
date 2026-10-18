import type { TextMeasurer } from "pele";
import geistWidths from "./geist-widths.json";

// Pele's style flags for TextMeasurer.width(); italic has no width effect
const BOLD = 1;
const MONO = 4;

function widthTable(runs: number[][]) {
  const widths = new Map<number, number>();
  for (const [first, ...run] of runs) {
    run.forEach((width, i) => width && widths.set(first + i, width));
  }
  return widths;
}

const regular = widthTable(geistWidths.regular);
const bold = widthTable(geistWidths.bold);

// These ranges and the fallback widths below mirror Pele's own no-DOM
// estimates (metricsMeasurer in its text/measurer module) for glyphs Geist
// lacks, which the browser draws from a fallback font. Astral characters such
// as emoji count once, through their high surrogate.
function isWide(code: number) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0xd800 && code <= 0xdbff)
  );
}

function isZeroWidth(code: number) {
  return (
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0xdc00 && code <= 0xdfff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    code === 0xfeff
  );
}

/**
 * Measures diagram labels with Geist's real advance widths, so diagrams laid
 * out on the server fit the site font. Without a DOM, Pele falls back to a
 * Helvetica width table, and Geist runs about 9% wider in lowercase (73% on
 * "/"), which leaves labels touching or crossing their node borders.
 * Regenerate the widths with scripts/geist-widths.mjs.
 */
export const geistMeasurer: TextMeasurer = {
  width(text, size, style) {
    const mono = (style & MONO) !== 0;
    const widths = style & BOLD ? bold : regular;
    let total = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 32 || isZeroWidth(code)) continue;
      // Geist Mono advances are all 600
      if (mono) total += isWide(code) ? 1200 : 600;
      else total += widths.get(code) ?? (isWide(code) ? 1000 : 580);
    }
    return (total * size) / 1000;
  },
};
