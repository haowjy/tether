import { HttpRefusal } from "../net/http";
import type { Entry, Favorites, FsApi, Listing } from "./api";
import { samePlace, type FilesPlace } from "../platform/types";
import { hostProblem, type HostProblem } from "../ui/hostProblem";
import { Store } from "../ui/store";
import { baseName, join, parentOf } from "./paths";
import { Folders, KEPT } from "./folders";
import { Recent } from "./recent";

/** A file to view: from a listing, or from a path (a Markdown link, a reload) and a probe. */
export interface FileRef {
  path: string;
  name: string;
  size: number | null;
  /** Unix seconds; null when opened by path. */
  mtime: number | null;
  mime: string | null;
}

/** Where the file manager is: the active Files tab's place, with the viewed file's details. */
export type Place = { kind: "dir"; path: string } | { kind: "file"; file: FileRef };

/** The folder a new Files tab opens: the host's home, which only the host can name. */
const HOME = "~";

/** A directory's pages loaded so far. */
export interface Pages extends Listing {
  hidden: boolean;
}

export interface FilesView {
  place: Place;
  favorites: Favorites | null;
  /** Why the last ask for the favorites failed; the picker offers to try again. */
  favoritesError: HttpRefusal | null;
  /** The directory under the place: the dir itself, or a viewed file's folder when it was opened from there. */
  pages: Pages | null;
  loading: boolean;
  /** Why the place couldn't load; the screen offers to try again. */
  error: HttpRefusal | null;
  hidden: boolean;
}

export interface BrowserOptions {
  api: FsApi;
  hidden: boolean;
}

/** The place a listing entry opens, for the router to push; null for what cannot open. */
export function entryPlace(dir: string, entry: Entry): FilesPlace | null {
  if (entry.utf8 === false) return null;
  const path = join(dir, entry.name);
  return entry.kind === "dir" ? { kind: "dir", path } : entry.kind === "file" ? { kind: "file", path } : null;
}

/** The place `[<]` goes to: up a level, or out of a viewer; null at `/`. A folder that failed to list has no parent from the daemon: the path's own. */
export function parentPlace(view: Pick<FilesView, "place" | "pages">): FilesPlace | null {
  const { place, pages } = view;
  if (place.kind === "file") return { kind: "dir", path: parentOf(place.file.path) };
  if (pages?.path === place.path) return pages.parent === null ? null : { kind: "dir", path: pages.parent };
  return place.path.startsWith("/") && place.path !== "/" ? { kind: "dir", path: parentOf(place.path) } : null;
}

/** The place a view shows, as the workspace holds it: a viewed file keeps its path only. */
export function placeOf(place: Place): FilesPlace {
  return place.kind === "file" ? { kind: "file", path: place.file.path } : place;
}

/**
 * The file manager's state, apart from the DOM: the favorites, the directory pages loaded for
 * the place on screen, and that place. The active Files tab owns where the user is (its place,
 * written from browser history); `follow` brings this state to it. Nothing is fetched until a place
 * needs it, and only the page in view (plan.md "Bandwidth"); a folder whose first page the host's
 * `folders` cache holds, and a file already probed, are shown again without a request.
 */
export class FileBrowser extends Store<FilesView> {
  /** The host's file API, which the viewers read through too. */
  readonly api: FsApi;
  /** The path field's subfolder listings; browsing seeds them. */
  readonly folders: Folders;
  /** Bumped on every navigation, so an answer for a place already left is dropped. */
  private seq = 0;
  /** Files opened by path (a link, a reload) and probed: returning to one costs no second probe. */
  private readonly probed = new Recent<FileRef>(KEPT);
  private asked: Promise<Favorites> | null = null;
  private favoritesSeq = 0;

  constructor(opts: BrowserOptions) {
    super({ place: { kind: "dir", path: HOME }, favorites: null, favoritesError: null, pages: null, loading: true, error: null, hidden: opts.hidden });
    this.api = opts.api;
    this.folders = new Folders(opts.api);
  }

  /** The host's favorites, asked for once and kept; they name `$HOME`, which paths are shown relative to. */
  favorites(): Promise<Favorites> {
    if (this.asked) return this.asked;
    const seq = ++this.favoritesSeq;
    this.asked = this.api.favorites().then(
      // Only the latest answer lands: a refresh that was overtaken by an add or remove must not bring the old list back.
      (favorites) => { if (seq === this.favoritesSeq) this.update({ favorites, favoritesError: null }); return favorites; },
      (error: unknown) => { this.asked = null; throw error; },
    );
    return this.asked;
  }

  /** Asks again, for the picker opening: another device may have changed them. A failure shows as `favoritesError`; what was known stays. */
  async refreshFavorites(): Promise<void> {
    this.asked = null;
    try {
      await this.favorites();
    } catch (error) {
      this.update({ favoritesError: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal") });
    }
  }

  /**
   * Shows the active Files tab's place. What is already on screen, or cached, stays (no refetch):
   * returning from the terminal or another tab finds the folder and preview as they were. A
   * refresh is `reload`. When the place settled as a different one (the daemon's canonical path,
   * or a folder where a file was named) `onResolved` says so, for the owner of the place to follow.
   */
  follow(want: FilesPlace, onResolved: (settled: FilesPlace) => void = () => undefined): Promise<void> {
    const shown = this.show(want);
    const seq = this.seq;
    return shown.then(() => {
      if (seq !== this.seq || this.snapshot.error) return;
      const settled = placeOf(this.snapshot.place);
      if (!samePlace(settled, want)) onResolved(settled);
    });
  }

  private show(want: FilesPlace): Promise<void> {
    const { place, pages, error } = this.snapshot;
    void this.favorites().catch(() => undefined);
    if (want.kind === "dir") {
      if (pages?.path !== want.path || error) return this.load(want);
      if (place.kind !== "dir" || place.path !== want.path) this.go({ place: want, loading: false });
      return Promise.resolve();
    }
    if (place.kind === "file" && place.file.path === want.path && !error) return Promise.resolve();
    return this.openFile(want.path);
  }

  /** A path from a Markdown link: the place it opens (a probe says file or folder), for the router to push. */
  async resolve(path: string): Promise<FilesPlace> {
    return (await this.api.probe(path)).kind === "dir" ? { kind: "dir", path } : { kind: "file", path };
  }

  /** The current listing again from its first page: pull-to-refresh, or Retry. */
  async reload(): Promise<void> {
    const { place } = this.snapshot;
    if (place.kind === "dir") {
      this.folders.drop(place.path);
      await this.load(place);
    } else {
      this.probed.delete(place.file.path);
      await this.openFile(place.file.path);
    }
  }

  /** The next page, when the list scrolls near its end. */
  async more(): Promise<void> {
    const { pages, loading } = this.snapshot;
    if (!pages || loading || pages.entries.length >= pages.total) return;
    const offset = pages.entries.length;
    await this.run(
      { loading: true },
      () => this.api.list(pages.path, offset, pages.hidden),
      (next) => {
        const grown = { ...pages, total: next.total, truncated: next.truncated, entries: [...pages.entries, ...next.entries] };
        this.folders.seed(grown, grown.hidden);
        this.update({ pages: grown, loading: false });
      },
    );
  }

  async toggleHidden(): Promise<void> {
    this.update({ hidden: !this.snapshot.hidden });
    const { place } = this.snapshot;
    if (place.kind === "dir") await this.load(place);
  }

  /** Adds a favorite. A refusal throws for the caller to show. */
  async addFavorite(path: string): Promise<void> {
    await this.written(this.api.addFavorite(path));
  }

  /** Removes the favorite stored as `path`. */
  async removeFavorite(path: string): Promise<void> {
    await this.written(this.api.removeFavorite(path));
  }

  /** A write's answer is the newest word on the favorites: it outranks any ask still in flight. */
  private async written(answer: Promise<Favorites>): Promise<void> {
    const seq = ++this.favoritesSeq;
    const favorites = await answer;
    if (seq === this.favoritesSeq) this.update({ favorites, favoritesError: null });
  }

  /** An upload landed at `path`: relist if it is in the folder on screen. */
  async uploaded(path: string): Promise<void> {
    this.folders.drop(parentOf(path));
    this.probed.delete(path);
    const { place } = this.snapshot;
    if (place.kind === "dir" && place.path === parentOf(path)) await this.reload();
  }

  private openFile(path: string): Promise<void> {
    const dir = parentOf(path);
    const { pages, hidden } = this.snapshot;
    // The folder the file sits in, if its listing is on screen or cached: it stays under the preview, and names the file.
    const cached = this.folders.peek(dir, hidden);
    const keep = pages?.path === dir ? pages : cached && { ...cached, hidden };
    const entry = keep?.entries.find((e) => e.name === baseName(path) && e.kind === "file");
    const file = entry
      ? { path, name: entry.name, size: entry.size ?? null, mtime: entry.mtime ?? null, mime: entry.mime ?? null }
      : this.probed.get(path);
    if (file) {
      this.go({ place: { kind: "file", file }, pages: keep ?? null, error: null, loading: false });
      return Promise.resolve();
    }
    return this.run({ place: { kind: "file", file: { path, name: baseName(path), size: null, mtime: null, mime: null } }, pages: keep ?? null, loading: true, error: null }, () => this.api.probe(path), (probe) => {
      // A probe that finds a folder (a link led here): list it instead.
      if (probe.kind === "dir") return this.load({ kind: "dir", path });
      const file = { path, name: baseName(path), size: probe.size, mtime: null, mime: probe.mime };
      this.probed.set(path, file);
      this.update({ place: { kind: "file", file }, loading: false });
      return undefined;
    });
  }

  /** Lists `place` from its first page, or shows the cached first page. */
  private load(place: { kind: "dir"; path: string }): Promise<void> {
    const { hidden } = this.snapshot;
    const cached = this.folders.peek(place.path, hidden);
    if (cached) {
      this.go({ place: { ...place, path: cached.path }, pages: { ...cached, hidden }, loading: false, error: null });
      return Promise.resolve();
    }
    // The same folder's pages stay up (greyed by `loading`) while it reloads; another folder's go.
    return this.run(
      { place, pages: this.snapshot.pages?.path === place.path ? this.snapshot.pages : null, loading: true, error: null },
      async () => {
        const path = place.path === HOME ? (await this.favorites()).home : place.path;
        // A fetch the path field has under way serves this too.
        return (await this.folders.settled(path, hidden)) ?? this.api.list(path, 0, hidden);
      },
      // The daemon answers with the canonical path; the place follows it.
      (listing) => {
        this.folders.loaded(listing, hidden, place.path);
        this.update({ place: { ...place, path: listing.path }, pages: { ...listing, hidden }, loading: false });
      },
    );
  }

  /** A navigation that needs no answer. */
  private go(patch: Partial<FilesView>): void {
    this.seq++;
    this.update(patch);
  }

  /** A navigation: shows `patch`, then `apply`s the answer of `work` unless another navigation began meanwhile. */
  private async run<T>(patch: Partial<FilesView>, work: () => Promise<T>, apply: (answer: T) => void | Promise<void>): Promise<void> {
    this.go(patch);
    const seq = this.seq;
    try {
      const answer = await work();
      if (seq === this.seq) await apply(answer);
    } catch (error) {
      if (seq === this.seq) this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const { place, pages } = this.snapshot;
    // Another folder's entries mustn't stand in for the one that failed.
    const stale = place.kind === "dir" && pages?.path !== place.path;
    this.update({ loading: false, error: error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal"), ...(stale && { pages: null }) });
  }
}

/** One line for a refusal, in the file manager's words (fs.md "Errors"). */
export function describeError(error: HttpRefusal, host: string): string {
  const problem = (kind: HostProblem): string => {
    const { title, hint } = hostProblem(kind, host);
    return hint ? `${title}. ${hint}` : title;
  };
  switch (error.code) {
    case "network": return problem("unreachable");
    case "denied": return "Permission denied.";
    case "not_found": return "It isn't there any more.";
    case "not_a_directory": return "That's a file, not a folder.";
    case "not_a_file": return "That isn't a regular file.";
    case "busy": return `${host} is busy. Try again in a moment.`;
    case "config_unavailable": return "tether can't read config.toml on the server. Fix it there.";
    case "config_read_only": return "config.toml can't be written on the server.";
    case "incompatible": return problem("incompatible");
    case "auth_required": case "forbidden": case "http_401": return problem("unauthorized");
    case "bad_request": return "The server refused that path.";
    default: return `Something went wrong on ${host} (${error.code}).`;
  }
}
