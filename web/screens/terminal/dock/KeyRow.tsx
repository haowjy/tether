// The dock's key row (client-architecture.md §7.4): one fixed row of the keys a phone keyboard
// lacks, in a horizontal scroller. A tap never moves focus or lowers the keyboard (DockButton),
// and a key acts on `pointerup` inside it. Where a key goes (tmux, or the compose box that holds
// the keyboard) is `routeKey`'s decision, the same for both line editors; ctrl and alt arm the next key.
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { useApp, useAppView } from "../../../app/context";
import { DockButton } from "../../../ui/primitives/DockButton";
import { useStore } from "../../../ui/store";
import { routeKey, type RowKey } from "../../../touch/keyRoute";
import { terminalsOf } from "../terminals";
import styles from "./Dock.module.css";

/** `aria` is set only where the visible label can't be read aloud as the key (the arrows, the caret chords). */
type Spec =
  | { label: string; aria?: string; key: RowKey; repeat?: boolean }
  | { label: string; modifier: "ctrl" | "alt" };

const KEYS: Spec[] = [
  { label: "esc", key: { name: "Escape" } },
  { label: "←", aria: "Left arrow", key: { name: "Left" }, repeat: true },
  { label: "↑", aria: "Up arrow", key: { name: "Up" }, repeat: true },
  { label: "↓", aria: "Down arrow", key: { name: "Down" }, repeat: true },
  { label: "→", aria: "Right arrow", key: { name: "Right" }, repeat: true },
  { label: "⇧tab", aria: "Shift tab", key: { name: "BTab" } },
  { label: "tab", key: { name: "Tab" } },
  { label: "^C", aria: "Control C", key: { name: "C-c" } },
  { label: "^R", aria: "Control R", key: { name: "C-r" } },
  { label: "ctrl", modifier: "ctrl" },
  { label: "alt", modifier: "alt" },
  { label: "⏎", aria: "Return", key: { name: "Enter" } },
  { label: "|", key: { text: "|" } },
  { label: "~", key: { text: "~" } },
  { label: "/", key: { text: "/" } },
  { label: "-", key: { text: "-" } },
];

/** A held arrow repeats after this, then at this rate. */
const REPEAT_AFTER_MS = 400;
const REPEAT_EVERY_MS = 33;

/** What the compose box does for the keys routed to it. The editor that holds the text and caret decides how. */
export interface LineEditor {
  /** Insert a character at the caret. */
  insert: (text: string) => void;
  /** Move the caret one character. */
  step: (step: -1 | 1) => void;
}

export function KeyRow({ editor }: { editor: LineEditor }) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const { modifiers } = terminals;
  const armed = useStore(modifiers, (s) => s.armed);
  const owner = useStore(app.focus, (s) => s.owner);
  const native = useAppView((view) => view.viewport.directInput === "native");

  useLayoutEffect(() => {
    if (native && owner === "line") app.platform.input.setArmedModifier(armed);
  }, [app, armed, native, owner]);

  // Routed against the live owner and armed state, not this render's: a held key fires from the render it was pressed in.
  const send = (spec: Spec): void => {
    if ("modifier" in spec) {
      modifiers.toggle(spec.modifier);
      return;
    }
    const keyOwner = app.focus.snapshot.owner;
    if (keyOwner === "none") return;
    const route = modifiers.route(spec.key, keyOwner);
    switch (route.to) {
      case "terminal": break;
      case "caret": editor.step(route.step); break;
      case "focusTerminal": app.focus.focusTarget("terminal", true); break;
      case "line": editor.insert(route.text); break;
    }
  };

  if (owner === "none") return null; // the row is mounted only while typing

  return (
    <div class={styles.keys} role="group" aria-label="Terminal keys">
      {KEYS.map((spec) => (
        <Key
          key={spec.label}
          spec={spec}
          pressed={"modifier" in spec && armed === spec.modifier}
          // The two destinations look different: a key whose tap lands in the compose box rather than in tmux.
          acts={"key" in spec && routeKey(spec.key, owner, armed).route.to !== "terminal" ? "box" : undefined}
          onPress={() => { send(spec); }}
          onDown={() => { app.platform.haptic("modifier" in spec ? "modifier" : "key"); }}
        />
      ))}
    </div>
  );
}

interface KeyProps {
  spec: Spec;
  pressed: boolean;
  acts: "box" | undefined;
  onPress: () => void;
  onDown: () => void;
}

function Key({ spec, pressed, acts, onPress, onDown }: KeyProps) {
  // A ref: pressing ctrl re-renders its own key between the pointer going down and up.
  const hold = useRef<{ delay?: ReturnType<typeof setTimeout>; every?: ReturnType<typeof setInterval>; repeated: boolean } | null>(null);
  const stop = (): void => {
    clearTimeout(hold.current?.delay);
    clearInterval(hold.current?.every);
    hold.current = null;
  };
  // The row unmounts when the keyboard goes down, with no pointerup: a held arrow must not outlive it.
  useEffect(() => stop, []);
  const repeat = "repeat" in spec && (spec.repeat ?? false);
  return (
    <DockButton
      kind="key"
      pressed={pressed}
      aria-label={"aria" in spec ? spec.aria : undefined}
      data-acts={acts}
      aria-pressed={"modifier" in spec ? pressed : undefined}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
        stop();
        const state: NonNullable<typeof hold.current> = { repeated: false };
        hold.current = state;
        if (repeat) {
          state.delay = setTimeout(() => {
            state.repeated = true;
            onPress();
            state.every = setInterval(onPress, REPEAT_EVERY_MS);
          }, REPEAT_AFTER_MS);
        }
      }}
      onPointerUp={(e) => {
        const held = hold.current;
        stop();
        const box = e.currentTarget.getBoundingClientRect();
        const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
        if (held && !held.repeated && inside) onPress();
      }}
      // Fires after pointerup and pointercancel, and when the key is removed while held.
      onLostPointerCapture={stop}
      // Keyboard activation (Enter or Space on a focused key) has no pointer: `detail` is 0.
      onClick={(e) => { if (e.detail === 0) onPress(); }}
      onContextMenu={(e) => { e.preventDefault(); }}
    >
      {spec.label}
    </DockButton>
  );
}
