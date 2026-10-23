import { useEffect, useRef, useState } from "preact/hooks";
import type { FsApi, TextPreview } from "../../files/api";
import type { FileRef } from "../../files/browser";
import { HIGHLIGHT_MAX, highlightedLines, plainLines } from "../../files/render/code";
import { linkTarget, renderMarkdown, type LinkTarget } from "../../files/render/markdown";
import { lazyImages } from "../../files/images";
import { formatSize } from "../../files/format";
import { languageFor } from "../../files/kinds";
import { HttpRefusal } from "../../net/http";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Spinner } from "../../ui/primitives/Spinner";
import { cx } from "../../ui/cx";
import styles from "./Viewers.module.css";

/** The code and Markdown viewers read at most this much, with Range (fs.md "Text previews"). */
const TEXT_LIMIT = 1024 * 1024;

type Loaded<T> = { kind: "loading" } | { kind: "done"; value: T } | { kind: "error"; error: HttpRefusal };

/** A file's first MiB as text, fetched once per path and abandoned when the viewer closes. */
function useText(api: FsApi, path: string): Loaded<TextPreview> {
  const [state, setState] = useState<Loaded<TextPreview>>({ kind: "loading" });
  useEffect(() => {
    const abort = new AbortController();
    setState({ kind: "loading" });
    api.text(path, TEXT_LIMIT, abort.signal).then(
      (value) => { setState({ kind: "done", value }); },
      (error: unknown) => { if (!abort.signal.aborted) setState({ kind: "error", error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") }); },
    );
    return () => { abort.abort(); };
  }, [api, path]);
  return state;
}

function Loading({ what }: { what: string }) {
  return <div class={styles.loading}><Spinner label={what} /><p>{what}</p></div>;
}

function Failed({ error, describe }: { error: HttpRefusal; describe: (e: HttpRefusal) => string }) {
  return <EmptyState icon="alert" title="Can't show this file">{describe(error)}</EmptyState>;
}

function Truncated({ preview }: { preview: TextPreview }) {
  if (!preview.truncated) return null;
  const of = preview.size !== null ? ` of ${formatSize(preview.size)}` : "";
  return <p class={styles.note}>Showing the first {formatSize(TEXT_LIMIT)}{of}. Open it in the terminal for the rest.</p>;
}

/** Source and text, coloured by Shiki when the extension is on the allowlist and the file is small. */
export function CodeViewer({ api, file, wrap, plain, describe }: { api: FsApi; file: FileRef; wrap: boolean; plain: boolean; describe: (e: HttpRefusal) => string }) {
  const text = useText(api, file.path);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const code = ref.current;
    if (!code || text.kind !== "done") return undefined;
    const source = text.value.text;
    code.replaceChildren(plainLines(source));
    const lang = plain ? null : languageFor(file.name);
    if (!lang || source.length > HIGHLIGHT_MAX) return undefined;
    let live = true;
    void highlightedLines(source, lang).then((lines) => { if (live && lines) code.replaceChildren(lines); });
    return () => { live = false; };
  }, [text, file.name, plain]);
  if (text.kind === "loading") return <Loading what="Loading the file" />;
  if (text.kind === "error") return <Failed error={text.error} describe={describe} />;
  return (
    <div class={styles.text}>
      <Truncated preview={text.value} />
      {text.value.text === "" && <p class={styles.note}>This file is empty.</p>}
      <pre class={cx(styles.code, wrap && styles.wrap)} tabIndex={0} aria-label={`Contents of ${file.name}`}><code ref={ref} /></pre>
    </div>
  );
}

/** Rendered Markdown. Links to files open here; links to the web leave the app. */
export function MarkdownViewer({ api, file, onLink, describe }: { api: FsApi; file: FileRef; onLink: (target: LinkTarget) => void; describe: (e: HttpRefusal) => string }) {
  const text = useText(api, file.path);
  const [html, setHtml] = useState<string | null>(null);
  const article = useRef<HTMLElement>(null);
  const docUrl = new URL(api.rawUrl(file.path), location.href).href;
  useEffect(() => {
    if (text.kind !== "done") return undefined;
    let live = true;
    void renderMarkdown(text.value.text, docUrl).then((out) => { if (live) setHtml(out); });
    return () => { live = false; };
  }, [text, docUrl]);
  useEffect(() => (html !== null && article.current ? lazyImages(article.current, null) : undefined), [html]);
  if (text.kind === "error") return <Failed error={text.error} describe={describe} />;
  if (text.kind === "loading" || html === null) return <Loading what="Loading the document" />;
  return (
    <div
      class={styles.text}
      onClick={(e) => {
        const a = e.target instanceof Element ? e.target.closest("a") : null;
        if (!a) return;
        e.preventDefault();
        onLink(linkTarget(a.getAttribute("href") ?? "", docUrl));
      }}
    >
      <Truncated preview={text.value} />
      <article ref={article} class={styles.md} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
