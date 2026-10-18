import { geistMeasurer } from "@/lib/geist-measurer";
import type { Element, ElementContent, Root } from "hast";
import { toString } from "hast-util-to-string";
import { createHash } from "node:crypto";
import {
  type DiagramModel,
  parse,
  PeleError,
  render,
  type RenderOptions,
  type RenderResult,
} from "pele";
import { cache } from "react";
import { visit } from "unist-util-visit";

const RENDER_OPTIONS: RenderOptions = {
  measurer: geistMeasurer,
  // Remote images in a public gist would be tracking pixels, and the CSP in
  // proxy.ts blocks them anyway, which would leave empty frames
  images: false,
};

// Phones get a second layout this wide, where Pele rewraps labels and turns
// wide diagrams vertical. It fits a 390px phone's text column minus the
// diagram frame; globals.css shows it below 640px.
const NARROW_WIDTH = 330;

// SVG can dwarf its source (a 26-character packet diagram draws megabytes),
// and Pele's own limits apply per render. So each layout is capped, and one
// budget covers every diagram on the page; past it, diagrams stay as source.
const MAX_LAYOUT_SVG = 500_000;
const PAGE_SVG_BUDGET = 2_000_000;

interface SvgBudget {
  remaining: number;
}

/** The SVG budget for the current request, shared by every file on the page */
export const pageSvgBudget = cache(
  (): SvgBudget => ({ remaining: PAGE_SVG_BUDGET }),
);

const EXPAND_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/></svg>`;

function div(className: string, children: ElementContent[]): Element {
  return {
    type: "element",
    tagName: "div",
    properties: { className: [className] },
    children,
  };
}

// Pele only checks outputLimit after drawing, so an oversized layout spends
// its share of the budget even though none of it ships
function renderWithin(
  model: DiagramModel,
  options: RenderOptions,
  budget: SvgBudget,
): RenderResult {
  const outputLimit = Math.min(MAX_LAYOUT_SVG, budget.remaining);
  try {
    const result = render(model, { ...RENDER_OPTIONS, ...options, outputLimit });
    budget.remaining -= result.svg.length;
    return result;
  } catch (error) {
    if (error instanceof PeleError && error.code === "limit") {
      budget.remaining -= outputLimit;
    }
    throw error;
  }
}

function renderNarrow(
  model: DiagramModel,
  wide: RenderResult,
  idPrefix: string,
  budget: SvgBudget,
): RenderResult | null {
  if (wide.width <= NARROW_WIDTH || budget.remaining <= 0) return null;
  try {
    const narrow = renderWithin(
      model,
      { idPrefix: `${idPrefix}-narrow`, maxWidth: NARROW_WIDTH },
      budget,
    );
    if (narrow.width !== wide.width || narrow.height !== wide.height) {
      return narrow;
    }
    // Pele kept the wide layout, so there is nothing to swap in
    budget.remaining += narrow.svg.length;
    return null;
  } catch {
    // Phones still get the wide layout, scaled down
    return null;
  }
}

function renderDiagram(
  source: string,
  idPrefix: string,
  budget: SvgBudget,
): Element {
  const fallback = div("mermaid-diagram", [{ type: "text", value: source }]);
  if (budget.remaining <= 0) return fallback;

  let model: DiagramModel;
  let wide: RenderResult;
  // Pele throws PeleError for invalid, unsupported or oversized diagrams;
  // anything else it throws must not take the page down either
  try {
    model = parse(source);
    wide = renderWithin(model, { idPrefix }, budget);
  } catch {
    return fallback;
  }

  const narrow = renderNarrow(model, wide, idPrefix, budget);
  const layouts: ElementContent[] = narrow
    ? [
        div("mermaid-wide", [{ type: "raw", value: wide.svg }]),
        div("mermaid-narrow", [{ type: "raw", value: narrow.svg }]),
      ]
    : [{ type: "raw", value: wide.svg }];

  return {
    type: "element",
    tagName: "div",
    properties: {
      className: ["mermaid-diagram"],
      dataRendered: "",
      // Lets the viewer give its copy distinct ids (mermaid-expand-handler.tsx)
      dataDiagramId: idPrefix,
      style: `--diagram-width:${wide.width}px`,
    },
    children: [
      ...layouts,
      {
        type: "element",
        tagName: "button",
        properties: {
          type: "button",
          className: ["mermaid-expand-btn"],
          ariaLabel: "View diagram full screen",
        },
        children: [{ type: "raw", value: EXPAND_ICON }],
      },
    ],
  };
}

/**
 * Renders ```mermaid fences to SVG with Pele on the server, so diagrams ship
 * in the HTML with no client JS. Invalid or oversized diagrams fall back to
 * their source. Must run after rehypeSanitize, since the SVG is inserted as
 * raw HTML, and before rehypeShiki.
 */
export function rehypeMermaidBlocks({ budget }: { budget: SvgBudget }) {
  return (tree: Root) => {
    let count = 0;
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "pre" || !parent || typeof index !== "number") {
        return;
      }
      const code = node.children.find(
        (child): child is Element =>
          child.type === "element" && child.tagName === "code",
      );
      const classes = code?.properties.className;
      if (
        !code ||
        !Array.isArray(classes) ||
        !classes.includes("language-mermaid")
      ) {
        return;
      }
      const source = toString(code);
      // Ids in the SVG (accessible titles) must be unique across every file
      // on the page, so key them on the source rather than a counter alone
      const hash = createHash("sha256").update(source).digest("hex");
      parent.children[index] = renderDiagram(
        source,
        `mermaid-${hash.slice(0, 8)}-${count++}`,
        budget,
      );
    });
  };
}
