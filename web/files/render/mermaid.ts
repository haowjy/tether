// Mermaid diagrams in a rendered document. Mermaid and DOMPurify load on the first diagram.
// A diagram's source is untrusted (plan.md "Rendered content is untrusted"): Mermaid runs in
// `strict` mode, which a `%%{init}%%` directive cannot lower, and the SVG it returns is
// sanitized again before it enters the page.
import type { Viewport } from "../../platform/types";

type Scheme = Viewport["scheme"];

/** The only `url()` a diagram's styles may use is an in-document reference such as a marker. */
const EXTERNAL_URL = /url\(\s*(?!["']?#)[^)]*\)|@import[^;]*;?/giu;

async function sanitizer() {
  const { default: DOMPurify } = await import("dompurify");
  const purify = DOMPurify();
  purify.addHook("uponSanitizeElement", (node) => {
    if (node.nodeName.toLowerCase() === "style") node.textContent = (node.textContent ?? "").replace(EXTERNAL_URL, "");
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    // Only in-document fragments: no link, `use` or marker leads anywhere else.
    for (const name of ["href", "xlink:href"]) {
      const value = node.getAttribute(name);
      if (value !== null && !value.startsWith("#")) node.removeAttribute(name);
    }
  });
  return purify;
}

let ready: Promise<{ render: (id: string, source: string, theme: Scheme) => Promise<string>; purify: Awaited<ReturnType<typeof sanitizer>> }> | undefined;

function load() {
  ready ??= Promise.all([import("mermaid"), sanitizer()]).then(([{ default: mermaid }, purify]) => ({
    purify,
    render: async (id, source, theme) => {
      // Every render re-initialises: the theme follows the scheme, the security settings never change.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        theme: theme === "dark" ? "dark" : "neutral",
        fontFamily: "system-ui, sans-serif",
      });
      try {
        return (await mermaid.render(id, source)).svg;
      } finally {
        // A failed render leaves its error drawing (a bomb) in <body>.
        document.getElementById(`d${id}`)?.remove();
      }
    },
  }));
  return ready;
}

let counter = 0;

/**
 * Replaces every ```mermaid block under `root` with its diagram, and returns the function that
 * puts the blocks back (so a scheme change renders again from the source). A block that does not
 * parse stays as a code block with the reason after it.
 */
export function mountDiagrams(root: HTMLElement, theme: Scheme): () => void {
  const blocks = [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")].flatMap((code) => (code.parentElement ? [code.parentElement] : []));
  if (blocks.length === 0) return () => undefined;
  const added: Element[] = [];
  const abort = new AbortController();
  // A function, so the checks after each await are not narrowed to the value they had before it.
  const stale = (): boolean => abort.signal.aborted;
  void (async () => {
    const { render, purify } = await load();
    for (const pre of blocks) {
      if (stale()) return;
      const note = (el: Element): void => { added.push(el); pre.after(el); };
      try {
        counter += 1;
        const svg = purify.sanitize(await render(`mermaid-${String(counter)}`, pre.textContent, theme), {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject", "image", "script"],
          RETURN_DOM_FRAGMENT: true,
        });
        if (stale()) return;
        const figure = document.createElement("figure");
        figure.append(svg);
        const el = figure.querySelector("svg");
        // Natural size, so a wide diagram scrolls inside its figure instead of shrinking past reading.
        const width = el?.viewBox.baseVal.width;
        if (el && width) { el.setAttribute("width", String(width)); el.style.maxWidth = "none"; }
        pre.hidden = true;
        note(figure);
      } catch (error) {
        if (stale()) return;
        const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
        const p = document.createElement("p");
        p.setAttribute("role", "note");
        p.textContent = `Diagram couldn't render: ${reason}`;
        note(p);
      }
    }
  })();
  return () => {
    abort.abort();
    for (const el of added) el.remove();
    for (const pre of blocks) pre.hidden = false;
  };
}
