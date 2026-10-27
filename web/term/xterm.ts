import { Terminal } from "@xterm/xterm";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { CellSize, RendererOptions, TerminalRenderer } from ".";
import { bufferRows } from "./lines";
import type { MouseEncoding } from "./mouse";
import { WritePipeline, type Snapshot } from "./pipeline";
import { PromptTracker } from "./prompt";
import { terminalBottomPan } from "./size";
import { createDesktopInput } from "./xterm-input";

/** Context losses tolerated before settling on the DOM renderer. */
const MAX_WEBGL_RECREATIONS = 3;

/**
 * xterm.js 6 behind {@link TerminalRenderer}. WebGL when the context can be had, the DOM
 * renderer otherwise; a lost context is recreated, a few times, since the buffer lives in
 * the Terminal and survives the renderer.
 */
export function createXtermRenderer(container: HTMLElement, options: RendererOptions): TerminalRenderer {
  // Stdin is off until a source is chosen: with native or tether's owned input, xterm's helper
  // textarea must never take focus (ios-shell.md "Keyboard"). `setInput` turns it on for desktop.
  const term = new Terminal({
    allowProposedApi: true, // unicode11 needs it
    disableStdin: true,
    scrollback: 5000,
    fontFamily: options.fontFamily,
    fontSize: options.fontSize,
    theme: options.theme,
  });
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = "11";
  // A tapped URL leaves the app through native, never `window.open` (ios-shell.md "Web content security").
  term.loadAddon(new WebLinksAddon((_event, url) => { options.openLink(url); }));
  term.open(container);
  const setDesktopInput = createDesktopInput(term);
  setDesktopInput(null);

  let recreations = 0;
  let webgl: WebglAddon | undefined;
  let webglWanted = true;
  const attachWebgl = (): void => {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose(); // xterm falls back to the DOM renderer meanwhile
        if (webgl === addon && webglWanted && recreations++ < MAX_WEBGL_RECREATIONS) attachWebgl();
      });
      term.loadAddon(addon);
      webgl = addon;
    } catch {
      webgl = undefined; // no WebGL here: stay on the DOM renderer
    }
  };
  attachWebgl();

  // xterm keeps the report format private; the parser sees the same DECSET that sets it.
  let encoding: MouseEncoding = "x10";
  const encodingMode = (set: boolean) => (params: (number | number[])[]): boolean => {
    for (const param of params) {
      if (param === 1006) encoding = set ? "sgr" : "x10";
      else if (param === 1005 && encoding !== "sgr") encoding = set ? "utf8" : "x10";
    }
    return false; // xterm still applies it
  };
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, encodingMode(true));
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, encodingMode(false));

  const prompt = new PromptTracker(term);
  const pipeline = new WritePipeline({
    write: (data, callback) => { term.write(data, callback); },
    reset: () => {
      encoding = "x10";
      prompt.reset();
      term.reset();
    },
    resize: (cols, rows) => { term.resize(cols, rows); },
  });
  const cellSize = (): CellSize | null => {
    // The screen element is exactly cols × rows cells, so this needs no private API.
    const screen = term.element?.querySelector(".xterm-screen");
    if (!screen || term.cols === 0 || term.rows === 0) return null;
    const { width, height } = screen.getBoundingClientRect();
    return width > 0 && height > 0 ? { width: width / term.cols, height: height / term.rows } : null;
  };

  // The keyboard shortens what is visible but never tmux: the terminal keeps its rows and
  // slides to put the last row at the pan area's bottom. If that would hide the cursor above
  // the area, the cursor row meets the bottom instead. The browser's container never shrinks.
  // In history the pan anchors to the top, so no row is skipped; the cursor lives at the bottom.
  // The slide follows a resize with the keyboard's motion; a cursor move jumps, as text does.
  let panned = 0;
  let scrolledUp = false;
  let panArea: number | null = null;
  const pan = (animate: boolean): void => {
    const element = term.element;
    const cell = cellSize();
    if (!element || !cell) return;
    const next = scrolledUp ? 0 : terminalBottomPan(term.buffer.active.cursorY, term.rows, cell.height, panArea ?? container.clientHeight);
    if (next === panned) return;
    panned = next;
    element.style.transition = animate ? "" : "none";
    element.style.transform = next ? `translateY(${String(-next)}px)` : "";
  };
  const scrollListeners: ((scrolledUp: boolean) => void)[] = [];
  // New output while scrolled up moves the newest line away without scrolling the view,
  // so writes are checked as well as scrolls.
  const checkScroll = (): void => {
    const buffer = term.buffer.active;
    const up = buffer.viewportY < buffer.baseY;
    if (up === scrolledUp) return;
    scrolledUp = up;
    pan(false);
    for (const listener of scrollListeners) listener(up);
  };
  term.onScroll(checkScroll);
  term.onWriteParsed(checkScroll);

  const resized = new ResizeObserver(() => { pan(true); });
  resized.observe(container);
  term.onCursorMove(() => { pan(false); });
  term.onResize(() => { pan(false); });

  return {
    output: (bytes) => { pipeline.output(bytes); },
    snapshot: (snapshot: Snapshot) => pipeline.snapshot(snapshot),
    cellSize,
    setTheme: (theme) => { term.options.theme = theme; },
    onScrolledUp: (listener) => { scrollListeners.push(listener); },
    scrollToBottom: () => { term.scrollToBottom(); },
    onPromptLine: (listener) => { prompt.onLine(listener); },
    setFont: (fontFamily, fontSize) => {
      term.options.fontFamily = fontFamily;
      term.options.fontSize = fontSize;
    },
    setWebgl: (on) => {
      webglWanted = on;
      if (on && !webgl) attachWebgl();
      else if (!on && webgl) {
        const addon = webgl;
        webgl = undefined;
        addon.dispose(); // xterm falls back to the DOM renderer
      }
    },
    refreshGlyphs: () => { webgl?.clearTextureAtlas(); },
    setInput: setDesktopInput,
    inputElement: () => term.textarea ?? null,
    selectionText: () => term.getSelection(),
    mouseMode: () => term.modes.mouseTrackingMode,
    mouseEncoding: () => encoding,
    altScreen: () => term.buffer.active.type === "alternate",
    cursor: () => ({ col: term.buffer.active.cursorX, row: term.buffer.active.cursorY }),
    scrollback: () => {
      const buffer = term.buffer.active;
      return { rows: buffer.baseY, up: buffer.baseY - buffer.viewportY };
    },
    scrollRows: (rows) => {
      const before = term.buffer.active.viewportY;
      term.scrollLines(rows);
      return term.buffer.active.viewportY - before;
    },
    shift: (px) => {
      if (term.element) term.element.style.translate = px === 0 ? "" : `0 ${String(px)}px`;
    },
    rows: (from, to) => bufferRows(term.buffer.active, from, to),
    viewportTop: () => term.buffer.active.viewportY,
    cellAt: (x, y) => {
      const screen = term.element?.querySelector(".xterm-screen");
      const cell = cellSize();
      if (!screen || !cell) return null;
      // The rectangle includes the pan's translation, so a panned terminal still maps right.
      const rect = screen.getBoundingClientRect();
      const col = Math.floor((x - rect.left) / cell.width);
      const row = Math.floor((y - rect.top) / cell.height);
      return col < 0 || row < 0 || col >= term.cols || row >= term.rows ? null : { col, row };
    },
    screenOrigin: () => {
      const rect = term.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top } : null;
    },
    setPanArea: (px) => {
      panArea = px;
      pan(true);
    },
    setInactiveCursor: (style) => { term.options.cursorInactiveStyle = style; },
  };
}
