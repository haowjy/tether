import type { Preferences, Viewport } from "../platform/types";
import type { TerminalTheme } from "../term";

const ANSI = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
] as const;

/**
 * Any CSS colour as `rgba(…)`. The tokens are OKLCH, which xterm.js doesn't parse and
 * computed styles return unchanged, so a 1×1 canvas does the conversion.
 */
function toRgba(ctx: CanvasRenderingContext2D, css: string): string {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${(a / 255).toFixed(3)})`;
}

/** The terminal's colours from the `--term-*` tokens (ui/tokens/semantic.css), for the scheme now in force. */
export function terminalTheme(): TerminalTheme {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  // The tokens use `light-dark()`, which a detached canvas would resolve with the wrong
  // scheme. An element in the document resolves it, and the canvas converts what comes back.
  const probe = document.createElement("span");
  document.documentElement.append(probe);
  const read = (name: string): string => {
    probe.style.color = `var(--${name})`;
    const css = getComputedStyle(probe).color;
    return ctx ? toRgba(ctx, css) : css;
  };
  const theme: TerminalTheme = {
    background: read("term-bg"),
    foreground: read("term-fg"),
    cursor: read("term-cursor"),
    cursorAccent: read("term-bg"),
    selectionBackground: read("term-selection"),
  };
  for (const name of ANSI) {
    theme[name] = read(`term-${name}`);
    theme[`bright${name[0]?.toUpperCase() ?? ""}${name.slice(1)}` as keyof TerminalTheme] = read(`term-bright-${name}`);
  }
  probe.remove();
  return theme;
}

/**
 * Notes on the root whether the last input was a key or a pointer, so CSS can hide the focus
 * ring a touch or click put on a control by script (a dialog's close button) and keep it for the keyboard.
 */
export function trackInputKind(): void {
  const root = document.documentElement;
  const note = (kind: "key" | "pointer") => (): void => { root.dataset["input"] = kind; };
  addEventListener("keydown", note("key"), true);
  addEventListener("pointerdown", note("pointer"), true);
}

/**
 * Puts the platform's viewport facts where CSS reads them: the scheme, the density, and the
 * safe-area insets tmux was sized from. Call it before the first render and on every
 * `viewport` event; re-theme xterm afterwards with {@link terminalTheme}.
 */
export function applyViewport(viewport: Viewport): void {
  const root = document.documentElement;
  // Each write invalidates style for the whole page, so only what changed is written.
  const setData = (name: "scheme" | "density" | "layout", value: string): void => {
    if (root.dataset[name] !== value) root.dataset[name] = value;
  };
  setData("scheme", viewport.scheme);
  setData("density", viewport.density);
  setData("layout", viewport.layout);
  for (const side of ["top", "right", "bottom", "left"] as const) {
    const value = `${String(viewport.safeArea[side])}px`;
    if (root.style.getPropertyValue(`--safe-${side}`) !== value) root.style.setProperty(`--safe-${side}`, value);
  }
  const inset = `${String(viewport.keyboardInset)}px`;
  if (root.style.getPropertyValue("--keyboard-inset") !== inset) root.style.setProperty("--keyboard-inset", inset);
}

/** Puts the text size where CSS reads it (`--term-text-delta`); the terminal re-fonts when the preference changes. */
export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement;
  if (root.dataset["textSize"] !== preferences.textSize) root.dataset["textSize"] = preferences.textSize;
}
