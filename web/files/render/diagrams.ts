// Mermaid diagrams in a rendered document. This file is in the shell and small; Mermaid
// itself (render/mermaid.ts) is fetched on the first document that has a fence. Those files
// are not precached, so a diagram needs the network, and a page one build behind finds them
// gone: the service worker reports that 404 and the app raises "Update required".
import type { Viewport } from "../../platform/types";
import { DIAGRAM_BLOCK } from "./markdown";

let renderer: Promise<typeof import("./mermaid")> | undefined;

function load() {
  // A failed load is not kept: the next document tries again.
  renderer ??= import("./mermaid").catch((error: unknown) => {
    renderer = undefined;
    throw error;
  });
  return renderer;
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

/**
 * Replaces every ```mermaid block under `root` with its diagram, and returns the function that
 * puts the blocks back (so a scheme change renders again from the source). A block shows "Loading diagram…"
 * until it draws; one that does not draw stays as a code block with the reason after it.
 */
export function mountDiagrams(root: HTMLElement, scheme: Viewport["scheme"]): () => void {
  const blocks = [...root.querySelectorAll<HTMLElement>(DIAGRAM_BLOCK)].flatMap((code) => (code.parentElement ? [code.parentElement] : []));
  if (blocks.length === 0) return () => undefined;
  const added: Element[] = [];
  const abort = new AbortController();
  // A function, so the checks after each await are not narrowed to the value they had before it.
  const stale = (): boolean => abort.signal.aborted;
  // Each block waits behind a status line in its place; a failure brings the code back, with the reason in the line.
  const waiting = blocks.map((pre) => {
    const p = document.createElement("p");
    p.setAttribute("role", "status");
    p.textContent = "Loading diagram…";
    pre.hidden = true;
    added.push(p);
    pre.after(p);
    return p;
  });
  const fail = (pre: HTMLElement, line: Element, text: string): void => {
    pre.hidden = false;
    line.setAttribute("role", "note");
    line.textContent = text;
  };
  void (async () => {
    let mermaid: Awaited<ReturnType<typeof load>>;
    try {
      mermaid = await load();
    } catch {
      if (!stale()) blocks.forEach((pre, i) => { fail(pre, waiting[i] as Element, "Diagrams couldn't load. Reload to try again."); });
      return;
    }
    for (const [i, pre] of blocks.entries()) {
      if (stale()) return;
      const line = waiting[i] as Element;
      try {
        const svg = await mermaid.renderDiagram(pre.textContent, scheme);
        if (stale()) return;
        const figure = document.createElement("figure");
        figure.append(svg);
        const el = figure.querySelector("svg");
        // Natural size, so a wide diagram scrolls inside its figure instead of shrinking past reading.
        const width = el?.viewBox.baseVal.width;
        if (el && width) { el.setAttribute("width", String(width)); el.style.maxWidth = "none"; }
        added.push(figure);
        line.replaceWith(figure);
      } catch (error) {
        if (!stale()) fail(pre, line, `Diagram couldn't render: ${reasonOf(error)}`);
      }
    }
  })();
  return () => {
    abort.abort();
    for (const el of added) el.remove();
    for (const pre of blocks) pre.hidden = false;
  };
}
