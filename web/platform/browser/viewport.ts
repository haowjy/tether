// The browser's Viewport (client-architecture.md §5.4). tmux is sized only from the stable
// box: the app root, which is `100svh` tall and so does not change when Safari's toolbars
// collapse or the keyboard opens. `keyboard` is derived, with no timer.
import type { Appearance, SafeArea, Viewport } from "../types";

/** Layout is `phone` when `min(width, stableHeight)` is under this many CSS px. */
const PHONE_BELOW = 600;
/** The keyboard must cover this much of the stable box to count as one (a form bar covers less). */
const KEYBOARD_MIN_PX = 120;

/** A hidden element sized by CSS the script cannot read directly: `100svh` and the safe-area insets. */
function createProbe(): HTMLElement {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:100svh;visibility:hidden;pointer-events:none;" +
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  return probe;
}

function isTextOwner(el: Element | null): boolean {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

export interface BrowserViewport {
  read(): Viewport;
  /** Calls `listener` on every change of any input. Returns the way to stop. */
  watch(listener: (viewport: Viewport) => void): () => void;
  /** Reads again now: for an input the page changes itself, such as the appearance. */
  check(): void;
}

/** `appearance` is the user's choice; "system" follows `prefers-color-scheme`. */
export function createBrowserViewport(appearance: () => Appearance): BrowserViewport {
  const probe = createProbe();
  const fine = matchMedia("(pointer: fine) and (hover: hover)");
  const coarse = matchMedia("(pointer: coarse)");
  const light = matchMedia("(prefers-color-scheme: light)");
  let textOwnerFocused = isTextOwner(document.activeElement);

  const read = (): Viewport => {
    const width = innerWidth;
    const stableHeight = probe.offsetHeight || innerHeight;
    const vv = visualViewport;
    const visibleHeight = vv ? vv.height : innerHeight;
    const style = getComputedStyle(probe);
    const safeArea: SafeArea = {
      top: parseFloat(style.paddingTop) || 0,
      right: parseFloat(style.paddingRight) || 0,
      bottom: parseFloat(style.paddingBottom) || 0,
      left: parseFloat(style.paddingLeft) || 0,
    };
    const chosen = appearance();
    const directInput = fine.matches ? "xterm" : "owned";
    // The visual viewport's bottom edge is where the keyboard starts; a pinch zoom shrinks it too, so a zoomed page has no keyboard.
    const typing = textOwnerFocused && directInput === "owned" && (vv?.scale ?? 1) < 1.05;
    const covered = typing ? Math.max(0, stableHeight - ((vv?.offsetTop ?? 0) + visibleHeight)) : 0;
    return {
      layout: Math.min(width, stableHeight) < PHONE_BELOW ? "phone" : "desktop",
      density: coarse.matches ? "touch" : "compact",
      directInput,
      scheme: chosen === "system" ? (light.matches ? "light" : "dark") : chosen,
      width,
      stableHeight,
      visibleHeight,
      keyboardInset: covered,
      safeArea,
      // From the height alone: Safari scrolling the page with the keyboard up moves offsetTop, not the keyboard.
      keyboard: typing && stableHeight - visibleHeight >= KEYBOARD_MIN_PX,
    };
  };

  let last = "";
  let listener: ((viewport: Viewport) => void) | null = null;
  const check = (): void => {
    const now = read();
    const key = JSON.stringify(now);
    if (key === last) return;
    last = key;
    listener?.(now);
  };

  return {
    read,
    check,
    watch(next) {
      listener = next;
      last = JSON.stringify(read());
      const focus = (): void => {
        textOwnerFocused = isTextOwner(document.activeElement);
        check();
      };
      addEventListener("resize", check);
      addEventListener("orientationchange", check);
      addEventListener("focusin", focus);
      addEventListener("focusout", focus);
      visualViewport?.addEventListener("resize", check);
      visualViewport?.addEventListener("scroll", check);
      for (const query of [fine, coarse, light]) query.addEventListener("change", check);
      return () => {
        listener = null;
        removeEventListener("resize", check);
        removeEventListener("orientationchange", check);
        removeEventListener("focusin", focus);
        removeEventListener("focusout", focus);
        visualViewport?.removeEventListener("resize", check);
        visualViewport?.removeEventListener("scroll", check);
        for (const query of [fine, coarse, light]) query.removeEventListener("change", check);
      };
    },
  };
}
