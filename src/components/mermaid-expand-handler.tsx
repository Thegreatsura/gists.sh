"use client";

import { MermaidViewer } from "@/components/mermaid-viewer";
import { useCallback, useEffect, useState } from "react";

// Opens the full-screen viewer when a diagram rendered by rehypeMermaidBlocks
// (or its expand button) is clicked. Links inside a diagram navigate instead.
export function MermaidExpandHandler() {
  const [svg, setSvg] = useState<string | null>(null);
  const close = useCallback(() => setSvg(null), []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Every MarkdownRenderer on the page mounts a handler, so the first one
      // claims the click and the others skip it
      if (e.defaultPrevented) return;
      const target = e.target as Element;
      if (target.closest("a")) return;
      const block = target.closest<HTMLElement>(
        ".markdown-body .mermaid-diagram[data-rendered]",
      );
      if (!block) return;
      // Phones get a narrow layout alongside the wide one; open whichever
      // is on screen
      const shown = [...block.querySelectorAll("svg.pele")].find(
        (el) => el.getClientRects().length > 0,
      );
      if (!shown) return;
      e.preventDefault();
      // Ids in the SVG (accessible titles) all start with the diagram id, and
      // the copy in the viewer must not duplicate them
      const id = block.dataset.diagramId ?? "";
      setSvg(
        id ? shown.outerHTML.replaceAll(id, `${id}-full`) : shown.outerHTML,
      );
    }

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  if (!svg) return null;
  return <MermaidViewer svg={svg} onClose={close} />;
}
