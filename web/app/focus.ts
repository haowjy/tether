// The focus controller (client-architecture.md §6.5): the only code that calls `.focus()` or
// `.blur()` (lint rule 2). Elements that can hold focus register here; a dialog's initial
// focus and its focus return run in the same dispatch that opened or closed it, because iOS
// raises the keyboard only for a focus made during a user gesture. In native the controller
// remains Swift's; the browser's `setFocus` is a no-op.
import type { InputPlatform, Viewport } from "../platform/types";
import type { FocusPort, FocusTarget } from "../ui/focus";
import { Store } from "../ui/store";
import type { Destination } from "./router";

export type { FocusTarget };

type FocusMode = Parameters<InputPlatform["setFocus"]>[0];

/**
 * Who holds the keyboard on touch (§6.5): the terminal's input, the dock's line field, or
 * nothing. It follows DOM focus, so Safari's Done and its form bar's arrows keep the keyboard
 * toggle right. The other owners of the spec's table (a field, an overlay, the selection
 * layer) change nothing the dock reads, so they are not tracked.
 */
export type Owner = "terminal" | "line" | "none";

interface FocusView {
  owner: Owner;
}

/** The mode native rests in for a screen: `webText` wherever a web field may take the keyboard. */
export function restingMode(destination: Destination, overlay: boolean, keyboardWasUp: boolean): FocusMode {
  if (destination === "terminal" && !overlay) return keyboardWasUp ? "terminal" : "hidden";
  return "webText";
}

export class FocusController extends Store<FocusView> implements FocusPort {
  private readonly targets = new Map<FocusTarget, HTMLElement>();
  /** Stops following the focus of a `terminal` or `line` element. */
  private readonly following = new Map<HTMLElement, () => void>();
  /** The input that held the keyboard when the open dialog opened; it gets the keyboard back on a tap that closes the dialog. */
  private held: "terminal" | "line" | null = null;
  private readonly openers = new Map<HTMLDialogElement, Element | null>();
  /** The control the next dialog is opened from. */
  private opener: Element | null = null;
  private mode: FocusMode | null = null;

  constructor(
    private readonly input: InputPlatform,
    private readonly viewport: () => Viewport,
  ) {
    super({ owner: "none" });
  }

  /** An element that can hold focus announces itself on mount. */
  register(target: FocusTarget, element: HTMLElement): void {
    this.targets.set(target, element);
    if (target !== "terminal" && target !== "line") return;
    const focused = (): void => { this.update({ owner: target }); };
    const blurred = (): void => { if (this.snapshot.owner === target) this.update({ owner: "none" }); };
    element.addEventListener("focus", focused);
    element.addEventListener("blur", blurred);
    this.following.set(element, () => {
      element.removeEventListener("focus", focused);
      element.removeEventListener("blur", blurred);
    });
    if (document.activeElement === element) focused();
  }

  /** An element withdraws on unmount. Only the registered element may: a replacement can mount before the old one unmounts. */
  withdraw(target: FocusTarget, element: HTMLElement): void {
    this.following.get(element)?.();
    this.following.delete(element);
    if (this.targets.get(target) !== element) return;
    this.targets.delete(target);
    if (this.snapshot.owner === target) this.update({ owner: "none" });
  }

  /**
   * The keyboard toggle (touch), run inside its tap: with an input holding the keyboard it
   * lowers it, else it raises it for the terminal's input. Only the toggle opens live
   * typing, and nothing else lowers the keyboard on purpose.
   */
  toggleKeyboard(): void {
    const { owner } = this.snapshot;
    if (owner === "none") this.focusTarget("terminal", true);
    else this.targets.get(owner)?.blur();
  }

  /**
   * Inside the tap that closes a dialog (a pill, a window row, the close icon, the
   * backdrop): if an input held the keyboard when the dialog opened, close the dialog now and
   * give the keyboard back, since iOS raises it only for a focus made during the gesture.
   * A close without a tap (Escape, the back gesture) leaves the keyboard down.
   */
  returnKeyboardInTap(from: Element): void {
    const dialog = from.closest("dialog");
    if (this.held !== null && dialog) this.closeDialog(dialog, undefined, true);
  }

  /** `keyboard` falling while an input still holds focus means the system lowered it without telling the page: let go of the input. */
  viewportChanged(before: Viewport, after: Viewport): void {
    const { owner } = this.snapshot;
    if (before.keyboard && !after.keyboard && owner !== "none") this.targets.get(owner)?.blur();
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

  /** The tap that opens a dialog notes its control here: Safari leaves a clicked button unfocused, so `document.activeElement` is not it. */
  noteOpener(opener: Element | null): void {
    this.opener = opener;
  }

  /**
   * Shows a modal dialog and sets its initial focus: the field marked `data-initial-focus=""`
   * on a fine pointer, else the close button; in `touch` density never a field (the close
   * button), so opening the picker on a phone doesn't raise the keyboard.
   */
  openDialog(dialog: HTMLDialogElement): void {
    const { owner } = this.snapshot;
    this.held = this.viewport().density === "touch" && owner !== "none" ? owner : null;
    this.openers.set(dialog, this.opener ?? document.activeElement);
    this.opener = null;
    if (!dialog.open) dialog.showModal();
    const mark = (value: string): HTMLElement | null => dialog.querySelector<HTMLElement>(`[data-initial-focus='${value}']`);
    const first = this.viewport().density === "touch" ? mark("touch") : (mark("") ?? mark("touch"));
    (first ?? dialog).focus();
  }

  /** Closes a dialog and returns focus to `returnTo`, else to the exact control that opened it. `fromTap`: the keyboard goes back to the input that held it. */
  closeDialog(dialog: HTMLDialogElement, returnTo?: HTMLElement | FocusTarget | null, fromTap = false): void {
    const opener = this.openers.get(dialog) ?? null;
    this.openers.delete(dialog);
    const held = this.held === null ? undefined : this.targets.get(this.held);
    this.held = null;
    if (dialog.open) dialog.close();
    if (fromTap && held?.isConnected) {
      held.focus();
      return;
    }
    const target = typeof returnTo === "string" ? this.targets.get(returnTo) : returnTo;
    const back = target ?? opener;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }

  /** Whenever the destination or overlay changes: native learns the mode the screen needs. */
  screenChanged(destination: Destination, overlay: boolean): void {
    const { owner } = this.snapshot;
    // Leaving Terminal lowers the keyboard (the dock is hidden there, which would drop it only later).
    if (destination !== "terminal" && owner !== "none") this.targets.get(owner)?.blur();
    const mode = restingMode(destination, overlay, owner !== "none");
    if (mode === this.mode) return;
    this.mode = mode;
    this.input.setFocus(mode);
  }
}
