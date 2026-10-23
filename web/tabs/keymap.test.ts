import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decideKey, type KeyDecision, type KeyFacts, type KeyMode } from "./keymap";

/** The names the clients may send, shared with the daemon's own test of `is_key_name`. */
const KEYS = new Set(JSON.parse(readFileSync(new URL("../../tests/fixtures/proto/keys.json", import.meta.url), "utf8")) as string[]);

/** The daemon's allowlist, as written beside `is_key_name` in src/tmux/command.rs. */
const ALLOWED = /^(?:[CM]-)*(?:(?:S-)?(?:Up|Down|Left|Right|Home|End|PageUp|PageDown|IC|DC|F(?:[1-9]|1[0-2]))|[A-Za-z0-9]|Enter|Escape|Tab|BTab|BSpace|Space)$/;

const ev = (key: string, over: Partial<KeyFacts> = {}): KeyFacts => ({
  type: "keydown",
  key,
  code: "",
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  isComposing: false,
  keyCode: 0,
  ...over,
});

const name = (d: KeyDecision): string | undefined => (d.kind === "key" ? d.name : undefined);

describe("decideKey, desktop", () => {
  it("routes arrows, navigation keys and F-keys by tmux name, with C-, M- and S- modifiers", () => {
    expect(name(decideKey(ev("ArrowUp"), "xterm"))).toBe("Up");
    expect(name(decideKey(ev("ArrowLeft", { ctrlKey: true }), "xterm"))).toBe("C-Left");
    expect(name(decideKey(ev("ArrowRight", { altKey: true, shiftKey: true }), "xterm"))).toBe("M-S-Right");
    expect(name(decideKey(ev("Insert"), "xterm"))).toBe("IC");
    expect(name(decideKey(ev("Delete", { shiftKey: true }), "xterm"))).toBe("S-DC");
    expect(name(decideKey(ev("PageDown"), "xterm"))).toBe("PageDown");
    expect(name(decideKey(ev("F9", { ctrlKey: true, altKey: true }), "xterm"))).toBe("C-M-F9");
  });

  it("routes Escape and Tab, dropping Shift where the daemon's allowlist does not take it", () => {
    expect(name(decideKey(ev("Escape"), "xterm"))).toBe("Escape");
    expect(name(decideKey(ev("Escape", { shiftKey: true }), "xterm"))).toBe("Escape");
    expect(name(decideKey(ev("Tab"), "xterm"))).toBe("Tab");
    expect(name(decideKey(ev("Tab", { shiftKey: true }), "xterm"))).toBe("BTab");
    expect(name(decideKey(ev("Tab", { altKey: true }), "xterm"))).toBe("M-Tab");
  });

  it("sends Shift+Enter as CSI-u bytes, and plain Enter to xterm", () => {
    const shifted = decideKey(ev("Enter", { shiftKey: true }), "xterm");
    expect(shifted.kind === "bytes" && atob(shifted.bytes)).toBe("\x1b[13;2u");
    expect(decideKey(ev("Enter"), "xterm")).toEqual({ kind: "default" });
  });

  it("leaves printable text, Ctrl-letters and Backspace to xterm's own encoding", () => {
    expect(decideKey(ev("a"), "xterm")).toEqual({ kind: "default" });
    expect(decideKey(ev("c", { ctrlKey: true }), "xterm")).toEqual({ kind: "default" });
    expect(decideKey(ev("Backspace"), "xterm")).toEqual({ kind: "default" });
  });

  it("keeps the browser's shortcuts: Cmd combinations, F5, F6, F11, F12, Ctrl+Shift+V", () => {
    for (const key of ["F5", "F6", "F11", "F12"]) expect(decideKey(ev(key), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("F5", { ctrlKey: true }), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("t", { metaKey: true }), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("ArrowLeft", { metaKey: true }), "xterm")).toEqual({ kind: "browser" });
    expect(decideKey(ev("V", { ctrlKey: true, shiftKey: true }), "xterm")).toEqual({ kind: "browser" });
  });

  it("copies on Ctrl+Shift+C", () => {
    expect(decideKey(ev("C", { ctrlKey: true, shiftKey: true }), "xterm")).toEqual({ kind: "copy" });
  });

  it("does nothing while an IME composes, however the browser reports it", () => {
    expect(decideKey(ev("ArrowDown", { isComposing: true }), "xterm")).toEqual({ kind: "composing" });
    expect(decideKey(ev("Process", { keyCode: 229 }), "xterm")).toEqual({ kind: "composing" });
    expect(decideKey(ev("Enter", { isComposing: true, shiftKey: true }), "xterm")).toEqual({ kind: "composing" });
  });
});

describe("decideKey, owned input", () => {
  it("names Ctrl and Alt chords from the physical key, so Option's characters and Shift's case don't leak in", () => {
    expect(name(decideKey(ev("c", { ctrlKey: true, code: "KeyC" }), "owned"))).toBe("C-c");
    expect(name(decideKey(ev("X", { ctrlKey: true, shiftKey: true, code: "KeyX" }), "owned"))).toBe("C-x");
    expect(name(decideKey(ev("å", { altKey: true, code: "KeyA" }), "owned"))).toBe("M-a");
    expect(name(decideKey(ev("A", { altKey: true, shiftKey: true, code: "KeyA" }), "owned"))).toBe("M-A");
    expect(name(decideKey(ev("2", { altKey: true, code: "Digit2" }), "owned"))).toBe("M-2");
    expect(name(decideKey(ev("x", { ctrlKey: true, altKey: true, code: "KeyX" }), "owned"))).toBe("C-M-x");
    expect(name(decideKey(ev(" ", { ctrlKey: true }), "owned"))).toBe("C-Space");
    expect(name(decideKey(ev("Backspace", { altKey: true }), "owned"))).toBe("M-BSpace");
    expect(name(decideKey(ev("Enter", { altKey: true }), "owned"))).toBe("M-Enter");
  });

  it("leaves plain printable keys to beforeinput, and still routes the named keys", () => {
    expect(decideKey(ev("a", { code: "KeyA" }), "owned")).toEqual({ kind: "default" });
    expect(decideKey(ev("Backspace"), "owned")).toEqual({ kind: "default" });
    expect(name(decideKey(ev("ArrowUp"), "owned"))).toBe("Up");
    expect(name(decideKey(ev("Escape"), "owned"))).toBe("Escape");
  });

  it("does not name punctuation the daemon would refuse", () => {
    expect(decideKey(ev("[", { ctrlKey: true, code: "BracketLeft" }), "owned")).toEqual({ kind: "default" });
  });
});

describe("every name the handler can produce is in keys.json and the daemon's allowlist", () => {
  const keys = [
    ..."abcdefghijklmnopqrstuvwxyz".split("").map((k) => ev(k, { code: `Key${k.toUpperCase()}` })),
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((k) => ev(k, { code: `Key${k}`, shiftKey: true })),
    ..."0123456789".split("").map((k) => ev(k, { code: `Digit${k}` })),
    ...["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Insert", "Delete", "Escape", "Tab", "Enter", "Backspace", " "].map((k) => ev(k)),
    ...Array.from({ length: 12 }, (_, i) => ev(`F${String(i + 1)}`)),
  ];
  const modes: KeyMode[] = ["xterm", "owned"];
  const names = new Set<string>();
  for (const mode of modes) {
    for (const base of keys) {
      for (let bits = 0; bits < 8; bits++) {
        const d = decideKey({ ...base, ctrlKey: (bits & 1) !== 0, altKey: (bits & 2) !== 0, shiftKey: base.shiftKey || (bits & 4) !== 0 }, mode);
        if (d.kind === "key") names.add(d.name);
      }
    }
  }

  it("passes the daemon's regex", () => {
    for (const n of names) expect(ALLOWED.test(n), n).toBe(true);
  });

  it("is listed in keys.json, which the Rust tests check", () => {
    expect([...names].filter((n) => !KEYS.has(n)).sort()).toEqual([]);
  });
});
