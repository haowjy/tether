import { HttpRefusal } from "../net/http";
import { Store } from "../ui/store";
import type { FsApi, Listing } from "./api";
import { Recent } from "./recent";
import { folderKey, scopeOf, type FolderNames, type FolderState, type Where } from "./pathfield";

export type Via = "list" | "dirs";

/** Typing pauses this long before a folder is asked for. */
export const SETTLE_MS = 250;
/** Folders kept per host for the Files session. */
export const KEPT = 32;
/** A folder's pages asked for before giving up: 5 × 200 = 1,000 folders. */
export const MAX_PAGES = 5;

export interface FoldersView {
  /** Oldest first: the first to go when more than `KEPT` are held. */
  held: ReadonlyMap<string, FolderState>;
}

/** A folder's first page, as listed. */
export type FirstPage = Listing & { via: Via };

/**
 * What one host's folders have told us. The subfolder names the path field completes from:
 * one request per folder entered and never one per keystroke, since `ask` waits for typing to
 * settle and a held folder is not asked for again. And the first page of the `KEPT` folders
 * most recently loaded, by the field or by browsing: showing one of those, on a tab switch or a
 * Back, costs no request. A refresh or an upload drops the folder.
 */
export class Folders extends Store<FoldersView> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly firsts = new Recent<FirstPage>(KEPT);

  constructor(
    private readonly api: FsApi,
    private readonly where: () => Where | null,
  ) {
    super({ held: new Map() });
  }

  /** The folder the field names now: fetched once typing settles, unless held or already under way. */
  ask(target: { path: string; hidden: boolean } | null): void {
    clearTimeout(this.timer);
    if (!target) return;
    const key = folderKey(target.path, target.hidden);
    const state = this.snapshot.held.get(key);
    // A listing that failed for want of a connection is asked for again: it may be back.
    if (state && !(state.status === "error" && state.error.code === "network")) {
      this.set(key, state);
      return;
    }
    this.timer = setTimeout(() => { void this.load(target.path, target.hidden); }, SETTLE_MS);
  }

  /** Fetches now (Go cannot wait out the settle), or joins the fetch under way. */
  load(path: string, hidden: boolean): Promise<void> {
    const key = folderKey(path, hidden);
    const running = this.inflight.get(key);
    if (running) return running;
    this.set(key, { status: "loading" });
    const done = this.fetch(path, hidden, key).then(
      (names) => { this.set(key, { status: "ready", ...names }); },
      (error: unknown) => { this.firsts.delete(key); this.set(key, { status: "error", error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") }); },
    ).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, done);
    return done;
  }

  /** The cached first page of `path`, if any. */
  peek(path: string, hidden: boolean): FirstPage | null {
    return this.firsts.get(folderKey(path, hidden)) ?? null;
  }

  /** Like {@link peek}, but waits for a fetch under way instead of asking again. */
  async settled(path: string, hidden: boolean): Promise<FirstPage | null> {
    await this.inflight.get(folderKey(path, hidden));
    return this.peek(path, hidden);
  }

  /** Browsing listed `listing`'s first page: it is cached, and its subfolders are held. */
  loaded(listing: FirstPage, hidden: boolean, asked: string): void {
    this.firsts.set(folderKey(asked, hidden), listing);
    this.firsts.set(folderKey(listing.path, hidden), listing);
    this.seed(listing, hidden);
  }

  /** What browsing loaded: a folder whose pages hold all its subfolders (they sort first) needs no request. */
  seed(listing: Listing, hidden: boolean): void {
    const allHeld = listing.entries.length >= listing.total || listing.entries.some((e) => e.kind !== "dir");
    if (allHeld) this.set(folderKey(listing.path, hidden), { status: "ready", ...namesOf(listing.entries), capped: listing.truncated });
  }

  /** The scope changed (a root added or removed): no listing is known to be what a fresh one would say. */
  forgetAll(): void {
    this.firsts.clear();
  }

  /** A refresh or an upload changed `path`. */
  drop(path: string): void {
    const held = new Map(this.snapshot.held);
    held.delete(folderKey(path, false));
    held.delete(folderKey(path, true));
    this.firsts.delete(folderKey(path, false));
    this.firsts.delete(folderKey(path, true));
    this.update({ held });
  }

  private set(key: string, state: FolderState): void {
    const held = new Map(this.snapshot.held);
    held.delete(key);
    held.set(key, state);
    for (const [oldest] of held) {
      if (held.size <= KEPT) break;
      held.delete(oldest);
    }
    this.update({ held });
  }

  private async fetch(path: string, hidden: boolean, key: string): Promise<FolderNames> {
    const names: string[] = [];
    let via: Via | undefined;
    for (let page = 1, offset = 0; ; page++) {
      const listing = await listFolder(this.api, this.where(), path, offset, hidden, offset === 0 ? undefined : via);
      if (page === 1) { this.firsts.set(key, listing); via = listing.via; }
      names.push(...namesOf(listing.entries).names);
      offset += listing.entries.length;
      const more = listing.entries.length > 0 && listing.entries.every((e) => e.kind === "dir") && offset < listing.total;
      if (!more || listing.truncated) return { names, capped: listing.truncated || more };
      if (page === MAX_PAGES) return { names, capped: true };
    }
  }
}

/**
 * One page of a folder, by the route that serves it: `/fs/list` inside a root, the `$HOME`
 * picker (`/fs/dirs`, folders only) outside every root. A link inside a root that leads out
 * is refused by `list` and falls back to the picker. `via` pins the route (later pages).
 */
export async function listFolder(api: FsApi, where: Where | null, path: string, offset: number, hidden: boolean, via?: Via): Promise<Listing & { via: Via }> {
  const dirs = async (): Promise<Listing & { via: Via }> => ({ ...(await api.dirs(path, offset, hidden)), via: "dirs" });
  if (via === "dirs" || (via === undefined && where && scopeOf(path, where) === "dirs")) return dirs();
  try {
    return { ...(await api.list(path, offset, hidden)), via: "list" };
  } catch (error) {
    if (via === undefined && error instanceof HttpRefusal && error.code === "outside_roots") return dirs();
    throw error;
  }
}

const namesOf = (entries: Listing["entries"]): { names: string[] } => ({
  names: entries.filter((e) => e.kind === "dir" && e.utf8 !== false).map((e) => e.name),
});
