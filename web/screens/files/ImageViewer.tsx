import { useEffect, useRef, useState } from "preact/hooks";
import { loadImage } from "../../files/images";
import styles from "./Viewers.module.css";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_TAP_MS = 300;

/** One image, fitted to the frame; pinch or wheel to zoom, drag to pan, double-tap to toggle zoom. */
export function ImageViewer({ url, name }: { url: string; name: string }) {
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
      class={styles.image}
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
      <img ref={img} alt={name} draggable={false} class={state === "shown" ? styles.shown : styles.pending} />
      {state === "loading" && <div class={styles.status}><p>Loading the image</p></div>}
      {state === "failed" && <div class={styles.status}><p>This image can't be shown here.</p></div>}
    </div>
  );
}
