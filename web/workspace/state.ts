// The workspace core (client-architecture.md §6.1): a pure reducer over the open tabs and
// nothing else. Events in; state and effects out. No Preact, no window, no document.
import { tabId } from "../platform/tabKey";
import type { TabKey, SavedWorkspace } from "../platform/types";
import type { TmuxListing } from "../proto/generated/messages";


export interface Tab {
  id: string;
  key: TabKey;
  /** The session's name. */
  session: string;
  /** The name of the window the tab shows: from its `watching`, else the listing's current window, else the saved one. */
  window: string;
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
  | { type: "opened"; key: TabKey; session: string; window: string }
  | { type: "closed"; id: string }
  | { type: "activated"; id: string }
  /** A host's authoritative reply to `listSessions`. */
  | { type: "listing"; hostId: string; listing: TmuxListing | null }
  /** The daemon says the tab's session is gone. */
  | { type: "sessionClosed"; id: string }
  | { type: "serverExited"; hostId: string; server: string }
  | { type: "navigated"; onTerminal: boolean }
  /** The daemon found the session and says which window it shows now: the tab is live, and its label follows. */
  | { type: "watching"; id: string; window: string };

export type WorkspaceEffect =
  | { type: "save" }
  /** Go to a destination through the router. It runs before the focus effects, and the focus lands on the screen it opens. */
  | { type: "navigate"; to: "home" | "terminal" }
  /** Move focus on the user's behalf (desktop): to the terminal, or to Home's search. */
  | { type: "focus"; target: "terminal" | "homeSearch" }
  | { type: "notice"; text: string };

export const initialWorkspace: WorkspaceState = { tabs: [], active: null, onTerminal: false };

/** The tab whose watch runs: only the active tab, and only on the Terminal destination. The terminal lane reads this to cover and uncover its drivers. */
export function shownTab(state: WorkspaceState): string | null {
  return state.onTerminal ? state.active : null;
}

/** `<endpoint>:<pid>-<start>`: the same endpoint with another run is a restarted tmux. */
function endpointOf(server: string): string {
  return server.slice(0, Math.max(0, server.lastIndexOf(":")));
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

/** Showing the active tab: go to Terminal if not there. Arriving there focuses it (`navigated`); already there, focus it now. */
function showActive(before: WorkspaceState): { navigate?: "terminal"; focus?: "terminal" } {
  return before.onTerminal ? { focus: "terminal" } : { navigate: "terminal" };
}

function step(state: WorkspaceState, event: WorkspaceEvent): { state: WorkspaceState; notices: string[]; navigate?: "home" | "terminal"; focus?: "terminal" | "homeSearch" } {
  const none = { state, notices: [] as string[] };
  switch (event.type) {
    case "restored": {
      const saved = event.saved;
      if (!saved) return none;
      const tabs = saved.tabs.map(({ key, session, window }): Tab => ({ id: tabId(key), key, session, window, restoring: true }));
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
      // Opening a session that already has a tab activates that tab.
      if (open) return { state: { ...state, active: id }, notices: [], ...showActive(state) };
      const tab: Tab = { id, key: event.key, session: event.session, window: event.window, restoring: false };
      return { state: { ...state, tabs: [...state.tabs, tab], active: id }, notices: [], ...showActive(state) };
    }
    case "activated":
      if (!state.tabs.some((t) => t.id === event.id)) return none;
      return { state: state.active === event.id ? state : { ...state, active: event.id }, notices: [], ...showActive(state) };
    case "closed": {
      if (!state.tabs.some((t) => t.id === event.id)) return none;
      const next = without(state, new Set([event.id]));
      // Closing the last tab returns Home, and on desktop focuses Home search.
      if (next.tabs.length > 0) return { state: next, notices: [] };
      return { state: next, notices: [], ...(state.onTerminal && { navigate: "home" as const }), focus: "homeSearch" as const };
    }
    case "sessionClosed":
      return state.tabs.some((t) => t.id === event.id) ? { state: without(state, new Set([event.id])), notices: [] } : none;
    case "serverExited": {
      const gone = new Set(state.tabs.filter((t) => t.key.host === event.hostId && t.key.session.server === event.server).map((t) => t.id));
      return gone.size ? { state: without(state, gone), notices: [] } : none;
    }
    case "watching": {
      const tab = state.tabs.find((t) => t.id === event.id);
      if (!tab || (!tab.restoring && tab.window === event.window)) return none;
      return { state: { ...state, tabs: state.tabs.map((t) => (t === tab ? { ...t, window: event.window, restoring: false } : t)) }, notices: [] };
    }
    case "navigated":
      if (state.onTerminal === event.onTerminal) return none;
      // Arriving at Terminal (the rail, Back, a deep link) puts desktop focus in it.
      return { state: { ...state, onTerminal: event.onTerminal }, notices: [], ...(event.onTerminal && { focus: "terminal" as const }) };
    case "listing": {
      // A null listing (no tmux server) names no server, so it decides nothing.
      const { listing } = event;
      if (!listing) return none;
      const sessions = new Map(listing.sessions.map((s) => [s.id, s]));
      const endpoint = endpointOf(listing.server);
      const shown = shownTab(state);
      const gone = new Set<string>();
      const tabs = state.tabs.map((tab) => {
        if (tab.key.host !== event.hostId || endpointOf(tab.key.session.server) !== endpoint) return tab;
        // The same tmux run decides by session id; another run of the same endpoint has none of its sessions.
        const found = tab.key.session.server === listing.server ? sessions.get(tab.key.session.session) : undefined;
        if (!found) {
          gone.add(tab.id);
          return tab;
        }
        // The tab on screen takes its window from `watching`, which is newer than a listing; the others have no watch.
        const window = tab.id === shown ? tab.window : (found.windows.find((w) => w.active)?.name ?? tab.window);
        if (tab.session === found.name && tab.window === window && !tab.restoring) return tab;
        return { ...tab, session: found.name, window, restoring: false };
      });
      // A listing that changes nothing keeps the state, so nothing saves or re-renders.
      if (gone.size === 0 && tabs.every((t, i) => t === state.tabs[i])) return none;
      const next = without({ ...state, tabs }, gone);
      const notices = gone.size ? [`${plural(gone.size)} closed: their sessions are gone`] : [];
      return { state: next, notices };
    }
  }
}

export interface Reduced {
  state: WorkspaceState;
  effects: WorkspaceEffect[];
}

/** One event in, the next state and the effects the controller runs out. `save` follows every change to what {@link savedTabs} holds. */
export function reduce(state: WorkspaceState, event: WorkspaceEvent): Reduced {
  const result = step(state, event);
  const next = result.state;
  const effects: WorkspaceEffect[] = [];
  if (savedChanged(state, next)) effects.push({ type: "save" });
  if (result.navigate) effects.push({ type: "navigate", to: result.navigate });
  if (result.focus === "terminal" && next.active !== null) effects.push({ type: "focus", target: "terminal" });
  if (result.focus === "homeSearch") effects.push({ type: "focus", target: "homeSearch" });
  for (const text of result.notices) effects.push({ type: "notice", text });
  return { state: next, effects };
}

/** The saved form of the tabs, for persist now. */
export function savedTabs(state: WorkspaceState): Pick<SavedWorkspace, "tabs" | "active"> {
  return {
    tabs: state.tabs.map((t) => ({ key: t.key, session: t.session, window: t.window })),
    active: state.active,
  };
}

/** Whether the saved form differs: `restoring` is not saved, so changing only it writes nothing. */
function savedChanged(a: WorkspaceState, b: WorkspaceState): boolean {
  if (a.active !== b.active || a.tabs.length !== b.tabs.length) return true;
  return a.tabs.some((t, i) => {
    const u = b.tabs[i];
    return u?.id !== t.id || u.session !== t.session || u.window !== t.window;
  });
}
