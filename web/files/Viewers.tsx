import { useEffect, useRef, useState } from "preact/hooks";
import { Tappable } from "../ui/Tappable";
import { Play } from "../ui/icons";
import { HttpRefusal } from "../net/http";
import type { FsApi, TextPreview } from "./api";
import type { FileRef } from "./browser";
import { HIGHLIGHT_MAX, highlightedLines, plainLines } from "./code";
import { lazyImages, loadImage } from "./images";
import { languageFor, viewerFor } from "./kinds";
import { linkTarget, renderMarkdown, type LinkTarget } from "./markdown";

/** The code and Markdown viewers read at most this much, with Range (fs.md "Text previews"). */
const TEXT_LIMIT = 1024 * 1024;

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n < 10 ? n.toFixed(1) : String(Math.round(n))} ${units[unit] ?? "TB"}`;
}

export function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

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

function Truncated({ preview }: { preview: TextPreview }) {
  if (!preview.truncated) return null;
  const of = preview.size !== null ? ` of ${formatSize(preview.size)}` : "";
  return <div class="viewer-note">Showing the first {formatSize(TEXT_LIMIT)}{of}. Open it in the terminal for the rest.</div>;
}

function Failed({ error, describe }: { error: HttpRefusal; describe: (e: HttpRefusal) => string }) {
  return <div class="viewer-note viewer-error" role="alert">{describe(error)}</div>;
}

/** Source and text, coloured by Shiki when the extension is on the allowlist and the file is small. */
function CodeViewer({ api, file, wrap, plain, describe }: { api: FsApi; file: FileRef; wrap: boolean; plain: boolean; describe: (e: HttpRefusal) => string }) {
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
  if (text.kind === "loading") return <div class="loading">Loading…</div>;
  if (text.kind === "error") return <Failed error={text.error} describe={describe} />;
  return (
    <div class="viewer viewer-select">
      <Truncated preview={text.value} />
      {text.value.text === "" && <div class="viewer-note">Empty file.</div>}
      <pre class={`code${wrap ? " code-wrap" : ""}`}><code ref={ref} /></pre>
    </div>
  );
}

/** Rendered Markdown. Links to files open here; links to the web leave the app. */
function MarkdownViewer({ api, file, onLink, describe }: { api: FsApi; file: FileRef; onLink: (target: LinkTarget) => void; describe: (e: HttpRefusal) => string }) {
  const text = useText(api, file.path);
  const [html, setHtml] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const docUrl = api.rawUrl(file.path);
  useEffect(() => {
    if (text.kind !== "done") return undefined;
    let live = true;
    void renderMarkdown(text.value.text, docUrl).then((out) => { if (live) setHtml(out); });
    return () => { live = false; };
  }, [text, docUrl]);
  useEffect(() => (html !== null && article.current ? lazyImages(article.current, scroller.current) : undefined), [html]);
  if (text.kind === "error") return <Failed error={text.error} describe={describe} />;
  if (text.kind === "loading" || html === null) return <div class="loading">Loading…</div>;
  const linkOf = (target: EventTarget | null): HTMLAnchorElement | null => (target instanceof Element ? target.closest("a") : null);
  return (
    <div
      ref={scroller}
      class="viewer viewer-select"
      // A link must not take focus (native owns it) or navigate the page.
      onPointerDown={(e) => { if (linkOf(e.target)) e.preventDefault(); }}
      onClick={(e) => {
        const a = linkOf(e.target);
        if (!a) return;
        e.preventDefault();
        onLink(linkTarget(a.getAttribute("href") ?? "", docUrl));
      }}
    >
      <Truncated preview={text.value} />
      <article ref={article} class="md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_MS = 300;

/** One image, fitted to the sheet; pinch or wheel to zoom, drag to pan, double-tap to toggle zoom. */
function ImageViewer({ url, name }: { url: string; name: string }) {
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "shown" | "failed">("loading");
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const el = img.current;
    if (!el) return undefined;
    setState("loading");
    const shown = (): void => { setState("shown"); };
    const failed = (): void => { setState("failed"); };
    el.addEventListener("load", shown);
    el.addEventListener("error", failed);
    const cancel = loadImage(el, url);
    return () => {
      cancel();
      el.removeEventListener("load", shown);
      el.removeEventListener("error", failed);
    };
  }, [url]);

  const apply = (): void => {
    const el = img.current;
    const frame = box.current;
    if (!el || !frame) return;
    const v = view.current;
    // Keep the image covering the frame: no panning past its edges.
    v.x = Math.min(0, Math.max(frame.clientWidth * (1 - v.scale), v.x));
    v.y = Math.min(0, Math.max(frame.clientHeight * (1 - v.scale), v.y));
    el.style.transform = `translate(${String(v.x)}px, ${String(v.y)}px) scale(${String(v.scale)})`;
  };
  /** Zooms to `scale` keeping the point (px, py) of the frame still. */
  const zoomAt = (scale: number, px: number, py: number): void => {
    const v = view.current;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    v.x = px - ((px - v.x) * next) / v.scale;
    v.y = py - ((py - v.y) * next) / v.scale;
    v.scale = next;
    apply();
  };
  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = box.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  const spread = (): { dist: number; mid: { x: number; y: number } } | null => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  return (
    <div
      ref={box}
      class="viewer viewer-image"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, local(e));
        const s = spread();
        gesture.current = s ? { dist: s.dist, scale: view.current.scale } : null;
      }}
      onPointerMove={(e) => {
        const before = pointers.current.get(e.pointerId);
        if (!before) return;
        const now = local(e);
        pointers.current.set(e.pointerId, now);
        const s = spread();
        if (s && gesture.current) zoomAt((gesture.current.scale * s.dist) / Math.max(1, gesture.current.dist), s.mid.x, s.mid.y);
        else if (pointers.current.size === 1 && view.current.scale > 1) {
          view.current.x += now.x - before.x;
          view.current.y += now.y - before.y;
          apply();
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        gesture.current = null;
        if (pointers.current.size > 0) return;
        const at = local(e);
        if (e.timeStamp - lastTap.current < DOUBLE_TAP_MS) {
          zoomAt(view.current.scale > 1 ? 1 : 2.5, at.x, at.y);
          lastTap.current = 0;
        } else {
          lastTap.current = e.timeStamp;
        }
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        gesture.current = null;
      }}
      onWheel={(e) => {
        e.preventDefault();
        const at = local(e);
        zoomAt(view.current.scale * Math.exp(-e.deltaY / 300), at.x, at.y);
      }}
    >
      <img ref={img} alt={name} draggable={false} class={state === "shown" ? "" : "image-pending"} />
      {state === "loading" && <div class="loading image-status">Loading…</div>}
      {state === "failed" && <div class="viewer-note image-status">This image can't be shown here.</div>}
    </div>
  );
}

function Meta({ file }: { file: FileRef }) {
  return (
    <dl class="meta">
      <dt>Path</dt><dd class="mono">{file.path}</dd>
      {file.size !== null && <><dt>Size</dt><dd>{formatSize(file.size)}</dd></>}
      {file.mtime !== null && <><dt>Modified</dt><dd>{formatTime(file.mtime)}</dd></>}
      {file.mime && <><dt>Type</dt><dd class="mono">{file.mime}</dd></>}
    </dl>
  );
}

/** Video and audio: native's player opens on arrival, and again from Play. */
function MediaViewer({ file, onPlay }: { file: FileRef; onPlay: () => void }) {
  const play = useRef(onPlay);
  play.current = onPlay;
  useEffect(() => { play.current(); }, [file.path]);
  return (
    <div class="viewer">
      <Meta file={file} />
      <div class="viewer-actions">
        <Tappable class="action action-primary" label={`Play ${file.name}`} onTap={onPlay}><Play /> Play</Tappable>
      </div>
    </div>
  );
}

function BinaryViewer({ file, onText }: { file: FileRef; onText: () => void }) {
  return (
    <div class="viewer">
      <Meta file={file} />
      <div class="viewer-actions">
        <Tappable class="action" label="Open as text" onTap={onText}>Open as text</Tappable>
      </div>
    </div>
  );
}

export interface ViewerProps {
  api: FsApi;
  file: FileRef;
  wrap: boolean;
  onLink: (target: LinkTarget) => void;
  onPlay: (path: string) => void;
  describe: (error: HttpRefusal) => string;
}

/** The viewer for a file's type (plan.md "Viewers"). Keyed by path: each file starts fresh. */
export function FileViewer({ api, file, wrap, onLink, onPlay, describe }: ViewerProps) {
  const [asText, setAsText] = useState(false);
  const kind = asText ? "code" : viewerFor(file.mime);
  switch (kind) {
    case "code":
      return <CodeViewer api={api} file={file} wrap={wrap} plain={asText} describe={describe} />;
    case "markdown":
      return <MarkdownViewer api={api} file={file} onLink={onLink} describe={describe} />;
    case "image":
      return <ImageViewer url={api.rawUrl(file.path)} name={file.name} />;
    case "media":
      return <MediaViewer file={file} onPlay={() => { onPlay(file.path); }} />;
    case "binary":
      return <BinaryViewer file={file} onText={() => { setAsText(true); }} />;
  }
}
