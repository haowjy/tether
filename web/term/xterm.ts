import { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import type { TerminalRenderer } from ".";
import { WritePipeline, type Snapshot } from "./pipeline";

/** Context losses tolerated before settling on the DOM renderer. */
const MAX_WEBGL_RECREATIONS = 3;

/**
 * xterm.js 6 behind {@link TerminalRenderer}. WebGL when the context can be had, the DOM
 * renderer otherwise; a lost context is recreated, a few times, since the buffer lives in
 * the Terminal and survives the renderer.
 */
export function createXtermRenderer(container: HTMLElement): TerminalRenderer {
  // Native owns the keyboard: xterm's input never fires, and its helper textarea must
  // never take focus (ios-shell.md "Keyboard").
  const term = new Terminal({
    allowProposedApi: true, // unicode11 needs it
    disableStdin: true,
    scrollback: 5000,
    fontFamily: "Menlo, monospace",
    fontSize: 12,
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

  const pipeline = new WritePipeline(term);
  return {
    output: (bytes) => { pipeline.output(bytes); },
    snapshot: (snapshot: Snapshot) => pipeline.snapshot(snapshot),
    cellSize: () => {
      // The screen element is exactly cols × rows cells, so this needs no private API.
      const screen = term.element?.querySelector(".xterm-screen");
      if (!screen || term.cols === 0 || term.rows === 0) return null;
      const { width, height } = screen.getBoundingClientRect();
      return width > 0 && height > 0 ? { width: width / term.cols, height: height / term.rows } : null;
    },
    dispose: () => {
      webgl = undefined;
      term.dispose();
    },
  };
}
