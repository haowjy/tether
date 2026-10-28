// The focus controller (client-architecture.md §6.5): the only code that calls `.focus()` or
// `.blur()` (lint rule 2). Elements that can hold focus register here; a dialog's initial
// focus and its focus return run in the same dispatch that opened or closed it, because iOS
// raises the keyboard only for a focus made during a user gesture. In native the controller
// remains Swift's; the browser's `setFocus` is a no-op. Native's terminal has no DOM element
// to focus: a stand-in registers as `terminal`, and focusing or blurring it asks native.
import type { FocusMode, InputPlatform, Viewport } from "../platform/types";
import type { FocusPort, FocusTarget } from "../ui/focus";
import { Store } from "../ui/store";
import type { Screen } from "../workspace/state";

export type { FocusTarget };

/**
 * Who holds the keyboard on touch (§6.5): the terminal's input, the dock's line field, or
 * nothing. Browser owners follow DOM focus; the native line mirror reports its target to this
 * same controller because it is deliberately not an editable DOM input.
 */
export type Owner = "terminal" | "line" | "none";

interface FocusView {
  owner: Owner;
}

/**
 * The mode native rests in for a screen: `webText` wherever a web field may take the keyboard;
 * on Terminal, `select` while the selection snapshot holds the touch, so native lets the web view's text selection work.
 */
export function restingMode(screen: Screen, overlay: boolean, keyboardWasUp: boolean, selecting = false): FocusMode {
  if (screen === "terminal" && !overlay) return selecting ? "select" : keyboardWasUp ? "terminal" : "hidden";
  return "webText";
}

export class FocusController extends Store<FocusView> implements FocusPort {
  private readonly targets = new Map<FocusTarget, HTMLElement>();
  /** Stops following the focus of a `terminal` or `line` element. */
  private readonly following = new Map<HTMLElement, () => void>();
  /** The input that held the keyboard when the open dialog opened; it gets the keyboard back on a tap that closes the dialog. */
  private held: "terminal" | "line" | null = null;
  /** Captured before routing hides the opener's owner and consumed by the dialog that mounts. */
  private heldForNextDialog: "terminal" | "line" | null = null;
  private readonly openers = new Map<HTMLDialogElement, Element | null>();
  /** The control the next dialog is opened from. */
  private opener: Element | null = null;
  private standIn: HTMLElement | null = null;
  private mode: FocusMode | null = null;
  private screen: { screen: Screen; overlay: boolean } | null = null;
  private isSelecting = false;

  constructor(
    private readonly input: InputPlatform,
    private readonly viewport: () => Viewport,
    initialOwner: Owner = "none",
    initialMode: FocusMode | null = null,
  ) {
    super({ owner: initialOwner });
    this.mode = initialMode;
  }

  /** An element that can hold focus announces itself on mount. */
  register(target: FocusTarget, element: HTMLElement): void {
    this.targets.set(target, element);
    if (target !== "terminal" && target !== "line") return;
    const focused = (): void => { this.update({ owner: target }); };
    // A blur that hands focus to the other input is a change of owner, not a release: the focus event that follows names the new owner.
    // Reporting "none" in between would render the dock at rest, hiding the compose box before it can take the focus.
    const blurred = (event: FocusEvent): void => {
      const next = event.relatedTarget;
      if (next !== null && next !== element && (next === this.targets.get("terminal") || next === this.targets.get("line"))) return;
      if (this.snapshot.owner === target) this.update({ owner: "none" });
    };
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

  /** A registered element, for placing something against it (a popover under the top row's +); focusing stays this controller's. */
  elementOf(target: FocusTarget): HTMLElement | null {
    return this.targets.get(target) ?? null;
  }

  /** The toggle is the terminal opener and the closer for either target. */
  toggleKeyboard(): void {
    const { owner } = this.snapshot;
    if (owner === "none") this.focusTarget("terminal", true);
    else if (owner === "line" && this.isNative) this.nativeLineBlur();
    else this.targets.get(owner)?.blur();
  }

  /** The non-editable app mirror chose the line target. */
  nativeLineFocus(): void {
    if (!this.isNative || this.screen?.screen !== "terminal" || this.screen.overlay) return;
    this.update({ owner: "line" });
    this.send("line");
  }

  /** Leave the native line target without asking the DOM mirror to blur. */
  nativeLineBlur(): void {
    if (!this.isNative || this.snapshot.owner !== "line") return;
    this.update({ owner: "none" });
    this.rest();
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
    if (!before.keyboard || after.keyboard || owner === "none") return;
    if (owner === "line" && this.isNative) this.nativeLineBlur();
    else this.targets.get(owner)?.blur();
  }

  /**
   * The `terminal` target in native, where Swift owns the keyboard and the page has no element for it. Focus and
   * blur announce themselves like an element's, so owner tracking and dialog returns need no special case.
   */
  nativeTerminal(): HTMLElement {
    if (!this.standIn) {
      const element = document.createElement("div");
      element.hidden = true;
      const announce = (type: "focus" | "blur"): void => {
        // A FocusEvent, so `relatedTarget` is null as a real element's blur has it: `undefined` would match an unregistered target and read as a hand-off.
        element.dispatchEvent(new FocusEvent(type));
        this.rest();
      };
      element.focus = () => { announce("focus"); };
      element.blur = () => { announce("blur"); };
      document.body.append(element);
      this.standIn = element;
    }
    return this.standIn;
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

  /** A field the user is done with: let go of it now, which lowers the keyboard. */
  blurElement(element: HTMLElement): void {
    element.blur();
  }

  /** The tap that opens a dialog notes its control here: Safari leaves a clicked button unfocused, so `document.activeElement` is not it. */
  noteOpener(opener: Element | null): void {
    this.opener = opener;
    const owner = this.snapshot.owner;
    this.heldForNextDialog = this.viewport().density === "touch" && owner !== "none" ? owner : null;
  }

  /**
   * Shows a modal dialog and sets its initial focus: the field marked `data-initial-focus=""`
   * on a fine pointer, else the close button; in `touch` density never a field (the close
   * button), so opening the sessions sheet on a phone doesn't raise the keyboard.
   */
  openDialog(dialog: HTMLDialogElement): void {
    const { owner } = this.snapshot;
    this.held = this.heldForNextDialog ?? (this.viewport().density === "touch" && owner !== "none" ? owner : null);
    this.heldForNextDialog = null;
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
    const heldOwner = this.held;
    const held = this.held === null ? undefined : this.targets.get(this.held);
    this.held = null;
    if (dialog.open) dialog.close();
    if (fromTap && heldOwner !== null && this.isNative) {
      // The route still has its overlay until this tap returns. Restore now so native can
      // raise its keyboard in the gesture; the route's next screenChanged keeps this owner.
      this.update({ owner: heldOwner });
      this.send(heldOwner);
      return;
    }
    if (fromTap && held?.isConnected) {
      held.focus();
      return;
    }
    const target = typeof returnTo === "string" ? this.targets.get(returnTo) : returnTo;
    const back = target ?? opener;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }

  /** The selection snapshot holds the touch (§7.6) while `on`: native's mode follows it. */
  selecting(on: boolean): void {
    this.isSelecting = on;
    this.rest();
  }

  /** Whenever the screen or overlay changes: native learns the mode the screen needs. */
  screenChanged(screen: Screen, overlay: boolean): void {
    this.screen = { screen, overlay };
    const { owner } = this.snapshot;
    // Leaving the terminal screen lowers the keyboard (the dock is hidden there, which would drop it only later).
    if ((screen !== "terminal" || overlay) && owner !== "none") {
      if (owner === "line" && this.isNative) this.update({ owner: "none" });
      else this.targets.get(owner)?.blur();
    }
    this.rest();
  }

  private rest(): void {
    const mode = this.restingNow();
    if (mode !== null && mode !== this.mode) this.send(mode);
  }

  private restingNow(): FocusMode | null {
    if (!this.screen) return null;
    if (this.isSelecting) return restingMode(this.screen.screen, this.screen.overlay, this.snapshot.owner !== "none", true);
    if (this.isNative && this.screen.screen === "terminal" && !this.screen.overlay && this.snapshot.owner === "line") return "line";
    return restingMode(this.screen.screen, this.screen.overlay, this.snapshot.owner !== "none", this.isSelecting);
  }

  private get isNative(): boolean { return this.viewport().directInput === "native"; }

  private send(mode: FocusMode | null): void {
    if (mode === null) return;
    this.mode = mode;
    this.input.setFocus(mode);
  }
}
