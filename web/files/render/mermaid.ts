// Mermaid, the part of diagrams.ts that loads on the first diagram. A diagram's source is
// untrusted (plan.md "Rendered content is untrusted"). Three layers hold it:
//  - Mermaid runs in `strict` mode, from a reset configuration on every render: a document's
//    frontmatter or `%%{init}%%` can set any key not listed in `secure`, and a failed render
//    leaves the document's settings in Mermaid's shared config for the next one to inherit.
//  - The SVG it returns is sanitized again with DOMPurify's SVG profile.
//  - The page's CSP. Mermaid draws into a temporary element of <body> *before* this module
//    sanitizes, so a node's `img: "https://…"` is requested by the browser; the daemon's
//    `img-src` and the app's refuse it. Loosening the CSP opens that fetch.
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import type { Viewport } from "../../platform/types";

/** The only `url()` a diagram's styles may use is an in-document reference such as a marker. */
const EXTERNAL_URL = /url\(\s*(?!["']?#)[^)]*\)|@import[^;]*;?/giu;

const purify = DOMPurify();
purify.addHook("uponSanitizeElement", (node) => {
  if (node.nodeName.toLowerCase() === "style") node.textContent = (node.textContent ?? "").replace(EXTERNAL_URL, "");
});
purify.addHook("afterSanitizeAttributes", (node) => {
  // Only in-document fragments: no `use` or marker leads anywhere else.
  for (const name of ["href", "xlink:href"]) {
    const value = node.getAttribute(name);
    if (value !== null && !value.startsWith("#")) node.removeAttribute(name);
  }
});

let counter = 0;
/** Mermaid's configuration is global, so one render at a time owns it from reset to SVG. */
let turn: Promise<unknown> = Promise.resolve();

/** The sanitized SVG of one diagram, or a rejection with Mermaid's first line of reason. */
export function renderDiagram(source: string, scheme: Viewport["scheme"]): Promise<DocumentFragment> {
  const result = turn.then(() => draw(source, scheme));
  turn = result.catch(() => undefined);
  return result;
}

async function draw(source: string, scheme: Viewport["scheme"]): Promise<DocumentFragment> {
  counter += 1;
  const id = `mermaid-${String(counter)}`;
  // `reset` has no replacement on the public API.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  mermaid.mermaidAPI.reset();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // Labels in `foreignObject` would be removed below, leaving empty boxes. `layout`: ELK is not shipped.
    htmlLabels: false,
    layout: "dagre",
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "htmlLabels", "layout"],
    theme: scheme === "dark" ? "dark" : "neutral",
    fontFamily: "system-ui, sans-serif",
  });
  try {
    const { svg } = await mermaid.render(id, source);
    return purify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      // `a`: a diagram link is not followable here (the viewer reads `href`), only a dead tab stop.
      FORBID_TAGS: ["foreignObject", "image", "script", "a"],
      RETURN_DOM_FRAGMENT: true,
    });
  } finally {
    // A failed render leaves its error drawing (a bomb) in <body>.
    document.getElementById(`d${id}`)?.remove();
  }
}
