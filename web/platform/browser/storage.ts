// Browser storage (client-architecture.md §5.6): one IndexedDB database, `tether`, schema
// version 1, two stores. `workspace` holds the one saved workspace; `drafts` is keyed by
// tab key. Every write is one small record. A page writes its workspace only while it has
// focus, so the saved workspace is the one from the page used last.
import { tabId } from "../tabKey";
import type { DraftRecord, DraftStore, PlatformEvent, PlatformStorage, SavedWorkspace, TabKey } from "../types";

const DB_NAME = "tether";
const DB_VERSION = 1;
const WORKSPACE_KEY = "workspace";
const CHANNEL = "tether";

export interface BrowserStorage {
  storage: PlatformStorage;
  /** The saved workspace, read once at boot. */
  loadWorkspace(): Promise<SavedWorkspace | null>;
  /** Starts the cross-page listeners: `versionchange`, the draft channel, and focus. */
  start(emit: (event: PlatformEvent) => void): () => void;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error("indexedDB request failed")); };
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error("indexedDB transaction failed")); };
    tx.onabort = () => { reject(tx.error ?? new Error("indexedDB transaction aborted")); };
  });
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null); // no IndexedDB here (private mode, an old WebView): memory only
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("workspace")) db.createObjectStore("workspace");
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { resolve(null); };
    req.onblocked = () => { resolve(null); };
  });
}

export function createBrowserStorage(): BrowserStorage {
  const dbReady = openDb();
  /** Used when IndexedDB is unavailable, or after `storage: closed`. */
  const memory = { drafts: new Map<string, DraftRecord>() };
  let closed = false;
  let persistAsked = false;
  let pending: SavedWorkspace | null = null;
  let flushQueued = false;
  let emitEvent: (event: PlatformEvent) => void = () => undefined;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;

  const db = async (): Promise<IDBDatabase | null> => (closed ? null : dbReady);

  async function flushWorkspace(): Promise<void> {
    const ws = pending;
    pending = null;
    if (!ws) return;
    const handle = await db();
    if (!handle) return;
    try {
      const tx = handle.transaction("workspace", "readwrite");
      tx.objectStore("workspace").put(ws, WORKSPACE_KEY);
      await done(tx);
    } catch {
      // A failed write keeps the workspace in memory; the next change tries again.
    }
  }

  const drafts: DraftStore = {
    async get(key) {
      const handle = await db();
      if (!handle) return memory.drafts.get(tabId(key)) ?? null;
      return ((await request(handle.transaction("drafts").objectStore("drafts").get(tabId(key)))) as DraftRecord | undefined) ?? null;
    },
    async put(record, baseRevision) {
      if (!persistAsked) {
        persistAsked = true;
        // Asked once, on the first draft; the client promises nothing about the answer.
        try {
          void navigator.storage.persist().catch(() => false);
        } catch {
          // no Storage API here
        }
      }
      const id = tabId(record.key);
      const handle = await db();
      if (!handle) {
        const stored = memory.drafts.get(id);
        if (stored && stored.revision > baseRevision) return "conflict";
        memory.drafts.set(id, record);
        return "ok";
      }
      try {
        // Read and write in one transaction: no other page can slip between the check and the write.
        const tx = handle.transaction("drafts", "readwrite");
        const store = tx.objectStore("drafts");
        const stored = (await request(store.get(id))) as DraftRecord | undefined;
        if (stored && stored.revision > baseRevision) return "conflict";
        store.put(record, id);
        await done(tx);
      } catch {
        return "failed";
      }
      channel?.postMessage({ draft: id, key: record.key });
      return "ok";
    },
    async delete(key) {
      const id = tabId(key);
      memory.drafts.delete(id);
      const handle = await db();
      if (!handle) return;
      const tx = handle.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete(id);
      await done(tx);
      channel?.postMessage({ draft: id, key });
    },
    async list() {
      const handle = await db();
      if (!handle) return [...memory.drafts.values()];
      return (await request(handle.transaction("drafts").objectStore("drafts").getAll())) as DraftRecord[];
    },
  };

  const storage: PlatformStorage = {
    saveWorkspace(ws) {
      pending = ws;
      // Only the page in use writes; one that gains focus writes once more.
      // One transaction per tick however many changes land in it: the latest wins.
      if (document.hasFocus() && !flushQueued) {
        flushQueued = true;
        queueMicrotask(() => {
          flushQueued = false;
          void flushWorkspace();
        });
      }
    },
    drafts,
    async clearLocalData() {
      memory.drafts.clear();
      pending = null;
      const handle = await db();
      if (!handle) return;
      const tx = handle.transaction(["workspace", "drafts"], "readwrite");
      tx.objectStore("workspace").clear();
      tx.objectStore("drafts").clear();
      await done(tx);
    },
  };

  return {
    storage,
    async loadWorkspace() {
      const handle = await dbReady;
      if (!handle) return null;
      try {
        const ws = (await request(handle.transaction("workspace").objectStore("workspace").get(WORKSPACE_KEY))) as SavedWorkspace | undefined;
        return ws?.version === 1 ? ws : null;
      } catch {
        return null;
      }
    },
    start(emit) {
      emitEvent = emit;
      void dbReady.then((handle) => {
        if (!handle) return;
        // A later build upgrading the schema is blocked until this page lets go: persist, close, say so.
        handle.onversionchange = () => {
          emitEvent({ type: "storage", state: "closing" });
          void flushWorkspace().then(() => {
            closed = true;
            handle.close();
            emitEvent({ type: "storage", state: "closed" });
          });
        };
      });
      const onMessage = (ev: MessageEvent<unknown>): void => {
        // The key travels with the message: a deleted draft is no longer in the store to look up.
        const data = ev.data as { draft?: unknown; key?: TabKey } | null;
        if (typeof data?.draft !== "string" || !data.key || tabId(data.key) !== data.draft) return; // any other message belongs to another build
        emitEvent({ type: "draftChanged", key: data.key });
      };
      channel?.addEventListener("message", onMessage);
      const onFocus = (): void => { void flushWorkspace(); };
      addEventListener("focus", onFocus);
      return () => {
        channel?.removeEventListener("message", onMessage);
        removeEventListener("focus", onFocus);
      };
    },
  };
}
