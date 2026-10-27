// The dock's key row (client-architecture.md §7.4): one fixed row of the keys a phone keyboard
// lacks, in a horizontal scroller. A tap never moves focus or lowers the keyboard (DockButton),
// and a key acts on `pointerup` inside it. Control keys go to the
// terminal; character keys go where typing goes; ctrl and alt arm the next key.
import { useEffect, useRef } from "preact/hooks";
import type { InputEvent } from "../../../platform/types";
import { useApp } from "../../../app/context";
import { DockButton } from "../../../ui/primitives/DockButton";
import { useStore } from "../../../ui/store";
import { terminalsOf } from "../terminals";
import styles from "./Dock.module.css";

/** `name` is set only where the visible label can't be read aloud as the key (the arrows, the caret chords). */
type Spec =
  | { label: string; name?: string; key: string; repeat?: boolean }
  | { label: string; modifier: "ctrl" | "alt" }
  | { label: string; text: string };

const KEYS: Spec[] = [
  { label: "esc", key: "Escape" },
  { label: "←", name: "Left arrow", key: "Left", repeat: true },
  { label: "↑", name: "Up arrow", key: "Up", repeat: true },
  { label: "↓", name: "Down arrow", key: "Down", repeat: true },
  { label: "→", name: "Right arrow", key: "Right", repeat: true },
  { label: "^R", name: "Control R", key: "C-r" },
  { label: "^C", name: "Control C", key: "C-c" },
  { label: "tab", key: "Tab" },
  { label: "ctrl", modifier: "ctrl" },
  { label: "alt", modifier: "alt" },
  { label: "|", text: "|" },
  { label: "~", text: "~" },
  { label: "/", text: "/" },
  { label: "-", text: "-" },
];

/** A held arrow repeats after this, then at this rate. */
const REPEAT_AFTER_MS = 400;
const REPEAT_EVERY_MS = 33;

interface KeyRowProps {
  /** Inserts a character at the line field's caret when the line field holds the keyboard. Returns false when it does not. */
  insertIntoLine: (text: string) => boolean;
}

export function KeyRow({ insertIntoLine }: KeyRowProps) {
  const app = useApp();
  const terminals = terminalsOf(app);
  const { modifiers } = terminals;
  const armed = useStore(modifiers, (s) => s.armed);

  const send = (spec: Spec): void => {
    if ("modifier" in spec) {
      modifiers.toggle(spec.modifier);
    } else if ("text" in spec) {
      // An armed modifier takes the character to the terminal even from the line field.
      if (!modifiers.chord(spec.text) && !insertIntoLine(spec.text)) modifiers.input([{ text: spec.text } satisfies InputEvent]);
    } else {
      modifiers.input([{ key: spec.key }]);
    }
  };

  return (
    <div class={styles.keys} role="group" aria-label="Terminal keys">
      {KEYS.map((spec) => (
        <Key
          key={spec.label}
          spec={spec}
          pressed={"modifier" in spec && armed === spec.modifier}
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
  onPress: () => void;
  onDown: () => void;
}

function Key({ spec, pressed, onPress, onDown }: KeyProps) {
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
      aria-label={"name" in spec ? spec.name : undefined}
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
