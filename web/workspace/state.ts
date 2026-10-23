// The workspace core (client-architecture.md §6.1): a pure reducer over the open tabs and
// nothing else. Events in; state and effects out. No Preact, no window, no document.
import { tabId } from "../platform/tabKey";
import type { TabKey, SavedWorkspace } from "../platform/types";
import type { TmuxListing, WindowRef } from "../proto/generated/messages";


export interface Tab {
  id: string;
  key: TabKey;
  session: string;
  /** The window's name. */
  window: string;
  /** The tmux window index; null for a tab restored before any listing. */
  index: number | null;
  /** Restored from a saved workspace and not yet proved by a `watching` reply or a listing. */
  restoring: boolean;
}

export interface WorkspaceState {
  /** In strip order. */
  tabs: Tab[];
  /** The active tab's id. */
  active: string | null;
  /** From `navigated` only; never set any other way. */
  onTerminal: boolean;
}

export type WorkspaceEvent =
  | { type: "restored"; saved: SavedWorkspace | null }
  /** The hosts whose `hostId` is known. `complete` once every host's id is known: saved tabs of any other host are discarded. */
  | { type: "hostsKnown"; ids: string[]; complete: boolean }
  | { type: "opened"; key: TabKey; session: string; window: string; index: number | null }
  | { type: "closed"; id: string }
  | { type: "activated"; id: string }
  /** A host's authoritative reply to `listSessions`. */
  | { type: "listing"; hostId: string; listing: TmuxListing | null }
  | { type: "windowClosed"; id: string }
  | { type: "serverExited"; hostId: string; server: string }
  | { type: "renamed"; hostId: string; window: WindowRef; name: string }
  | { type: "navigated"; onTerminal: boolean }
  /** The daemon found the window: the tab is live. */
  | { type: "watching"; id: string };

export type WorkspaceEffect =
  | { type: "cover"; id: string }
  | { type: "uncover"; id: string }
  | { type: "save" }
  /** Move focus on the user's behalf (desktop): to the terminal, or to Home's search. */
  | { type: "focus"; target: "terminal" | "homeSearch" }
  | { type: "notice"; text: string };

export const initialWorkspace: WorkspaceState = { tabs: [], active: null, onTerminal: false };

/** The tab whose watch runs: only the active tab, and only on the Terminal destination. */
export function shownTab(state: WorkspaceState): string | null {
  return state.onTerminal ? state.active : null;
}

/** `<endpoint>:<pid>-<start>`: the same endpoint with another run is a restarted tmux. */
function endpointOf(server: string): string {
  return server.slice(0, Math.max(0, server.lastIndexOf(":")));
}

function splitLabel(label: string): { session: string; window: string } {
  const at = label.lastIndexOf(" / ");
  return at < 0 ? { session: label, window: "" } : { session: label.slice(0, at), window: label.slice(at + 3) };
}

function plural(n: number): string {
  return `${String(n)} ${n === 1 ? "tab" : "tabs"}`;
}

/** Removes `ids`, moving `active` to the right neighbour, else the left, of the removed active tab. */
function without(state: WorkspaceState, ids: Set<string>): WorkspaceState {
  const tabs = state.tabs.filter((t) => !ids.has(t.id));
  let { active } = state;
  if (active !== null && ids.has(active)) {
    const at = state.tabs.findIndex((t) => t.id === active);
    const after = state.tabs.slice(at + 1).find((t) => !ids.has(t.id));
    const before = state.tabs.slice(0, at).reverse().find((t) => !ids.has(t.id));
    active = (after ?? before)?.id ?? null;
  }
  return { ...state, tabs, active };
}

function step(state: WorkspaceState, event: WorkspaceEvent): { state: WorkspaceState; notices: string[]; focus?: "terminal" | "homeSearch" } {
  const none = { state, notices: [] as string[] };
  switch (event.type) {
    case "restored": {
      const saved = event.saved;
      if (!saved) return none;
      const tabs = saved.tabs.map(({ key, label }): Tab => ({ id: tabId(key), key, ...splitLabel(label), index: null, restoring: true }));
      const active = tabs.some((t) => t.id === saved.active) ? saved.active : (tabs[0]?.id ?? null);
      return { state: { ...state, tabs, active }, notices: [] };
    }
    case "hostsKnown": {
      if (!event.complete) return none;
      const known = new Set(event.ids);
      const gone = new Set(state.tabs.filter((t) => t.restoring && !known.has(t.key.host)).map((t) => t.id));
      return gone.size ? { state: without(state, gone), notices: [] } : none;
    }
    case "opened": {
      const id = tabId(event.key);
      const open = state.tabs.find((t) => t.id === id);
      // Opening a window that already has a tab activates that tab.
      if (open) return { state: { ...state, active: id }, notices: [], focus: "terminal" };
      const tab: Tab = { id, key: event.key, session: event.session, window: event.window, index: event.index, restoring: false };
      return { state: { ...state, tabs: [...state.tabs, tab], active: id }, notices: [], focus: "terminal" };
    }
    case "activated":
      return state.tabs.some((t) => t.id === event.id) && state.active !== event.id
        ? { state: { ...state, active: event.id }, notices: [], focus: "terminal" }
        : none;
    case "closed": {
      if (!state.tabs.some((t) => t.id === event.id)) return none;
      const next = without(state, new Set([event.id]));
      // Closing the last tab returns Home, and on desktop focuses Home search.
      return { state: next, notices: [], ...(next.tabs.length === 0 && { focus: "homeSearch" as const }) };
    }
    case "windowClosed":
      return state.tabs.some((t) => t.id === event.id) ? { state: without(state, new Set([event.id])), notices: [] } : none;
    case "serverExited": {
      const gone = new Set(state.tabs.filter((t) => t.key.host === event.hostId && t.key.window.server === event.server).map((t) => t.id));
      return gone.size ? { state: without(state, gone), notices: [] } : none;
    }
    case "watching": {
      const tab = state.tabs.find((t) => t.id === event.id);
      if (!tab?.restoring) return none;
      return { state: { ...state, tabs: state.tabs.map((t) => (t.id === event.id ? { ...t, restoring: false } : t)) }, notices: [] };
    }
    case "renamed": {
      const id = tabId({ host: event.hostId, window: event.window });
      return { state: { ...state, tabs: state.tabs.map((t) => (t.id === id ? { ...t, window: event.name } : t)) }, notices: [] };
    }
    case "navigated":
      return state.onTerminal === event.onTerminal ? none : { state: { ...state, onTerminal: event.onTerminal }, notices: [] };
    case "listing": {
      // A null listing (no tmux server) names no server, so it decides nothing.
      const { listing } = event;
      if (!listing) return none;
      const windows = new Map<number, { session: string; name: string; index: number }>();
      for (const s of listing.sessions) for (const w of s.windows) windows.set(w.id, { session: s.name, name: w.name, index: w.index });
      const endpoint = endpointOf(listing.server);
      const gone = new Set<string>();
      const tabs = state.tabs.map((tab) => {
        if (tab.key.host !== event.hostId || endpointOf(tab.key.window.server) !== endpoint) return tab;
        // The same tmux run decides by window id; another run of the same endpoint has none of its windows.
        const found = tab.key.window.server === listing.server ? windows.get(tab.key.window.window) : undefined;
        if (!found) {
          gone.add(tab.id);
          return tab;
        }
        return { ...tab, session: found.session, window: found.name, index: found.index, restoring: false };
      });
      const next = without({ ...state, tabs }, gone);
      const notices = gone.size ? [`${plural(gone.size)} closed: their windows are gone`] : [];
      return { state: next, notices };
    }
  }
}

export interface Reduced {
  state: WorkspaceState;
  effects: WorkspaceEffect[];
}

/**
 * One event in, the next state and the effects the controller runs out. `cover` and
 * `uncover` come from comparing which tab is on screen before and after; `save` follows
 * every change to the tabs or the active tab.
 */
export function reduce(state: WorkspaceState, event: WorkspaceEvent): Reduced {
  const result = step(state, event);
  const next = result.state;
  const effects: WorkspaceEffect[] = [];
  const before = shownTab(state);
  const after = shownTab(next);
  if (before !== after) {
    if (before !== null && next.tabs.some((t) => t.id === before)) effects.push({ type: "cover", id: before });
    if (after !== null) effects.push({ type: "uncover", id: after });
  }
  if (next.tabs !== state.tabs || next.active !== state.active) effects.push({ type: "save" });
  if (result.focus === "terminal" && next.active !== null) effects.push({ type: "focus", target: "terminal" });
  if (result.focus === "homeSearch") effects.push({ type: "focus", target: "homeSearch" });
  for (const text of result.notices) effects.push({ type: "notice", text });
  return { state: next, effects };
}

/** The saved form of the tabs, for persist now. */
export function savedTabs(state: WorkspaceState): Pick<SavedWorkspace, "tabs" | "active"> {
  return {
    tabs: state.tabs.map((t) => ({ key: t.key, label: `${t.session} / ${t.window}` })),
    active: state.active,
  };
}
