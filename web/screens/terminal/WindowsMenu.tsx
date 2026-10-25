// The desktop's window switcher (browser-behaviors.md "Window switcher"): a windows button in
// the active tab's pill, shown on every session, opening a menu under the pill with the same
// rows as the phone's switcher and "New window". It is a popover of the top layer, so the
// strip's clipping can't cut it, positioned from the button on opening and kept inside the window. Escape or a press
// outside closes it; Escape and a choice return focus to the terminal.
import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { IconButton } from "../../ui/primitives/IconButton";
import type { Tab } from "../../workspace/state";
import { WindowChoices } from "../switcher/WindowChoices";
import { terminalsOf } from "./terminals";
import styles from "./WindowsMenu.module.css";

/** Space between the pill and its menu, and between the menu and the window's edge. */
const GAP_PX = 4;
const EDGE_PX = 8;

export function WindowsMenu({ tab }: { tab: Tab }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  /** The windows button, noted when it is pressed: the menu opens under it, and the creation form returns focus to it. */
  const button = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  // A touch screen with a desktop layout (an iPad) keeps its keyboard: a press here never takes the focus.
  const touch = app.snapshot.viewport.density === "touch";

  const close = (toTerminal: boolean): void => {
    setOpen(false);
    if (toTerminal) app.focus.focusTarget("terminal");
  };

  // Opening: a fresh listing, the popover in the top layer under the button, and the first row focused.
  useEffect(() => {
    const el = panel.current;
    const anchor = button.current;
    if (!open || !el || !anchor) return;
    const handle = app.hosts.byHostId(tab.key.host)?.entry.handle;
    if (handle !== undefined) app.listing.refresh(handle);
    const rect = anchor.getBoundingClientRect();
    const top = rect.bottom + GAP_PX;
    el.style.top = `${String(top)}px`;
    // Many windows on a short viewport scroll inside the menu; "New window" stays reachable.
    el.style.maxHeight = `${String(document.documentElement.clientHeight - top - EDGE_PX)}px`;
    el.showPopover();
    // Under the button, its right edges aligned, but a pill near the left edge would push the menu off it.
    const room = document.documentElement.clientWidth - el.offsetWidth - EDGE_PX;
    el.style.left = `${String(Math.max(EDGE_PX, Math.min(rect.right - el.offsetWidth, room)))}px`;
    if (!touch) {
      const first = el.querySelector<HTMLElement>("[data-roving]");
      if (first) app.focus.focusElement(first);
    }
    const outside = (e: PointerEvent): void => {
      if (e.target instanceof Node && !el.contains(e.target) && !anchor.contains(e.target)) setOpen(false);
    };
    // The strip scrolling or the window resizing moves the pill away from where the menu was placed.
    const away = (): void => { setOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    addEventListener("resize", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      removeEventListener("resize", away);
      el.hidePopover();
    };
  }, [open]);

  return (
    <>
      <IconButton
        icon="chevronDown"
        label={`Windows in ${tab.session}`}
        class={styles.button}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          button.current = e.currentTarget;
          setOpen(!open);
        }}
      />
      <div
        ref={(el) => { if (el) el.popover = "manual"; panel.current = el; }}
        class={styles.menu}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          close(true);
        }}
      >
        {open && (
          <WindowChoices
            tab={tab}
            variant="menu"
            onChoose={(window) => {
              terminals.selectWindow(tab.id, window);
              close(true);
            }}
            onShown={() => { close(true); }}
            onNew={() => {
              close(false);
              app.openOverlay({ screen: "home", name: "newWindow", params: { handle: app.hosts.byHostId(tab.key.host)?.entry.handle, tab: tab.id, sessionName: tab.session } }, button.current ?? undefined);
            }}
          />
        )}
      </div>
    </>
  );
}
