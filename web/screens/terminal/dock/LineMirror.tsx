import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { DockButton } from "../../../ui/primitives/DockButton";
import type { TextRange } from "../../../platform/types";
import styles from "./LineMirror.module.css";

interface LineMirrorProps {
  label: string;
  placeholder: string;
  value: string;
  selection: TextRange;
  marked: TextRange | null;
  /** The line owns the keyboard: the ring and the caret show. Idle, the box shows its draft or placeholder and no caret. */
  active: boolean;
  disabled: boolean;
  onCaret: (index: number) => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

const HOLD_MS = 500;
const MOVE_PX = 9;

export function LineMirror({ label, placeholder, value, selection, marked, active, disabled, onCaret, onPaste, onSelectAll, onClear }: LineMirrorProps) {
  const field = useRef<HTMLDivElement>(null);
  const hold = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [menu, setMenu] = useState(false);

  useLayoutEffect(() => {
    const root = field.current;
    const caret = root?.querySelector<HTMLElement>("[data-caret]");
    if (!root || !caret) return;
    const rootBox = root.getBoundingClientRect();
    const caretBox = caret.getBoundingClientRect();
    if (caretBox.bottom > rootBox.bottom) root.scrollTop += caretBox.bottom - rootBox.bottom;
    else if (caretBox.top < rootBox.top) root.scrollTop -= rootBox.top - caretBox.top;
    if (caretBox.right > rootBox.right) root.scrollLeft += caretBox.right - rootBox.right;
    else if (caretBox.left < rootBox.left) root.scrollLeft -= rootBox.left - caretBox.left;
  }, [value, selection.start, selection.end, marked?.start, marked?.end]);

  const at = (x: number, y: number): number => {
    if (!value) return 0;
    const root = field.current;
    if (!root) return value.length;
    // WKWebView exposes caretRangeFromPoint on iOS 17; the newer caretPositionFromPoint is not
    // available across the supported WebKit range yet.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const position = root.ownerDocument.caretRangeFromPoint(x, y);
    if (!position || !root.contains(position.startContainer)) return value.length;
    const before = root.ownerDocument.createRange();
    before.selectNodeContents(root);
    before.setEnd(position.startContainer, position.startOffset);
    return Math.max(0, Math.min(before.toString().length, value.length));
  };

  const openMenu = (): void => {
    setMenu(true);
  };

  const cancelHold = (): void => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };

  const parts: Array<{ start: number; end: number; selected: boolean; composition: boolean }> = [];
  const cuts = new Set([0, value.length, selection.start, selection.end]);
  if (marked) { cuts.add(marked.start); cuts.add(marked.end); }
  const points = [...cuts].map((point) => Math.max(0, Math.min(value.length, point))).sort((a, b) => a - b);
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i] ?? 0;
    const end = points[i + 1] ?? start;
    if (end === start) continue;
    parts.push({
      start,
      end,
      selected: selection.start < selection.end && start < selection.end && end > selection.start,
      composition: marked !== null && marked.start < end && marked.end > start,
    });
  }

  return (
    <div class={styles.wrap}>
      <div
        ref={field}
        class={styles.field}
        role="textbox"
        aria-label={label}
        aria-multiline="false"
        aria-readonly="true"
        aria-disabled={disabled ? "true" : undefined}
        data-disabled={disabled ? "" : undefined}
        data-active={active ? "" : undefined}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          setMenu(false);
          const index = at(event.clientX, event.clientY);
          onCaret(index);
          cancelHold();
          const state = { x: event.clientX, y: event.clientY, timer: setTimeout(openMenu, HOLD_MS) };
          hold.current = state;
        }}
        onPointerMove={(event) => {
          const state = hold.current;
          if (!state || Math.hypot(event.clientX - state.x, event.clientY - state.y) < MOVE_PX) return;
          clearTimeout(state.timer);
          hold.current = null;
        }}
        onPointerUp={() => { cancelHold(); }}
        onPointerCancel={cancelHold}
        onContextMenu={(event) => {
          event.preventDefault();
          if (disabled) return;
          onCaret(at(event.clientX, event.clientY));
          openMenu();
        }}
      >
        {value.length === 0 ? (
          <>
            {active && selection.start === 0 && selection.end === 0 && <span class={styles.caret} data-caret="" aria-hidden="true" />}
            <span class={styles.placeholder}>{placeholder}</span>
          </>
        ) : parts.map((part) => (
          <span key={`${String(part.start)}:${String(part.end)}`} class={part.selected ? styles.selected : undefined} data-composition={part.composition ? "" : undefined}>
            {active && selection.start === selection.end && selection.start === part.start && <span class={styles.caret} data-caret="" aria-hidden="true" />}
            {value.slice(part.start, part.end)}
            {active && selection.start === selection.end && selection.start === part.end && part.end === value.length && <span class={styles.caret} data-caret="" aria-hidden="true" />}
          </span>
        ))}
        {menu && (
          <div class={styles.menu} role="menu" aria-label="Line editing" onPointerDown={(event) => { event.stopPropagation(); }}>
            <DockButton kind="control" role="menuitem" onClick={() => { setMenu(false); onPaste(); }}>Paste</DockButton>
            <DockButton kind="control" role="menuitem" onClick={() => { setMenu(false); onSelectAll(); }}>Select all</DockButton>
            <DockButton kind="control" role="menuitem" onClick={() => { setMenu(false); onClear(); }}>Clear</DockButton>
          </div>
        )}
      </div>
    </div>
  );
}
