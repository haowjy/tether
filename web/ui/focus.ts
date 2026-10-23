// What the primitives need of the focus controller. app/focus.ts implements it and the App
// root provides it; ui/ never imports app/. Only the controller calls `.focus()` or `.blur()`
// (lint rule 2), so every primitive that must move focus asks through this port.
import { createContext } from "preact";
import { useContext } from "preact/hooks";

/** Elements the app moves focus to by name. */
export type FocusTarget = "terminal" | "draft" | "homeSearch" | "plus";

export interface FocusPort {
  register(target: FocusTarget, element: HTMLElement | null): void;
  focusElement(element: HTMLElement): void;
  openDialog(dialog: HTMLDialogElement, initial?: HTMLElement | null): void;
  closeDialog(dialog: HTMLDialogElement, returnTo?: HTMLElement | FocusTarget | null): void;
}

const missing = (): never => {
  throw new Error("No focus controller: render inside <App> or the harness");
};

export const FocusContext = createContext<FocusPort>({
  register: missing,
  focusElement: missing,
  openDialog: missing,
  closeDialog: missing,
});

export function useFocus(): FocusPort {
  return useContext(FocusContext);
}
