// Browser history is the navigation stack, and this is its only writer (client-architecture.md
// §6.6). Each entry's state holds the overlay open on it, the Files place, and the logical
// parent. The URL carries the destination only, so file paths never enter it. Everyone
// else learns of navigation one way: `navigated`, after every push, replace and pop.
import type { FilesPlace } from "../platform/types";

export type Destination = "home" | "files" | "terminal";

/** `{ screen, name, params }` is opaque to the router: each lane adds overlays in its own screen. */
export interface Overlay {
  screen: string;
  name: string;
  params?: Record<string, unknown>;
}

export interface Entry {
  /** Unique per entry: lets a pop find its place in the in-memory stack. */
  id: number;
  destination: Destination;
  overlay: Overlay | null;
  /** Files' folder and preview. Meaningful on the Files destination only. */
  files: FilesPlace | null;
  /** Where the in-app back button goes: Home for every other destination. */
  parent: Destination | null;
}

export interface Navigated {
  destination: Destination;
  entry: Entry;
}

/** What the router needs of `window.history`, so a test can stand in. */
export interface HistoryPort {
  current(): { state: unknown; hash: string };
  push(state: unknown, hash: string): void;
  replace(state: unknown, hash: string): void;
  go(delta: number): void;
  onPop(listener: () => void): () => void;
}

const HASHES: Record<Destination, string> = { home: "#/", files: "#/files", terminal: "#/terminal" };

export function destinationFromHash(hash: string): Destination {
  return hash === HASHES.files ? "files" : hash === HASHES.terminal ? "terminal" : "home";
}

function isEntry(state: unknown): state is Entry {
  const e = state as Partial<Entry> | null;
  return typeof e?.id === "number" && (e.destination === "home" || e.destination === "files" || e.destination === "terminal");
}

export class Router {
  private stack: Entry[] = [];
  private readonly listeners = new Set<(nav: Navigated) => void>();
  private nextId = Date.now();
  /** The last Files place any entry held: `go("files")` returns to it. */
  private lastFiles: FilesPlace | null;

  /**
   * Reload restores the destination from the hash and the Files place from the saved
   * workspace: the first entry is replaced with that place. Overlays do not survive.
   */
  constructor(private readonly port: HistoryPort, files: FilesPlace | null) {
    const destination = destinationFromHash(port.current().hash);
    const entry: Entry = { id: this.nextId++, destination, overlay: null, files: destination === "files" ? files : null, parent: destination === "home" ? null : "home" };
    this.stack = [entry];
    this.lastFiles = entry.files;
    port.replace(entry, HASHES[destination]);
    port.onPop(() => { this.popped(); });
  }

  get entry(): Entry {
    return this.stack[this.stack.length - 1] as Entry;
  }

  subscribe(listener: (nav: Navigated) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Changing destination pushes an entry. The same destination changes nothing. Files returns to where it was left. */
  go(destination: Destination): void {
    const { entry } = this;
    if (entry.destination === destination) return;
    this.push({ destination, overlay: null, files: destination === "files" ? this.lastFiles : null, parent: destination === "home" ? null : "home" });
  }

  openOverlay(overlay: Overlay): void {
    const { entry } = this;
    this.push({ ...entry, overlay, parent: entry.parent });
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

  /** Closes every overlay open on this destination at once: one history step, so none is left open (WebKit drops a second `back()` issued before the first pops). `then` as for {@link closeOverlay}. */
  closeAllOverlays(then?: () => void): void {
    let open = 0;
    while (this.stack[this.stack.length - 1 - open]?.overlay) open++;
    this.close(open, then);
  }

  private close(count: number, then?: () => void): void {
    if (this.entry.overlay === null) {
      then?.();
      return;
    }
    if (then) {
      const off = this.subscribe(({ entry }) => {
        if (entry.overlay !== null) return;
        off();
        then();
      });
    }
    this.closeOverlays(count);
  }

  private closeOverlays(count: number): void {
    if (this.entry.overlay === null) return;
    if (this.stack[this.stack.length - 1 - count]?.destination === this.entry.destination) this.port.go(-count);
    else this.replace({ ...this.entry, overlay: null });
  }

  /** Drilling into a Files folder or preview. `FileBrowser` changes only when the resulting `navigated` arrives. */
  pushFiles(place: FilesPlace): void {
    this.push({ destination: "files", overlay: null, files: place, parent: "home" });
  }

  /**
   * An in-app back button: to the logical parent. If the previous entry is that parent,
   * this is `history.back()`; after a reload or a deep link the entry is replaced with the
   * parent, so Back never leaves the app unexpectedly. Within Files the parent is the
   * enclosing place, given as `files`.
   */
  toParent(files?: FilesPlace): void {
    const { entry } = this;
    const previous = this.stack[this.stack.length - 2];
    if (files) {
      if (previous?.destination === "files" && previous.overlay === null && JSON.stringify(previous.files) === JSON.stringify(files)) this.port.go(-1);
      else this.replace({ destination: "files", overlay: null, files, parent: "home" });
      return;
    }
    const parent = entry.parent;
    if (parent === null) return;
    if (previous?.destination === parent && previous.overlay === null) this.port.go(-1);
    else this.replace({ destination: parent, overlay: null, files: null, parent: parent === "home" ? null : "home" });
  }

  private push(next: Omit<Entry, "id">): void {
    const entry: Entry = { ...next, id: this.nextId++ };
    this.stack.push(entry);
    this.port.push(entry, HASHES[entry.destination]);
    this.emit();
  }

  private replace(next: Omit<Entry, "id">): void {
    const entry: Entry = { ...next, id: this.nextId++ };
    this.stack[this.stack.length - 1] = entry;
    this.port.replace(entry, HASHES[entry.destination]);
    this.emit();
  }

  private popped(): void {
    const { state, hash } = this.port.current();
    if (isEntry(state)) {
      const at = this.stack.findIndex((e) => e.id === state.id);
      // An entry from this page's life moves the stack; one from an earlier life (forward past a reload) stands alone.
      this.stack = at >= 0 ? this.stack.slice(0, at + 1) : [{ ...state, overlay: null }];
    } else {
      const destination = destinationFromHash(hash);
      this.stack = [{ id: this.nextId++, destination, overlay: null, files: null, parent: destination === "home" ? null : "home" }];
    }
    this.emit();
  }

  private emit(): void {
    if (this.entry.files) this.lastFiles = this.entry.files;
    const nav: Navigated = { destination: this.entry.destination, entry: this.entry };
    for (const listener of [...this.listeners]) listener(nav);
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
