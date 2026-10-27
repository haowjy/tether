// The phone dock (client-architecture.md §7.4), the bottom of Terminal on touch in the browser,
// the PWA and the app. It is one of two things, from who holds the keyboard: resting (the
// current-tab button and Show keyboard) or typing (the key row and Hide keyboard, with the compose
// box above). It rides on the keyboard but never resizes tmux: the row is the same height in both
// and in flow in the keyboard-hidden layout, and the lifted dock is translated out of the slot by
// `--keyboard-inset` (Dock.module.css).
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView, useTabLabels } from "../../../app/context";
import { Icon } from "../../../ui/primitives/Icon";
import { DockButton } from "../../../ui/primitives/DockButton";
import { useStore } from "../../../ui/store";
import { terminalTabOf } from "../../../workspace/state";
import { terminalsOf } from "../terminals";
import { CurrentTabButton } from "./CurrentTabButton";
import { KeyRow, type LineEditor } from "./KeyRow";
import { LineField, type LocalNote } from "./LineField";
import { lineDraftsOf } from "./lineDrafts";
import { stepGrapheme } from "./caret";
import { nativeLineOf } from "./nativeLine";
import styles from "./Dock.module.css";

/** A line unanswered this long shows "Sending…". */
const SLOW_SEND_MS = 2_000;

/** What the strip above the row says, from the field's own marks. */
function useNote(local: LocalNote | null, tabId: string | null): LocalNote | null {
  const app = useApp();
  const drafts = lineDraftsOf(app);
  const draft = useStore(drafts, (s) => (tabId ? s.drafts[tabId] : undefined));
  const pending = useStore(drafts, (s) => Object.values(s.pending).find((p) => p.id === tabId)?.at ?? null);
  const storageClosed = useAppView((v) => v.storageClosed);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (pending === null) return;
    const timer = setTimeout(() => { setSlow(true); }, Math.max(0, pending + SLOW_SEND_MS - Date.now()));
    return () => { clearTimeout(timer); };
  }, [pending]);

  if (local) return local;
  const note = draft?.note;
  if (note?.kind === "notSent") return { tone: "error", text: `Not sent: ${note.message}` };
  if (note?.kind === "maybeSent") return { tone: "error", text: `May not have been sent: ${note.message}` };
  if (note?.kind === "editedElsewhere") return { tone: "info", text: "Edited in another window" };
  if (slow) return { tone: "info", text: "Sending…" };
  if (storageClosed && draft?.text) return { tone: "info", text: "New drafts won't survive a reload: reload to finish updating" };
  return null;
}

export function Dock({ active }: { active: boolean }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const nativeLine = nativeLineOf(app);
  const workspace = useAppView((v) => v.workspace);
  const viewport = useAppView((v) => v.viewport);
  const owner = useStore(app.focus, (s) => s.owner);

  const above = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLTextAreaElement>(null);
  const [local, setLocal] = useState<LocalNote | null>(null);

  const tab = terminalTabOf(workspace, workspace.active);
  const native = viewport.directInput === "native";
  const labels = useTabLabels();
  const label = labels.find((l) => l.id === tab?.id);
  const nativeNote = useStore(nativeLine, (state) => state.note);
  const note = useNote(native ? nativeNote : local, tab?.id ?? null);
  const phone = viewport.layout === "phone";
  // The one derived value: no input holds the keyboard (resting), or one does (typing).
  const typing = owner !== "none";

  // A note belongs to the field it came from.
  useEffect(() => { setLocal(null); }, [tab?.id]);

  // The terminal pan ends above the compose box and key row, even when native shrinks the web view.
  useLayoutEffect(() => {
    const strip = above.current;
    const bar = row.current;
    if (!active || !strip || !bar) {
      terminals.setPanArea(null);
      return;
    }
    const root = document.documentElement;
    const update = (): void => {
      const covered = strip.offsetHeight;
      const rowTop = bar.getBoundingClientRect().top;
      root.style.setProperty("--dock-above-height", `${String(covered)}px`);
      // The row's own box already includes the CSS lift (--keyboard-inset), set before this render.
      if (covered === 0 && viewport.keyboardInset === 0) {
        terminals.setPanArea(null);
        return;
      }
      terminals.setPanArea(Math.max(0, rowTop - covered - terminals.element.getBoundingClientRect().top));
    };
    update();
    // Defer layout writes until after ResizeObserver delivery. Growing the line changes this
    // row's height; changing the terminal pan in that same delivery can otherwise trip the
    // browser's resize-loop guard while both boxes are being laid out.
    let frame = 0;
    const scheduleUpdate = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const watch = new ResizeObserver(scheduleUpdate);
    watch.observe(strip);
    watch.observe(bar);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      root.style.removeProperty("--dock-above-height");
      terminals.setPanArea(null);
    };
  }, [active, viewport.keyboardInset, viewport.visibleHeight, terminals]);

  // One editing path for the key row on both platforms. Native owns its text and caret, so a step is
  // its own to take (UIKit's positions, marked text included); the browser's textarea steps by grapheme.
  const editor: LineEditor = {
    insert: (text) => {
      if (native) {
        app.platform.input.insertLine(text);
        return;
      }
      const field = line.current;
      if (!field) return;
      field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    },
    step: (step) => {
      if (native) {
        app.platform.input.stepLineCaret(step);
        return;
      }
      const field = line.current;
      if (!field) return;
      const { selectionStart: start, selectionEnd: end, value } = field;
      const to = start !== end ? (step < 0 ? start : end) : stepGrapheme(value, start, step);
      field.setSelectionRange(to, to);
    },
  };

  return (
    <div class={styles.slot} data-keyboard={typing ? "" : undefined}>
      <div class={styles.lift}>
        <div class={styles.above} ref={above}>
          <p class={styles.note} data-tone={note?.tone} role="status">{note?.text}</p>
          {/* Mounted at rest too, so the draft and the field's refs outlive the keyboard; hidden, so nothing can focus it. */}
          <div class={styles.compose} hidden={!typing}>
            <LineField tab={tab} label={label ? `Line for ${label.full}` : "Line"} onNote={setLocal} inputRef={line} />
          </div>
        </div>
        <div class={styles.row} ref={row}>
          {typing ? <KeyRow editor={editor} /> : phone && <CurrentTabButton />}
          <DockButton
            kind="control"
            class={styles.toggle}
            aria-label={typing ? "Hide keyboard" : "Show keyboard"}
            disabled={!tab && !typing}
            onClick={() => { app.focus.toggleKeyboard(); }}
          >
            <Icon name={typing ? "keyboardHide" : "keyboard"} size={20} />
          </DockButton>
        </div>
      </div>
    </div>
  );
}
