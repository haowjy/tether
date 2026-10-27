// Browser history is the navigation stack, and this is its only writer (client-architecture.md
// §6.6). Each entry's state holds the route (Home or a tab), the overlay open on it, and a
// record of the tab's Files place. The URL carries the route only, so file paths never enter
// it. Everyone else learns of navigation one way: `navigated`, after every push, replace and pop.
import { samePlace, type FilesPlace } from "../platform/types";
import { isPlace } from "../workspace/saved";
import type { Landing, Route } from "../workspace/state";

/** `{ screen, name, params }` is opaque to the router: each lane adds overlays in its own screen. */
export interface Overlay {
  screen: string;
  name: string;
  params?: Record<string, unknown>;
}

/**
 * One history entry: the route it shows (Home, or a tab with the place a Files tab held), and the
 * overlay open on it. On a tab route the current entry names the active tab (the controller
 * replaces it when the active tab changes), so Back returns to an earlier folder without a new
 * request. The workspace owns the place; the router never decides it.
 */
export type Entry = Landing & {
  /** Unique per entry: lets a pop find its place in the in-memory stack. */
  id: number;
  overlay: Overlay | null;
};

/** The entry without its id, as the router is asked to make one. */
type Next = Landing & { overlay: Overlay | null };

/** What the router needs of `window.history`, so a test can stand in. */
export interface HistoryPort {
  current(): { state: unknown; hash: string };
  push(state: unknown, hash: string): void;
  replace(state: unknown, hash: string): void;
  go(delta: number): void;
  onPop(listener: () => void): () => void;
}

const HASHES: Record<Route, string> = { home: "#/", tab: "#/tab" };

/** The enrolment code in a setup link's fragment (`#code=7KQ4-XM2P`), or null. Normalised to the bare characters the code field holds. */
export function enrolCodeFromHash(hash: string): string | null {
  const code = hash.startsWith("#code=") ? hash.slice("#code=".length).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : "";
  return code === "" ? null : code;
}

/** `history.state` is a trust boundary: an earlier page life, maybe an older build, wrote it. */
function isEntry(state: unknown): state is Entry {
  const e = state as Partial<Record<keyof Entry | "place" | "tab", unknown>> | null;
  return typeof e?.id === "number" && (e.route === "home" || (e.route === "tab" && typeof e.tab === "string" && (e.place === null || isPlace(e.place))));
}

const HOME: Next = { route: "home", overlay: null };

export class Router {
  /** Every entry of this page's life, forward ones included; `at` is the one on screen. */
  private stack: Entry[] = [];
  private at = 0;
  private readonly listeners = new Set<(entry: Entry) => void>();
  private nextId = Date.now();

  /**
   * A clean launch opens Home, even with saved tabs: the first entry is replaced with Home's.
   * `activeTab` is the workspace's active tab id: a pop to an entry of any other tab is stale.
   */
  constructor(private readonly port: HistoryPort, private readonly activeTab: () => string | null) {
    const entry = { id: this.nextId++, ...HOME };
    this.stack = [entry];
    port.replace(entry, HASHES.home);
    port.onPop(() => { this.popped(); });
  }

  get entry(): Entry {
    return this.stack[this.at] as Entry;
  }

  subscribe(listener: (entry: Entry) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Shows Home: pushes an entry unless already there. */
  goHome(): void {
    if (this.entry.route === "home") return;
    this.push(HOME);
  }

  /** Shows the active tab from Home: pushes an entry for it. Switching tabs on a tab route adds none. */
  openTab(tab: string, place: FilesPlace | null): void {
    this.push({ route: "tab", tab, place, overlay: null });
  }

  openOverlay(overlay: Overlay): void {
    this.push({ ...this.entry, overlay });
  }

  /**
   * Back closes the top overlay first. After a reload there is nothing to go back to, so the
   * entry is replaced. `then` runs once the overlay is closed: closing is `history.back()`,
   * which lands on a later `popstate`, so an action that navigates must wait, or its entry
   * is pushed before the pop and the pop undoes it (§6.6). With no overlay open it runs at once.
   */
  closeOverlay(then?: () => void): void {
    this.close(1, then);
  }

  /** Closes every overlay open on this entry at once: one history step, so none is left open (WebKit drops a second `back()` issued before the first pops). `then` as for {@link closeOverlay}. */
  closeAllOverlays(then?: () => void): void {
    let open = 0;
    while (this.stack[this.at - open]?.overlay) open++;
    this.close(open, then);
  }

  private close(count: number, then?: () => void): void {
    if (this.entry.overlay === null) {
      then?.();
      return;
    }
    if (then) {
      const off = this.subscribe((entry) => {
        if (entry.overlay !== null) return;
        off();
        then();
      });
    }
    this.closeOverlays(count);
  }

  private closeOverlays(count: number): void {
    const { entry } = this;
    if (entry.overlay === null) return;
    const base = this.stack[this.at - count];
    if (base?.route === entry.route && (base.route === "home" || (entry.route === "tab" && base.tab === entry.tab))) this.port.go(-count);
    else this.replace({ ...entry, overlay: null });
  }

  /** The active tab changed while a tab is on screen: the current entry names `tab` now. A replace, so switching tabs pushes nothing. */
  switchTab(tab: string, place: FilesPlace | null): void {
    this.replace({ route: "tab", tab, place, overlay: this.entry.overlay });
  }

  /** Drilling into a folder or preview of Files tab `tab`: a new entry. */
  pushPlace(tab: string, to: FilesPlace): void {
    this.push({ route: "tab", tab, place: to, overlay: null });
  }

  /** The Files tab's place is now `place` (the daemon's canonical path for what was asked): the entry says so. */
  replacePlace(tab: string, place: FilesPlace): void {
    this.replace({ route: "tab", tab, place, overlay: this.entry.overlay });
  }

  /**
   * An in-app back button to Home. If the previous entry is Home this is `history.back()`;
   * after a reload or a deep link the entry is replaced with Home, so Back never leaves the
   * app unexpectedly.
   */
  toHome(): void {
    if (this.entry.route === "home") return;
    const previous = this.stack[this.at - 1];
    if (previous?.route === "home" && previous.overlay === null) this.port.go(-1);
    else this.replace(HOME);
  }

  /** The in-app back inside a Files tab: to `place`, the enclosing one. The previous entry is that place in this tab, or the entry is replaced with it. */
  toPlace(tab: string, place: FilesPlace): void {
    const previous = this.stack[this.at - 1];
    if (previous?.route === "tab" && previous.tab === tab && previous.overlay === null && previous.place && samePlace(previous.place, place)) this.port.go(-1);
    else this.replace({ route: "tab", tab, place, overlay: null });
  }

  private push(next: Next): void {
    const entry = { ...next, id: this.nextId++ };
    this.stack.splice(this.at + 1, Infinity, entry);
    this.at++;
    this.port.push(entry, HASHES[entry.route]);
    this.emit();
  }

  private replace(next: Next): void {
    const entry = { ...next, id: this.nextId++ };
    this.stack[this.at] = entry;
    this.port.replace(entry, HASHES[entry.route]);
    this.emit();
  }

  private popped(): void {
    const { state } = this.port.current();
    if (isEntry(state)) {
      const at = this.stack.findIndex((e) => e.id === state.id);
      // An entry from this page's life moves the cursor; one from an earlier life (forward past a reload) stands alone.
      if (at >= 0) this.at = at;
      else this.stand({ ...state, overlay: null });
    } else {
      this.stand({ id: this.nextId++, ...HOME });
    }
    const { entry } = this;
    // An entry for a tab that is gone or not the active one is stale: skip to Home without announcing it.
    if (entry.route === "tab" && entry.tab !== this.activeTab()) {
      const home = this.stack.slice(0, this.at + 1).findLastIndex((e) => e.route === "home" && e.overlay === null);
      if (home < 0) this.replace(HOME);
      else this.port.go(home - this.at);
      return;
    }
    this.emit();
  }

  private stand(entry: Entry): void {
    this.stack = [entry];
    this.at = 0;
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this.entry);
  }
}

/** `window.history` as a {@link HistoryPort}. */
export function browserHistory(): HistoryPort {
  return {
    current: () => ({ state: history.state as unknown, hash: location.hash }),
    push: (state, hash) => { history.pushState(state, "", hash); },
    replace: (state, hash) => { history.replaceState(state, "", hash); },
    go: (delta) => { history.go(delta); },
    onPop: (listener) => {
      addEventListener("popstate", listener);
      return () => { removeEventListener("popstate", listener); };
    },
  };
}
