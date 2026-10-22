// Desktop dev mode: stands in for native so the real web UI runs in a desktop browser
// against a local daemon (web/README.md). Imported only under `import.meta.env.DEV`, so
// no build carries it.
import type { Boot, InputEvent, NativeMsg, Post, SavedTab, TokenReply, Viewport } from "../native/bridge";
import { BRIDGE_VERSION } from "../native/bridge";

const TOKEN_KEY = "tether.dev.token";
const TABS_KEY = "tether.dev.tabs";
const HOST = { id: "dev", name: "dev", enrolled: true };
const VIEWPORT: Viewport = {
  width: 390,
  height: 700,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  keyboard: false,
  collapsedHeight: 700,
  reason: "initial",
};

const KEYS: Record<string, string> = {
  Enter: "Enter",
  Backspace: "BSpace",
  Tab: "Tab",
  Escape: "Escape",
  Delete: "DC",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Home: "Home",
  End: "End",
  PageUp: "PPage",
  PageDown: "NPage",
};

/** One DOM key press as the bridge `input` event native would send; null if it has none. */
export function toInput(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey">): InputEvent | null {
  if (e.metaKey) return null;
  const named = KEYS[e.key];
  if (named) {
    const prefix = (e.ctrlKey ? "C-" : "") + (e.altKey ? "M-" : "");
    return { key: e.key === "Tab" && e.shiftKey ? "BTab" : prefix + named };
  }
  if (Array.from(e.key).length !== 1) return null; // Shift, F-keys and the rest
  if (e.ctrlKey) return { key: `C-${e.key.toLowerCase()}` };
  if (e.altKey) return { key: `M-${e.key}` };
  return { text: e.key };
}

function deliver(...messages: NativeMsg[]): void {
  (window as unknown as { __tether?: { receive(m: NativeMsg[]): void } }).__tether?.receive(messages);
}

/** The device token from `tether device add`: pasted once, then kept. `#token=…` skips the prompt. */
function loadToken(): string | null {
  const hash = /^#token=(.+)$/.exec(location.hash);
  if (hash?.[1]) {
    localStorage.setItem(TOKEN_KEY, hash[1]);
    history.replaceState(null, "", location.pathname + location.search);
  }
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored) return stored;
  const typed = window.prompt("Device token from `tether device add <name>`:")?.trim();
  if (!typed) return null;
  localStorage.setItem(TOKEN_KEY, typed);
  return typed;
}

function mountInput(): void {
  const app = document.getElementById("app");
  if (app) {
    app.style.width = `${String(VIEWPORT.width)}px`;
    app.style.height = `${String(VIEWPORT.height)}px`;
    app.style.outline = "1px solid #444";
  }
  const input = document.createElement("textarea");
  input.id = "dev-input";
  input.placeholder = "dev keyboard: type here, keys go to the terminal";
  input.rows = 2;
  input.style.cssText = `display:block;width:${String(VIEWPORT.width)}px;margin-top:8px;background:#111;color:#ddd;border:1px solid #444`;
  input.addEventListener("keydown", (e) => {
    const event = toInput(e);
    if (!event) return;
    e.preventDefault();
    deliver({ type: "input", events: [event] });
  });
  // Text that arrives without a keydown (dictation, drag and drop, automation) is forwarded too.
  input.addEventListener("input", () => {
    if (input.value) deliver({ type: "input", events: [{ text: input.value }] });
    input.value = "";
  });
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData("text");
    if (text) deliver({ type: "input", events: [{ paste: text }] });
  });
  document.body.append(input);
}

/** The bridge `Post` for a page with no native app around it. */
export function createDevShim(): Post {
  let token = loadToken();
  mountInput();
  return (msg) => {
    switch (msg.type) {
      case "ready": {
        const raw = localStorage.getItem(TABS_KEY);
        const boot: Boot = {
          bridgeVersion: BRIDGE_VERSION,
          hosts: [HOST],
          tabs: raw ? (JSON.parse(raw) as SavedTab[]) : [],
          settings: {},
          viewport: VIEWPORT,
          locked: false,
        };
        return Promise.resolve(boot);
      }
      case "token": {
        const reply: TokenReply = token ? { token } : { notEnrolled: true };
        return Promise.resolve(reply);
      }
      case "hostRejected":
        // Forget the token so the next load asks again.
        localStorage.removeItem(TOKEN_KEY);
        token = null;
        return Promise.resolve();
      case "saveTabs":
        localStorage.setItem(TABS_KEY, JSON.stringify(msg.tabs));
        return Promise.resolve();
      default:
        return Promise.resolve();
    }
  };
}
