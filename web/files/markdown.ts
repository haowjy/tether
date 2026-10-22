// The Markdown viewer's renderer: markdown-it, then DOMPurify, both loaded on first use.
// A document is untrusted (plan.md "Security"): no script, no styles, nothing focusable,
// and nothing fetched from outside the host's /fs/raw.
import { rawPathOf } from "./api";

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

/** Tags a document may not carry: script and styles, focusable controls, frames, media. */
const FORBID_TAGS = ["style", "link", "form", "input", "button", "textarea", "select", "option", "iframe", "frame", "object", "embed", "video", "audio", "source", "track", "picture", "dialog"];
const FORBID_ATTR = ["style", "class", "id", "tabindex", "contenteditable", "srcset", "autofocus", "draggable"];

/**
 * Markdown text → sanitized HTML. Images keep their resolved URL in `data-src` and load
 * as they scroll into view (images.ts); one from anywhere else loses its source.
 */
export async function renderMarkdown(text: string, docUrl: string): Promise<string> {
  const [{ default: MarkdownIt }, { default: DOMPurify }] = await Promise.all([import("markdown-it"), import("dompurify")]);
  const md = new MarkdownIt({ html: true, linkify: true });
  const purify = DOMPurify();
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "IMG") {
      const src = node.getAttribute("src");
      node.removeAttribute("src");
      const resolved = src ? imageSource(src, docUrl) : null;
      if (resolved) node.setAttribute("data-src", resolved);
      else node.setAttribute("class", "md-blocked");
    }
  });
  return purify.sanitize(md.render(text), { FORBID_TAGS, FORBID_ATTR, ALLOW_DATA_ATTR: false });
}
