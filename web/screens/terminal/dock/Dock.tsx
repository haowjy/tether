// The phone dock (client-architecture.md §7.4), the bottom of Terminal on touch in the browser,
// the PWA and the app: at rest one row (tab chip, line field, keyboard toggle), with the key
// row above it while an input holds the keyboard. It rides on the keyboard but never resizes
// tmux: its slot is in flow in the keyboard-hidden layout, and the lifted row is translated
// out of the slot by `--keyboard-inset` (Dock.module.css).
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useApp, useAppView, useTabLabels } from "../../../app/context";
import { Icon } from "../../../ui/primitives/Icon";
import { DockButton } from "../../../ui/primitives/DockButton";
import { useStore } from "../../../ui/store";
import { terminalsOf } from "../terminals";
import { KeyRow } from "./KeyRow";
import { LineField, type LocalNote } from "./LineField";
import { lineDraftsOf } from "./lineDrafts";
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

  const tab = workspace.tabs.find((t) => t.id === workspace.active) ?? null;
  const native = viewport.directInput === "native";
  const labels = useTabLabels();
  const label = labels.find((l) => l.id === tab?.id);
  const nativeNote = useStore(nativeLine, (state) => state.note);
  const note = useNote(native ? nativeNote : local, tab?.id ?? null);
  const holding = owner !== "none";
  const phone = viewport.layout === "phone";

  // A note belongs to the field it came from.
  useEffect(() => { setLocal(null); }, [tab?.id]);

  // The terminal pan ends above the dock and key row, even when native shrinks the web view.
  useLayoutEffect(() => {
    const strip = above.current;
    const resting = row.current;
    if (!active || !strip || !resting) {
      terminals.setPanArea(null);
      return;
    }
    const update = (): void => {
      const covered = strip.offsetHeight;
      const rowTop = resting.getBoundingClientRect().top;
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
    watch.observe(resting);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      terminals.setPanArea(null);
    };
  }, [active, viewport.keyboardInset, viewport.visibleHeight, terminals]);

  useLayoutEffect(() => {
    const resting = row.current;
    if (!phone || !active || !resting) return;
    const root = document.documentElement;
    const update = (): void => {
      const height = `${String(resting.getBoundingClientRect().height)}px`;
      if (root.style.getPropertyValue("--dock-row-height") !== height) root.style.setProperty("--dock-row-height", height);
    };
    update();
    let frame = 0;
    const scheduleUpdate = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const watch = new ResizeObserver(scheduleUpdate);
    watch.observe(resting);
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      root.style.removeProperty("--dock-row-height");
    };
  }, [active, phone]);

  // Keep key-row characters in the same editing path on both platforms.
  const insertIntoLine = (text: string): boolean => {
    if (owner !== "line") return false;
    if (viewport.directInput === "native") {
      app.platform.input.insertLine(text);
      return true;
    }
    const field = line.current;
    if (!field) return false;
    field.setRangeText(text, field.selectionStart, field.selectionEnd, "end");
    field.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  };

  return (
    <div class={styles.slot} data-keyboard={holding ? "" : undefined}>
      <div class={styles.lift}>
        <div class={styles.above} ref={above}>
          <p class={styles.note} data-tone={note?.tone} role="status">{note?.text}</p>
          {holding && <KeyRow insertIntoLine={insertIntoLine} />}
        </div>
        <div class={styles.row} ref={row}>
          {phone && (
            <DockButton
              kind="control"
              class={styles.chip}
              aria-label={tab && label ? `${label.full}, ${String(workspace.tabs.length)} ${workspace.tabs.length === 1 ? "tab" : "tabs"}, open sessions` : undefined}
              onClick={(e) => { app.openOverlay({ screen: "switcher", name: "sessions" }, e.currentTarget); }}
            >
              {tab && label ? (
                <>
                  <span class={styles.chipSession}>{label.session}</span>
                  <span class={styles.chipWindow}>{label.window}</span>
                  <span class={styles.chipCount}>{workspace.tabs.length}</span>
                </>
              ) : (
                "Sessions"
              )}
            </DockButton>
          )}
          <LineField tab={tab} label={label ? `Line for ${label.full}` : "Line"} onNote={setLocal} inputRef={line} />
          <DockButton
            kind="control"
            class={styles.toggle}
            aria-label={holding ? "Hide keyboard" : "Show keyboard"}
            disabled={!tab && !holding}
            onClick={() => { app.focus.toggleKeyboard(); }}
          >
            <Icon name={holding ? "keyboardHide" : "keyboard"} size={20} />
          </DockButton>
        </div>
      </div>
    </div>
  );
}
