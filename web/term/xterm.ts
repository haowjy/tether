import { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { CellSize, RendererOptions, TerminalRenderer } from ".";
import { WritePipeline, type Snapshot } from "./pipeline";
import { PromptTracker } from "./prompt";
import { cursorPan } from "./size";

/** Context losses tolerated before settling on the DOM renderer. */
const MAX_WEBGL_RECREATIONS = 3;

/**
 * xterm.js 6 behind {@link TerminalRenderer}. WebGL when the context can be had, the DOM
 * renderer otherwise; a lost context is recreated, a few times, since the buffer lives in
 * the Terminal and survives the renderer.
 */
export function createXtermRenderer(container: HTMLElement, options: RendererOptions): TerminalRenderer {
  // Native owns the keyboard: xterm's input never fires, and its helper textarea must
  // never take focus (ios-shell.md "Keyboard").
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
  term.loadAddon(new WebLinksAddon());
  term.loadAddon(new SearchAddon());
  term.open(container);
  const helper = term.textarea;
  if (helper) {
    helper.tabIndex = -1;
    helper.inert = true;
  }

  let recreations = 0;
  let webgl: WebglAddon | undefined;
  const attachWebgl = (): void => {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose(); // xterm falls back to the DOM renderer meanwhile
        if (webgl === addon && recreations++ < MAX_WEBGL_RECREATIONS) attachWebgl();
      });
      term.loadAddon(addon);
      webgl = addon;
    } catch {
      webgl = undefined; // no WebGL here: stay on the DOM renderer
    }
  };
  attachWebgl();

  const prompt = new PromptTracker(term);
  const pipeline = new WritePipeline({
    write: (data, callback) => { term.write(data, callback); },
    reset: () => {
      prompt.reset();
      term.reset();
    },
    resize: (cols, rows) => { term.resize(cols, rows); },
  });
  const scrollListeners: ((scrolledUp: boolean) => void)[] = [];
  let scrolledUp = false;
  // New output while scrolled up moves the newest line away without scrolling the view,
  // so writes are checked as well as scrolls.
  const checkScroll = (): void => {
    const buffer = term.buffer.active;
    const up = buffer.viewportY < buffer.baseY;
    if (up === scrolledUp) return;
    scrolledUp = up;
    for (const listener of scrollListeners) listener(up);
  };
  term.onScroll(checkScroll);
  term.onWriteParsed(checkScroll);

  const cellSize = (): CellSize | null => {
    // The screen element is exactly cols × rows cells, so this needs no private API.
    const screen = term.element?.querySelector(".xterm-screen");
    if (!screen || term.cols === 0 || term.rows === 0) return null;
    const { width, height } = screen.getBoundingClientRect();
    return width > 0 && height > 0 ? { width: width / term.cols, height: height / term.rows } : null;
  };

  // The keyboard shortens the container but never tmux: the terminal keeps its rows and
  // slides so the cursor row stays in view. The slide follows the container's resize
  // with the keyboard's motion; a cursor move jumps, as text does.
  let panned = 0;
  const pan = (animate: boolean): void => {
    const element = term.element;
    const cell = cellSize();
    if (!element || !cell) return;
    const next = cursorPan(term.buffer.active.cursorY, term.rows, cell.height, container.clientHeight);
    if (next === panned) return;
    panned = next;
    element.style.transition = animate ? "" : "none";
    element.style.transform = next ? `translateY(${String(-next)}px)` : "";
  };
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
    dispose: () => {
      resized.disconnect();
      webgl = undefined;
      term.dispose();
    },
  };
}
