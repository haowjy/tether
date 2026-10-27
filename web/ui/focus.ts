// What the primitives need of the focus controller. app/focus.ts implements it and the App
// root provides it; ui/ never imports app/. Only the controller calls `.focus()` or `.blur()`
// (lint rule 2), so every primitive that must move focus asks through this port.
import { createContext } from "preact";
import { useCallback, useContext, useRef } from "preact/hooks";

/** Elements the app moves focus to by name. */
export type FocusTarget = "terminal" | "line" | "plus" | "addFolder" | "path" | "tabs";

export interface FocusPort {
  register(target: FocusTarget, element: HTMLElement): void;
  withdraw(target: FocusTarget, element: HTMLElement): void;
  /** A registered element, to place something against; null when it isn't on screen. */
  elementOf(target: FocusTarget): HTMLElement | null;
  focusElement(element: HTMLElement): void;
  /** Lowers the keyboard: the field the user was typing in is done. */
  blurElement(element: HTMLElement): void;
  openDialog(dialog: HTMLDialogElement): void;
  closeDialog(dialog: HTMLDialogElement, returnTo?: HTMLElement | FocusTarget | null): void;
  /** Inside the tap that closes a dialog: hands the keyboard back to the input that held it when the dialog opened. */
  returnKeyboardInTap(from: Element): void;
}

const missing = (): never => {
  throw new Error("No focus controller: render inside <App> or the harness");
};

export const FocusContext = createContext<FocusPort>({
  register: missing,
  withdraw: missing,
  elementOf: missing,
  focusElement: missing,
  blurElement: missing,
  openDialog: missing,
  closeDialog: missing,
  returnKeyboardInTap: missing,
});

export function useFocus(): FocusPort {
  return useContext(FocusContext);
}

/** A stable ref callback that registers its element under `target` while it is mounted. */
export function useFocusRef(target: FocusTarget | undefined): (el: HTMLElement | null) => void {
  const focus = useFocus();
  const mounted = useRef<HTMLElement | null>(null);
  return useCallback(
    (el: HTMLElement | null) => {
      if (!target) return;
      if (el) {
        mounted.current = el;
        focus.register(target, el);
      } else if (mounted.current) {
        focus.withdraw(target, mounted.current);
        mounted.current = null;
      }
    },
    [focus, target],
  );
}
