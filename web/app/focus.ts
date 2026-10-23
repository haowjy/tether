// The focus controller (client-architecture.md §6.5): the only code that calls `.focus()` or
// `.blur()` (lint rule 2). Elements that can hold focus register here; a dialog's initial
// focus and its focus return run in the same dispatch that opened or closed it, because iOS
// raises the keyboard only for a focus made during a user gesture. In native the controller
// remains Swift's; the browser's `setFocus` is a no-op.
import type { InputPlatform, Viewport } from "../platform/types";
import type { FocusPort, FocusTarget } from "../ui/focus";
import type { Destination } from "./router";

export type { FocusTarget };

export type FocusMode = Parameters<InputPlatform["setFocus"]>[0];

/** The mode native rests in for a screen: `webText` wherever a web field may take the keyboard. */
export function restingMode(destination: Destination, overlay: boolean, keyboardWasUp: boolean): FocusMode {
  if (destination === "terminal" && !overlay) return keyboardWasUp ? "terminal" : "hidden";
  return "webText";
}

export class FocusController implements FocusPort {
  private readonly targets = new Map<FocusTarget, HTMLElement>();
  private readonly openers = new Map<HTMLDialogElement, Element | null>();
  private mode: FocusMode | null = null;

  constructor(
    private readonly input: InputPlatform,
    private readonly viewport: () => Viewport,
  ) {}

  /** An element that can hold focus announces itself on mount; `null` withdraws it. */
  register(target: FocusTarget, element: HTMLElement | null): void {
    if (element) this.targets.set(target, element);
    else this.targets.delete(target);
  }

  /**
   * Focuses a registered element. Touch never focuses programmatically except
   * synchronously inside the tap that asked: callers pass `fromTap` from that handler.
   */
  focusTarget(target: FocusTarget, fromTap = false): boolean {
    if (this.viewport().density === "touch" && !fromTap) return false;
    const element = this.targets.get(target);
    if (!element) return false;
    element.focus();
    return true;
  }

  /** A field or control the user chose: focus it now, inside the handler that asked. */
  focusElement(element: HTMLElement): void {
    element.focus();
  }

  /**
   * Shows a modal dialog and sets its initial focus: a text field on a fine pointer if
   * `initial` names one; in `touch` density never a field (the dialog itself or its close
   * button), so opening the picker on a phone doesn't raise the keyboard.
   */
  openDialog(dialog: HTMLDialogElement, initial?: HTMLElement | null): void {
    this.openers.set(dialog, document.activeElement);
    if (!dialog.open) dialog.showModal();
    const touch = this.viewport().density === "touch";
    const first = touch ? dialog.querySelector<HTMLElement>("[data-initial-focus='touch']") : (initial ?? dialog.querySelector<HTMLElement>("[data-initial-focus]"));
    (first ?? dialog).focus();
  }

  /** Closes a dialog and returns focus to `returnTo`, else to the exact control that opened it. */
  closeDialog(dialog: HTMLDialogElement, returnTo?: HTMLElement | FocusTarget | null): void {
    const opener = this.openers.get(dialog) ?? null;
    this.openers.delete(dialog);
    if (dialog.open) dialog.close();
    const target = typeof returnTo === "string" ? this.targets.get(returnTo) : returnTo;
    const back = target ?? opener;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }

  /** Whenever the destination or overlay changes: native learns the mode the screen needs. */
  screenChanged(destination: Destination, overlay: boolean): void {
    const mode = restingMode(destination, overlay, this.viewport().keyboard);
    if (mode === this.mode) return;
    this.mode = mode;
    this.input.setFocus(mode);
  }
}
