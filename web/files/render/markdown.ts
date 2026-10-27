// The Markdown viewer's renderer: markdown-it, then DOMPurify, both loaded on first use.
// A document is untrusted (plan.md "Security"): no script, no styles, nothing focusable,
// and nothing fetched from outside the host's /fs/raw.
import { rawPathOf } from "../api";

/** What a link in a document leads to. */
export type LinkTarget = { kind: "path"; path: string } | { kind: "external"; url: string } | { kind: "none" };

/**
 * Resolves `href` against the document's own raw URL (fs.md "Paths ride in the URL path"):
 * a relative link is a file on the same host, `http`, `https` and `mailto` leave the app,
 * and anything else (a fragment, `javascript:`, another scheme) goes nowhere.
 */
export function linkTarget(href: string, docUrl: string): LinkTarget {
  let url: URL;
  try {
    url = new URL(href, docUrl);
  } catch {
    return { kind: "none" };
  }
  const doc = new URL(docUrl);
  // Not `origin`: it is "null" for a custom scheme such as tether-app:.
  if (url.protocol !== doc.protocol || url.host !== doc.host) {
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:" ? { kind: "external", url: url.href } : { kind: "none" };
  }
  const path = rawPathOf(url.pathname);
  if (path === null) return { kind: "none" };
  // A link to a heading in the same document has nowhere to go: headings carry no ids.
  if (path === rawPathOf(doc.pathname)) return { kind: "none" };
  return { kind: "path", path };
}

/** An image's URL if it is a file on the same host, else null: nothing loads from the internet. */
export function imageSource(src: string, docUrl: string): string | null {
  const target = linkTarget(src, docUrl);
  if (target.kind !== "path") return null;
  const url = new URL(src, docUrl);
  url.hash = "";
  return url.href;
}

/**
 * What a document may carry: prose, lists, tables, code, links and images. An allowlist,
 * because HTML keeps growing navigating and fetching elements (`area`, `svg` `image`, `details`
 * is focusable); nothing outside it survives, whatever the browser adds next.
 */
const ALLOWED_TAGS = [
  "p", "br", "hr", "div", "span", "blockquote", "pre", "code", "kbd", "mark", "em", "strong", "b", "i", "s", "del", "ins", "sub", "sup", "small",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "a", "img",
];
/** `src` stays only until the image hook below turns it into `data-src`. */
const ALLOWED_ATTR = ["href", "src", "alt", "title", "width", "height", "colspan", "rowspan", "align", "start"];

/**
 * Markdown text → sanitized HTML. Images keep their resolved URL in `data-src` and load
 * as they scroll into view (images.ts); one from anywhere else loses its source.
 */
export async function renderMarkdown(text: string, docUrl: string): Promise<string> {
  const [{ default: MarkdownIt }, { default: DOMPurify }] = await Promise.all([import("markdown-it"), import("dompurify")]);
  const md = new MarkdownIt({ html: true, linkify: true });
  const purify = DOMPurify();
  // A ```mermaid fence's class is the one a document keeps: mermaid.ts finds the block by it.
  purify.addHook("uponSanitizeAttribute", (node, data) => {
    if (node.nodeName === "CODE" && data.attrName === "class" && data.attrValue === "language-mermaid") data.forceKeepAttr = true;
  });
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "IMG") {
      const src = node.getAttribute("src");
      node.removeAttribute("src");
      const resolved = src ? imageSource(src, docUrl) : null;
      if (resolved) node.setAttribute("data-src", resolved);
      else node.setAttribute("class", "md-blocked");
    }
  });
  return purify.sanitize(md.render(text), { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false });
}
