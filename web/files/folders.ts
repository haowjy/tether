import { HttpRefusal } from "../net/http";
import { Store } from "../ui/store";
import type { FsApi, Listing } from "./api";
import { folderKey, scopeOf, type FolderNames, type FolderState, type Where } from "./pathfield";

export type Via = "list" | "dirs";

/** Typing pauses this long before a folder is asked for. */
export const SETTLE_MS = 250;
/** Folders kept per host for the Files session. */
export const KEPT = 32;
/** A folder's pages asked for before giving up: 5 × 200 = 1,000 folders. */
export const MAX_PAGES = 5;

/** A folder's first page, as listed. */
export type FirstPage = Listing & { via: Via };

/** What is known of one folder: the subfolder names the path field completes from, and the first page browsing shows. */
export interface Held {
  names: FolderState | null;
  first: FirstPage | null;
}

export interface FoldersView {
  /** Oldest first: the first to go when more than `KEPT` are held. */
  held: ReadonlyMap<string, Held>;
}

/**
 * What one host's folders have told us, `KEPT` folders at most, the least recently used going
 * first. Each holds the subfolder names the path field completes from (one request per folder
 * entered, never one per keystroke: `ask` waits for typing to settle and a held folder is not
 * asked for again) and the first page browsing shows, so showing a held folder on a tab switch
 * or a Back costs no request. What clears what: `drop` (a refresh or an upload changed the
 * folder) clears both; a failed load clears the folder's first page; `forgetAll` (a root
 * was added or removed) clears every first page but keeps the names.
 */
export class Folders extends Store<FoldersView> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly inflight = new Map<string, Promise<void>>();

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
    const { names } = this.snapshot.held.get(key) ?? {};
    // A listing that failed for want of a connection is asked for again: it may be back.
    if (names && !(names.status === "error" && names.error.code === "network")) {
      this.put(key, {});
      return;
    }
    this.timer = setTimeout(() => { void this.load(target.path, target.hidden); }, SETTLE_MS);
  }

  /** Fetches now (Go cannot wait out the settle), or joins the fetch under way. */
  load(path: string, hidden: boolean): Promise<void> {
    const key = folderKey(path, hidden);
    const running = this.inflight.get(key);
    if (running) return running;
    this.put(key, { names: { status: "loading" } });
    const done = this.fetch(path, hidden, key).then(
      (names) => { this.put(key, { names: { status: "ready", ...names } }); },
      (error: unknown) => { this.put(key, { names: { status: "error", error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") }, first: null }); },
    ).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, done);
    return done;
  }

  /** The cached first page of `path`, if any. */
  peek(path: string, hidden: boolean): FirstPage | null {
    return this.snapshot.held.get(folderKey(path, hidden))?.first ?? null;
  }

  /** Like {@link peek}, but waits for a fetch under way instead of asking again. */
  async settled(path: string, hidden: boolean): Promise<FirstPage | null> {
    await this.inflight.get(folderKey(path, hidden));
    return this.peek(path, hidden);
  }

  /** Browsing listed `listing`'s first page: it is cached, and its subfolders are held. */
  loaded(listing: FirstPage, hidden: boolean, asked: string): void {
    this.put(folderKey(asked, hidden), { first: listing });
    this.put(folderKey(listing.path, hidden), { first: listing });
    this.seed(listing, hidden);
  }

  /** What browsing loaded: a folder whose pages hold all its subfolders (they sort first) needs no request. */
  seed(listing: Listing, hidden: boolean): void {
    const allHeld = listing.entries.length >= listing.total || listing.entries.some((e) => e.kind !== "dir");
    if (allHeld) this.put(folderKey(listing.path, hidden), { names: { status: "ready", ...namesOf(listing.entries), capped: listing.truncated } });
  }

  /** The scope changed (a root added or removed): no first page is known to be what a fresh one would say. */
  forgetAll(): void {
    const held = new Map<string, Held>();
    for (const [key, record] of this.snapshot.held) if (record.names) held.set(key, { names: record.names, first: null });
    this.update({ held });
  }

  /** A refresh or an upload changed `path`. */
  drop(path: string): void {
    const held = new Map(this.snapshot.held);
    held.delete(folderKey(path, false));
    held.delete(folderKey(path, true));
    this.update({ held });
  }

  /** Merges `patch` into the folder's record and makes it the newest. */
  private put(key: string, patch: Partial<Held>): void {
    const held = new Map(this.snapshot.held);
    const record = { names: null, first: null, ...held.get(key), ...patch };
    held.delete(key);
    held.set(key, record);
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
      if (page === 1) { this.put(key, { first: listing }); via = listing.via; }
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
