// Desktop dev mode: stands in for native so the real web UI runs in a desktop browser
// against a local daemon (web/README.md). Imported only under `import.meta.env.DEV`, so
// no build carries it.
import type { Boot, HostEntry, InputEvent, NativeMsg, Post, SavedTab, TokenReply, Viewport } from "../native/bridge";
import { BRIDGE_VERSION } from "../native/bridge";
import { encodePath } from "../files/api";

const TOKEN_KEY = "tether.dev.token";
const TABS_KEY = "tether.dev.tabs";
const ACTIVE_KEY = "tether.dev.active";
// The Vite proxy on the page's own origin forwards to the daemon.
const HOST: HostEntry = { id: "dev", name: "dev", baseURL: location.origin, enrolled: true };

/**
 * The phone's geometry, from the query string so screenshots can match a device:
 * `?w=393&h=852&safe=59,0,34,0` (top, right, bottom, left), and `kb=`, the height the
 * keyboard and native's accessory take from the web view. Defaults to an iPhone in
 * portrait; `kb` defaults to an iPhone's keyboard with the compose field and key row.
 */
function devGeometry(): { viewport: Viewport; keyboardHeight: number } {
  const query = new URLSearchParams(location.search);
  const num = (key: string, fallback: number): number => Number(query.get(key) ?? fallback) || fallback;
  const [top = 0, right = 0, bottom = 0, left = 0] = (query.get("safe") ?? "59,0,34,0").split(",").map(Number);
  const width = num("w", 393);
  const height = num("h", 852);
  return {
    viewport: { width, height, safeArea: { top, right, bottom, left }, keyboard: false, collapsedHeight: height, reason: "initial" },
    keyboardHeight: num("kb", height > width ? 424 : 244),
  };
}
const { viewport: VIEWPORT, keyboardHeight: KEYBOARD_HEIGHT } = devGeometry();

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

/**
 * The Vite proxy turns this cookie into the `Authorization: Bearer` native's scheme handler
 * would add to `/fs/*` and `/complete` requests (vite.config.ts), so `<img src>` works as in
 * the app. One cookie per path: the socket and `/auth` never carry it.
 */
function shareToken(token: string | null): void {
  for (const path of ["/fs", "/complete"]) {
    document.cookie = token
      ? `tether_dev_token=${encodeURIComponent(token)}; path=${path}; SameSite=Strict`
      : `tether_dev_token=; path=${path}; max-age=0`;
  }
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

/**
 * What native does on `focus`: end the web view at the top of the keyboard, or give it the
 * whole screen back, and report the new geometry. tmux's size stays; the terminal pans.
 */
function showKeyboard(shown: boolean): void {
  const app = document.getElementById("app");
  const keyboard = document.getElementById("dev-keyboard");
  const height = VIEWPORT.height - (shown ? KEYBOARD_HEIGHT : 0);
  if (app) app.style.height = `${String(height)}px`;
  if (keyboard) keyboard.style.display = shown ? "grid" : "none";
  deliver({ type: "viewport", ...VIEWPORT, height, keyboard: shown, reason: "keyboard" });
}

function mountInput(): void {
  const app = document.getElementById("app");
  if (app) {
    app.style.width = `${String(VIEWPORT.width)}px`;
    app.style.height = `${String(VIEWPORT.height)}px`;
    app.style.outline = "1px solid #444";
  }
  // Stands in for the iOS keyboard and native's accessory below the web view.
  const keyboard = document.createElement("div");
  keyboard.id = "dev-keyboard";
  keyboard.textContent = "keyboard + accessory (native)";
  keyboard.style.cssText = `display:none;width:${String(VIEWPORT.width)}px;height:${String(KEYBOARD_HEIGHT)}px;place-items:center;box-sizing:border-box;background:#2a2d33;color:#888;font:13px system-ui;outline:1px solid #444`;
  // Native's key row ends in the hide-keyboard key; here the whole block is that key.
  keyboard.title = "Hide the keyboard";
  keyboard.style.cursor = "pointer";
  keyboard.addEventListener("click", () => { showKeyboard(false); });
  app?.after(keyboard);
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
  keyboard.after(input);
}

/**
 * What native's photo menu and `Uploader` do (ios-shell.md "Files and sharing"): pick a
 * file, post it to `/fs/upload` for the tab on screen, and report through `upload`.
 */
function pickAndUpload(): void {
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  picker.addEventListener("change", () => {
    const file = picker.files?.[0];
    const target = (window as unknown as { __tether?: { activeTab(): { host: string; tab: string } } }).__tether?.activeTab();
    if (!file || !target) return;
    const id = `dev-${String(Date.now())}`;
    const report = (rest: { progress: number; path?: string; error?: string }): void => { deliver({ type: "upload", id, ...target, ...rest }); };
    report({ progress: 0 });
    fetch(`/fs/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }).then(
      async (res) => {
        const body = (await res.json()) as { path?: string; error?: string };
        report(body.path ? { progress: 1, path: body.path } : { progress: 0, error: body.error ?? String(res.status) });
      },
      (error: unknown) => { report({ progress: 0, error: String(error) }); },
    );
  });
  picker.click();
}

/** The bridge `Post` for a page with no native app around it. */
export function createDevShim(): Post {
  let token = loadToken();
  shareToken(token);
  mountInput();
  return (msg) => {
    switch (msg.type) {
      case "ready": {
        const raw = localStorage.getItem(TABS_KEY);
        const boot: Boot = {
          bridgeVersion: BRIDGE_VERSION,
          hosts: [HOST],
          tabs: raw ? (JSON.parse(raw) as SavedTab[]) : [],
          active: localStorage.getItem(ACTIVE_KEY),
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
        shareToken(null);
        return Promise.resolve();
      case "focus":
        setTimeout(() => { showKeyboard(msg.mode === "terminal"); }, 0);
        return Promise.resolve();
      case "prompt":
        return Promise.resolve(window.prompt(`${msg.title}\n${msg.message}`, msg.initial));
      case "pickMedia":
        pickAndUpload();
        return Promise.resolve();
      case "playVideo":
        // No AVPlayer here: the browser's own player, through the proxy.
        window.open(`/fs/raw${encodePath(msg.path)}`, "_blank", "noopener");
        return Promise.resolve();
      case "openURL":
        window.open(msg.url, "_blank", "noopener");
        return Promise.resolve();
      case "saveTabs":
        localStorage.setItem(TABS_KEY, JSON.stringify(msg.tabs));
        if (msg.active === null) localStorage.removeItem(ACTIVE_KEY);
        else localStorage.setItem(ACTIVE_KEY, msg.active);
        return Promise.resolve();
      default:
        return Promise.resolve();
    }
  };
}
