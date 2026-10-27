// Assembles the native Platform (client-architecture.md §5, ios-shell.md "The bridge"). Only
// main.tsx imports this. Native owns the responder, tokens, drafts, uploads and the
// pasteboard; this adapter forwards to the bridge and turns its events into PlatformEvents.
import { Bridge, installReceiver, webkitPost, type Post } from "./bridge";
import { createNativeTransport } from "./transport";
import { createNativeUploads } from "./uploads";
import type { BootResult, Platform, PlatformEvent, SavedWorkspace } from "../types";

const EMPTY_WORKSPACE: SavedWorkspace = { version: 2, tabs: [], active: null, files: null };

export function createNativePlatform(post: Post = webkitPost): Platform {
  const bridge = new Bridge(post);
  const uploads = createNativeUploads(bridge);
  const listeners = new Set<(event: PlatformEvent) => void>();
  let booted = false;
  let pending: SavedWorkspace | null = null;

  const emit = (event: PlatformEvent): void => {
    for (const l of [...listeners]) l(event);
  };

  // Install before `ready`; its reply snapshots the current line before the app owner subscribes.
  installReceiver((msg) => {
    switch (msg.type) {
      case "upload": uploads.receive(msg); break;
      // Before `ready` replies the page isn't listening, and the reply is newer than these.
      case "input": if (booted) emit({ type: "input", tab: msg.tab, events: msg.events }); break;
      case "lineEdit": emit(msg); break;
      case "lineReturn": emit(msg); break;
      default: if (booted) emit(msg); // hosts, viewport, lifecycle
    }
  });

  return {
    async boot(): Promise<BootResult> {
      const boot = await bridge.ready();
      booted = true;
      return boot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    transport: createNativeTransport(bridge),
    input: {
      setFocus: (mode) => { bridge.setFocus(mode); },
      setLine: (text, caret, tab) => bridge.setLine(text, caret, tab),
      setLineCaret: (index) => { bridge.lineCaret(index); },
      insertLine: (text) => { bridge.lineInsert(text); },
      selectAllLine: () => { bridge.lineSelectAll(); },
      setArmedModifier: (armed) => { bridge.modifiers(armed); },
      setActiveTab: (tab) => { bridge.activeTab(tab); },
    },
    storage: {
      saveWorkspace(ws) {
        const scheduled = pending !== null;
        pending = ws;
        if (!scheduled) queueMicrotask(() => { if (pending) bridge.saveWorkspace(pending); pending = null; });
      },
      drafts: {
        get: (key) => bridge.draftGet(key),
        put: (record, baseRevision) => bridge.draftPut(record, baseRevision).catch(() => "failed" as const),
        delete: (key) => bridge.draftDelete(key),
        list: () => bridge.draftList(),
      },
      async clearLocalData() {
        const records = await bridge.draftList();
        await Promise.all(records.map((r) => bridge.draftDelete(r.key)));
        bridge.saveWorkspace(EMPTY_WORKSPACE);
      },
    },
    uploads,
    clipboard: {
      writeText: (text) => bridge.copy(text).then(() => "ok" as const, () => "denied" as const),
      read: (tab) => bridge.readPasteboard(tab, crypto.randomUUID()).catch(() => "denied" as const),
    },
    openURL: (url) => { bridge.openURL(url); },
    playVideo: (handle, path) => {
      bridge.playVideo(handle, path);
      return "handled";
    },
    haptic: (kind) => { bridge.haptic(kind); },
    restart: () => { bridge.recreateWebView(); },
    manageHosts: () => { bridge.manageHosts(); },
  };
}
