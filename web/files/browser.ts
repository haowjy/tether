import { HttpRefusal } from "../net/http";
import type { Entry, FsApi, Listing, Roots } from "./api";
import type { FilesPlace } from "../platform/types";
import { hostProblem, type HostProblem } from "../ui/hostProblem";
import { Store } from "../ui/store";
import { baseName, join, parentOf } from "./paths";
import { samePlace } from "../workspace/state";
import { Folders, listFolder, type Via } from "./folders";
import type { Where } from "./pathfield";

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
export type Place = { kind: "roots" } | { kind: "dir"; path: string } | { kind: "file"; file: FileRef };

/** A directory's pages loaded so far. */
export interface Pages extends Listing {
  hidden: boolean;
  /** `dirs`: a folder outside every root, listed by the `$HOME` picker (subfolders only), which offers to add it. */
  via: Via;
}

export interface FilesView {
  place: Place;
  roots: Roots | null;
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
  /** The place asked for settled as a different one: the daemon's canonical path, or a folder where a file was named. The owner of the place follows it. */
  onResolved: (asked: FilesPlace, settled: FilesPlace) => void;
}

/** The canonical directories the file list may show: the working roots and uploads_dir. */
export function scope(roots: Roots): string[] {
  return [...roots.roots, roots.uploadsDir].flatMap((r) => (r.ok && r.canonical ? [r.canonical] : []));
}

/** The place a listing entry opens, for the router to push; null for what cannot open. */
export function entryPlace(dir: string, entry: Entry): FilesPlace | null {
  if (entry.utf8 === false) return null;
  const path = join(dir, entry.name);
  return entry.kind === "dir" ? { kind: "dir", path } : entry.kind === "file" ? { kind: "file", path } : null;
}

/** The place `[<]` goes to: up a level, out of a viewer, then to the roots; null on the roots list. */
export function parentPlace(view: Pick<FilesView, "place" | "pages">): FilesPlace | null {
  const { place, pages } = view;
  switch (place.kind) {
    case "roots":
      return null;
    case "file":
      return { kind: "dir", path: parentOf(place.file.path) };
    case "dir":
      // Without this folder's listing the scope is unknown: the roots are always allowed.
      if (pages?.path !== place.path) return { kind: "roots" };
      return pages.parent === null ? { kind: "roots" } : { kind: "dir", path: pages.parent };
  }
}

/** The place a view shows, as the workspace holds it: a viewed file keeps its path only. */
export function placeOf(place: Place): FilesPlace {
  return place.kind === "file" ? { kind: "file", path: place.file.path } : place;
}

/**
 * The file manager's state, apart from the DOM: the roots, the directory pages loaded for
 * the place on screen, and that place. The active Files tab owns where the user is (its place,
 * written from browser history); `follow` brings this state to it. Nothing is fetched until a place
 * needs it, and only the page in view (plan.md "Bandwidth").
 */
export class FileBrowser extends Store<FilesView> {
  /** The host's file API, which the viewers read through too. */
  readonly api: FsApi;
  /** The path field's subfolder listings; browsing seeds them. */
  readonly folders: Folders;
  /** Bumped on every navigation, so an answer for a place already left is dropped. */
  private seq = 0;
  private readonly onResolved: BrowserOptions["onResolved"];

  constructor(opts: BrowserOptions) {
    super({ place: { kind: "roots" }, roots: null, pages: null, loading: true, error: null, hidden: opts.hidden });
    this.api = opts.api;
    this.onResolved = opts.onResolved;
    this.folders = new Folders(opts.api, () => this.where());
  }

  /** What completion needs of the roots; null until they are known. */
  where(): Where | null {
    const { roots } = this.snapshot;
    return roots && { home: roots.home, scope: scope(roots) };
  }

  /**
   * Shows the active Files tab's place. What is already on screen stays (no refetch): returning
   * from the terminal finds the folder and preview as they were. A refresh is `reload`.
   */
  follow(want: FilesPlace): Promise<void> {
    const shown = this.show(want);
    const seq = this.seq;
    return shown.then(() => {
      if (seq !== this.seq || this.snapshot.error) return;
      const settled = placeOf(this.snapshot.place);
      if (!samePlace(settled, want)) this.onResolved(want, settled);
    });
  }

  private show(want: FilesPlace): Promise<void> {
    const { place, pages, roots, error } = this.snapshot;
    // A folder or file opened by a reload has no roots yet: they name $HOME, which paths are shown relative to.
    if (want.kind !== "roots" && !roots) void this.api.roots().then((r) => { this.update({ roots: r }); }, () => undefined);
    if (want.kind === "roots") {
      if (place.kind === "roots" && roots && !error) return Promise.resolve();
      return this.showRoots();
    }
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
    } else if (place.kind === "file") await this.openFile(place.file.path);
    else await this.showRoots();
  }

  /** The next page, when the list scrolls near its end. */
  async more(): Promise<void> {
    const { pages, loading } = this.snapshot;
    if (!pages || loading || pages.entries.length >= pages.total) return;
    const offset = pages.entries.length;
    await this.run(
      { loading: true },
      () => listFolder(this.api, null, pages.path, offset, pages.hidden, pages.via),
      (next) => {
        const grown = { ...pages, total: next.total, truncated: next.truncated, entries: [...pages.entries, ...next.entries] };
        this.folders.seed(grown, grown.hidden);
        this.update({ pages: grown, loading: false });
      },
    );
  }

  async toggleHidden(): Promise<void> {
    this.update({ hidden: !this.snapshot.hidden });
    if (this.snapshot.place.kind === "dir") await this.reload();
  }

  /** Adds a root. A refusal throws for the caller to show. The folder on screen lists in full once it is one. */
  async addRoot(path: string): Promise<void> {
    this.update({ roots: await this.api.addRoot(path) });
    const { place } = this.snapshot;
    if (place.kind === "dir" && place.path === path) await this.reload();
  }

  async removeRoot(path: string): Promise<void> {
    this.update({ roots: await this.api.removeRoot(path) });
  }

  /** An upload landed at `path`: relist if it is in the folder on screen. */
  async uploaded(path: string): Promise<void> {
    this.folders.drop(parentOf(path));
    const { place } = this.snapshot;
    if (place.kind === "dir" && place.path === parentOf(path)) await this.reload();
  }

  private showRoots(): Promise<void> {
    return this.run({ place: { kind: "roots" }, loading: true, error: null }, () => this.api.roots(), (roots) => {
      this.update({ roots, loading: false });
    });
  }

  private openFile(path: string): Promise<void> {
    const { pages } = this.snapshot;
    const dir = parentOf(path);
    const keep = pages?.path === dir ? pages : null;
    const entry = keep?.entries.find((e) => e.name === baseName(path) && e.kind === "file");
    if (entry) {
      this.go({ place: { kind: "file", file: { path, name: entry.name, size: entry.size ?? null, mtime: entry.mtime ?? null, mime: entry.mime ?? null } }, pages: keep, error: null, loading: false });
      return Promise.resolve();
    }
    return this.run({ place: { kind: "file", file: { path, name: baseName(path), size: null, mtime: null, mime: null } }, pages: keep, loading: true, error: null }, () => this.api.probe(path), (probe) => {
      // A probe that finds a folder (a link led here): list it instead.
      if (probe.kind === "dir") return this.load({ kind: "dir", path });
      this.update({ place: { kind: "file", file: { path, name: baseName(path), size: probe.size, mtime: null, mime: probe.mime } }, loading: false });
      return undefined;
    });
  }

  /** Lists `place` from its first page. */
  private load(place: { kind: "dir"; path: string }): Promise<void> {
    const { hidden } = this.snapshot;
    const where = this.where();
    // The same folder's pages stay up (greyed by `loading`) while it reloads; another folder's go.
    return this.run(
      { place, pages: this.snapshot.pages?.path === place.path ? this.snapshot.pages : null, loading: true, error: null },
      async () => (await this.folders.take(place.path, hidden)) ?? listFolder(this.api, where, place.path, 0, hidden),
      // The daemon answers with the canonical path; the place follows it.
      (listing) => {
        const pages = { ...listing, hidden };
        this.folders.seed(pages, hidden);
        this.update({ place: { ...place, path: listing.path }, pages, loading: false });
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
    case "outside_roots": return "That's outside your folders.";
    case "outside_home": return "Only folders inside your home folder can be added.";
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
