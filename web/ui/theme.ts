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

/** The terminal's colours from the `--term-*` tokens (ui/tokens.css), for the scheme now in force. */
export function terminalTheme(): TerminalTheme {
  const style = getComputedStyle(document.documentElement);
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const read = (name: string): string => {
    const value = style.getPropertyValue(`--${name}`).trim();
    return ctx ? toRgba(ctx, value) : value;
  };
  const theme: TerminalTheme = {
    background: read("surface-term"),
    foreground: read("term-fg"),
    cursor: read("term-cursor"),
    cursorAccent: read("surface-term"),
    selectionBackground: read("term-selection"),
  };
  for (const name of ANSI) {
    theme[name] = read(`term-${name}`);
    theme[`bright${name[0]?.toUpperCase() ?? ""}${name.slice(1)}` as keyof TerminalTheme] = read(`term-bright-${name}`);
  }
  return theme;
}

/** Calls `apply` whenever the system switches between light and dark. */
export function onSchemeChange(apply: () => void): void {
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", apply);
}
