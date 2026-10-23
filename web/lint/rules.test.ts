// Every architecture rule fails on a seeded violation, and passes where its exemption says it
// may (client-architecture.md §3.3). The cases lint source text under a virtual path, with the
// real rule blocks and no type information, which none of the rules need.
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import { rules } from "./rules.js";

const eslint = new ESLint({
  cwd: new URL("..", import.meta.url).pathname,
  overrideConfigFile: true,
  overrideConfig: [{ files: ["**/*.ts", "**/*.tsx"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } }, ...rules],
});

async function lint(path: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path });
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? "parse"}: ${m.message}`);
}

const failsWith = async (path: string, code: string, rule: string, text?: string): Promise<void> => {
  const messages = await lint(path, code);
  expect(messages.some((m) => m.startsWith(rule) && (text === undefined || m.includes(text))), messages.join("\n") || "no messages").toBe(true);
};

describe("rule 1: raw form controls only in primitives and the input owners", () => {
  const screen = "screens/home/Bad.tsx";
  it.each([
    ["a <button>", "export const A = () => <button>x</button>;"],
    ["an <input>", "export const A = () => <input />;"],
    ["a <textarea>", "export const A = () => <textarea />;"],
    ["a <select>", "export const A = () => <select />;"],
    ["contenteditable", "export const A = () => <div contentEditable />;"],
    ["createElement('input')", "export const a = document.createElement('input');"],
  ])("fails on %s in a screen", async (_name, code) => {
    await failsWith(screen, code, "no-restricted-syntax");
  });
  it.each([
    ["ui/primitives/Button.tsx", "export const A = () => <button>x</button>;"],
    ["term/xterm-input.ts", "export const a = document.createElement('textarea');"],
    ["touch/owned-input.ts", "export const a = document.createElement('textarea');"],
    ["platform/browser/uploads.ts", "export const a = document.createElement('input');"],
  ])("allows it in %s", async (path, code) => {
    expect(await lint(path, code)).toEqual([]);
  });
});

describe("rule 2: only app/focus.ts moves focus", () => {
  it.each([
    ["focus()", "el.focus();"],
    ["blur()", "document.activeElement?.blur();"],
  ])("fails on %s outside app/focus.ts", async (_name, code) => {
    await failsWith("screens/terminal/Bad.tsx", `declare const el: HTMLElement; ${code}`, "no-restricted-syntax", "app/focus.ts");
    await failsWith("ui/primitives/Bad.tsx", `declare const el: HTMLElement; ${code}`, "no-restricted-syntax", "app/focus.ts");
  });
  it("allows it in app/focus.ts", async () => {
    expect(await lint("app/focus.ts", "declare const el: HTMLElement; el.focus(); el.blur();")).toEqual([]);
  });
});

describe("rule 3: environment globals only in platform/", () => {
  const screen = "screens/home/Bad.tsx";
  it.each([
    ["a bare visualViewport", "visualViewport?.height;", "no-restricted-globals"],
    ["a bare indexedDB", "indexedDB.open('x');", "no-restricted-globals"],
    ["a bare localStorage", "localStorage.getItem('x');", "no-restricted-globals"],
    ["a bare navigator", "navigator.onLine;", "no-restricted-globals"],
    ["a bare matchMedia", "matchMedia('(pointer: fine)');", "no-restricted-globals"],
    ["a bare open", "open('https://x');", "no-restricted-globals"],
    ["a bare BroadcastChannel", "new BroadcastChannel('x');", "no-restricted-globals"],
    ["window.visualViewport", "window.visualViewport;", "no-restricted-properties"],
    ["globalThis.indexedDB", "globalThis.indexedDB;", "no-restricted-properties"],
    ["self.navigator", "self.navigator;", "no-restricted-properties"],
    ["window.matchMedia", "window.matchMedia('x');", "no-restricted-properties"],
    ["document.visibilityState", "document.visibilityState;", "no-restricted-properties"],
    ["document.hasFocus", "document.hasFocus();", "no-restricted-properties"],
    ["window.webkit", "(window as any).webkit;", "no-restricted-syntax"],
    ["any .webkit member", "(thing as any).webkit.messageHandlers;", "no-restricted-syntax"],
    ["destructuring from window", "const { navigator: n } = window;", "no-restricted-syntax"],
    ["destructuring from globalThis", "const { indexedDB: db } = globalThis;", "no-restricted-syntax"],
    ["destructuring from self", "const { localStorage: ls } = self;", "no-restricted-syntax"],
  ])("fails on %s", async (_name, code, rule) => {
    await failsWith(screen, code, rule);
  });
  it("allows all of it in platform/", async () => {
    const code = "visualViewport?.height; window.navigator; const { indexedDB: db } = window; (window as any).webkit; document.visibilityState;";
    expect(await lint("platform/browser/viewport.ts", code)).toEqual([]);
  });
  it("does not flag a local named open", async () => {
    expect(await lint(screen, "const open = true; export const o = open;")).toEqual([]);
  });
});

describe("rule 4: import boundaries", () => {
  it("only main.tsx imports a platform implementation", async () => {
    await failsWith("screens/home/Bad.tsx", "import { createBrowserPlatform } from '../../platform/browser';", "no-restricted-imports", "main.tsx");
    await failsWith("app/Bad.ts", "import x from '../platform/native/bridge';", "no-restricted-imports", "main.tsx");
    expect(await lint("main.tsx", "import { createBrowserPlatform } from './platform/browser';")).toEqual([]);
  });
  it("only tests and harness/ import platform/test", async () => {
    await failsWith("screens/home/Bad.tsx", "import { createTestPlatform } from '../../platform/test';", "no-restricted-imports", "platform/test");
    await failsWith("main.tsx", "import { createTestPlatform } from './platform/test';", "no-restricted-imports", "platform/test");
    expect(await lint("harness/index.ts", "import { createTestPlatform } from '../platform/test';")).toEqual([]);
    expect(await lint("app/controller.test.ts", "import { createTestPlatform } from '../platform/test';")).toEqual([]);
  });
  it("only term/ imports xterm", async () => {
    await failsWith("screens/terminal/Bad.tsx", "import { Terminal } from '@xterm/xterm';", "no-restricted-imports", "term/");
    expect(await lint("term/xterm.ts", "import { Terminal } from '@xterm/xterm';")).toEqual([]);
  });
});

describe("rule 5: sans-IO cores have no Preact, window or document", () => {
  it.each(["workspace/Bad.ts", "sessions/Bad.ts", "drafts/Bad.ts", "tabs/Bad.ts", "net/admission.ts", "touch/gesture.ts"])("fails in %s", async (path) => {
    await failsWith(path, "import { useState } from 'preact/hooks';", "no-restricted-imports", "sans-IO");
    await failsWith(path, "import { h } from 'preact';", "no-restricted-imports", "sans-IO");
    await failsWith(path, "window.addEventListener('x', () => undefined);", "no-restricted-globals", "sans-IO");
    await failsWith(path, "document.title;", "no-restricted-globals", "sans-IO");
  });
  it("lets other net/ files and files/render use the DOM", async () => {
    expect(await lint("net/hosts.ts", "document.title;")).toEqual([]);
    expect(await lint("files/render/markdown.ts", "document.createElement('div');")).toEqual([]);
  });
});
