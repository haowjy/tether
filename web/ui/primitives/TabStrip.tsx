import { useEffect, useRef, useState } from "preact/hooks";
import { cx } from "../cx";
import { IconButton } from "./IconButton";
import styles from "./TabStrip.module.css";

/** How a pill's label is coloured: connection state, never selection. */
export type PillTone = "live" | "reconnecting" | "error" | "gone" | "idle";

export interface Pill {
  id: string;
  session: string;
  /** The window part, always shown before the session part. */
  window: string;
  /** The tooltip and the accessible name. */
  full: string;
  tone: PillTone;
  /** The connection state in words, so colour is never the only signal. */
  state: string;
}

interface TabStripProps {
  pills: Pill[];
  active: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * The terminal's tabs: buttons marked with `aria-current`, a separate close button on the
 * active pill only, horizontal scroll with the active pill scrolled into view and a fade
 * mask at an overflowing edge. Not an ARIA `tablist`: the pills carry their own close
 * buttons and share one panel. Selection is fill and weight; the connection colour is on the label.
 */
export function TabStrip({ pills, active, onSelect, onClose }: TabStripProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = (): void => {
    const el = scroller.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  };

  useEffect(() => {
    scroller.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ inline: "nearest", block: "nearest" });
    measure();
  }, [active, pills.length]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, []);

  return (
    <div ref={scroller} class={styles.strip} data-start={edges.start || undefined} data-end={edges.end || undefined} onScroll={measure}>
      {pills.map((pill) => {
        const isActive = pill.id === active;
        return (
          <div key={pill.id} class={cx(styles.pill, isActive && styles.active)} data-tone={pill.tone}>
            <button
              type="button"
              class={styles.select}
              aria-current={isActive ? "true" : undefined}
              aria-label={`${pill.full}, ${pill.state}`}
              title={pill.full}
              onClick={() => { onSelect(pill.id); }}
            >
              <span class={styles.session}>{pill.session}</span>
              <span class={styles.window}>/ {pill.window}</span>
            </button>
            {isActive && <IconButton icon="close" label={`Close ${pill.full}`} class={styles.close} onClick={() => { onClose(pill.id); }} />}
          </div>
        );
      })}
    </div>
  );
}
