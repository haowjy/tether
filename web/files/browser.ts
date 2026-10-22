import { HttpRefusal } from "../net/http";
import type { Entry, FsApi, Listing, Roots } from "./api";
import { hostProblem, type HostProblem } from "../ui/hostProblem";
import { Store } from "../ui/store";

/** A file to view: from a listing, or from a path (a Markdown link) and a probe. */
export interface FileRef {
  path: string;
  name: string;
  size: number | null;
  /** Unix seconds; null when opened by path. */
  mtime: number | null;
  mime: string | null;
}

/** Where the file manager is. The Settings sheet and its $HOME picker live here too. */
export type Place =
  | { kind: "roots" }
  | { kind: "dir"; path: string }
  | { kind: "file"; file: FileRef }
  | { kind: "settings" }
  | { kind: "pick"; purpose: "root" | "uploads"; path: string };

/** A directory's pages loaded so far. */
export interface Pages extends Listing {
  /** The listing the pages came from: the file list or the picker. */
  source: "list" | "dirs";
  hidden: boolean;
}

export interface FilesView {
  place: Place;
  roots: Roots | null;
  /** The directory under the place: the dir itself, a viewed file's folder, or the picker's. */
  pages: Pages | null;
  loading: boolean;
  /** Why the place couldn't load; the screen offers to try again. */
  error: HttpRefusal | null;
  hidden: boolean;
  /** A Settings change in flight. */
  saving: boolean;
}

export interface BrowserOptions {
  api: FsApi;
  hidden: boolean;
  /** Called when the hidden-files toggle changes, so the next open keeps it. */
  onHidden?: (hidden: boolean) => void;
}

export const parentOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf("/")));
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || "/";
export const join = (dir: string, name: string): string => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);

/** `/a/repo` holds `/a/repo/x` but not `/a/repo2`: compared by component, as fs.md does. */
export function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/** The canonical directories the file list may show: the working roots and uploads_dir. */
export function scope(roots: Roots): string[] {
  return [...roots.roots, roots.uploadsDir].flatMap((r) => (r.ok && r.canonical ? [r.canonical] : []));
}

/** The places that list a directory. */
type ListedPlace = Extract<Place, { kind: "dir" | "pick" }>;

/**
 * The file manager's state, apart from the DOM: which place is shown, the directory pages
 * loaded for it, and the roots. Nothing is fetched until a place needs it, and only the
 * page in view (plan.md "Bandwidth").
 */
export class FileBrowser extends Store<FilesView> {
  /** The host's file API, which the viewers read through too. */
  readonly api: FsApi;
  private readonly onHidden: ((hidden: boolean) => void) | undefined;
  /** Bumped on every navigation, so an answer for a place already left is dropped. */
  private seq = 0;

  constructor(opts: BrowserOptions) {
    super({ place: { kind: "roots" }, roots: null, pages: null, loading: true, error: null, hidden: opts.hidden, saving: false });
    this.api = opts.api;
    this.onHidden = opts.onHidden;
  }

  /** Opens at `cwd` when a root holds it, else at the roots (plan.md "File manager"). */
  start(cwd: string | null): Promise<void> {
    return this.run({ place: { kind: "roots" }, loading: true, error: null }, () => this.api.roots(), async (roots) => {
      this.update({ roots });
      if (cwd && scope(roots).some((root) => within(cwd, root))) await this.openDir(cwd);
      else this.update({ loading: false });
    });
  }

  /** The roots list. */
  showRoots(): Promise<void> {
    return this.run({ place: { kind: "roots" }, loading: true, error: null }, () => this.api.roots(), (roots) => {
      this.update({ roots, loading: false });
    });
  }

  openDir(path: string): Promise<void> {
    return this.load({ kind: "dir", path });
  }

  /** A listing entry tapped. */
  async openEntry(entry: Entry): Promise<void> {
    const dir = this.snapshot.pages?.path;
    if (dir === undefined || entry.utf8 === false) return;
    const path = join(dir, entry.name);
    const { place } = this.snapshot;
    if (place.kind === "pick") {
      if (entry.kind === "dir") await this.load({ ...place, path });
      return;
    }
    if (entry.kind === "dir") await this.openDir(path);
    else if (entry.kind === "file") {
      this.go({ place: { kind: "file", file: { path, name: entry.name, size: entry.size ?? null, mtime: entry.mtime ?? null, mime: entry.mime ?? null } }, error: null, loading: false });
    }
  }

  /** A path from a Markdown link: a file is viewed, a directory listed. */
  openPath(path: string): Promise<void> {
    return this.run({ loading: true, error: null }, () => this.api.probe(path), async (probe) => {
      if (probe.kind === "dir") {
        await this.openDir(path);
        return;
      }
      const pages = this.snapshot.pages?.path === parentOf(path) ? this.snapshot.pages : null;
      this.update({ place: { kind: "file", file: { path, name: baseName(path), size: probe.size, mtime: null, mime: probe.mime } }, pages, loading: false });
    });
  }

  /** `[<]` in the sheet's header: up one level, out of a viewer, or back to Settings. */
  async back(): Promise<void> {
    const { place, pages } = this.snapshot;
    switch (place.kind) {
      case "roots":
        return;
      case "file": {
        const dir = parentOf(place.file.path);
        // The listing it was opened from is still loaded, scrolled where it was.
        if (pages?.path === dir && pages.source === "list") this.go({ place: { kind: "dir", path: dir }, error: null, loading: false });
        else await this.openDir(dir);
        return;
      }
      case "dir":
        if (pages?.path === place.path && pages.parent !== null) await this.openDir(pages.parent);
        else await this.showRoots();
        return;
      case "settings":
        await this.showRoots();
        return;
      case "pick":
        if (pages?.path === place.path && pages.parent !== null) await this.load({ ...place, path: pages.parent });
        else this.showSettings();
        return;
    }
  }

  /** The current listing again from its first page: pull-to-refresh, or after an upload. */
  async reload(): Promise<void> {
    const { place } = this.snapshot;
    if (place.kind === "dir" || place.kind === "pick") await this.load(place);
    else if (place.kind === "roots" || place.kind === "settings") {
      await this.run({ loading: true, error: null }, () => this.api.roots(), (roots) => { this.update({ roots, loading: false }); });
    }
  }

  /** The next page, when the list scrolls near its end. */
  async more(): Promise<void> {
    const { pages, loading, saving } = this.snapshot;
    // A page is a navigation too: it waits rather than cancel a Settings change's return.
    if (!pages || loading || saving || pages.entries.length >= pages.total) return;
    const offset = pages.entries.length;
    await this.run(
      { loading: true },
      () => (pages.source === "list" ? this.api.list(pages.path, offset, pages.hidden) : this.api.dirs(pages.path, offset, pages.hidden)),
      (next) => { this.update({ pages: { ...pages, total: next.total, truncated: next.truncated, entries: [...pages.entries, ...next.entries] }, loading: false }); },
    );
  }

  async toggleHidden(): Promise<void> {
    const hidden = !this.snapshot.hidden;
    this.update({ hidden });
    this.onHidden?.(hidden);
    const { place } = this.snapshot;
    if (place.kind === "dir" || place.kind === "pick") await this.reload();
  }

  /** An upload landed at `path`: relist if it is in the folder on screen. */
  async uploaded(path: string): Promise<void> {
    const { place } = this.snapshot;
    if (place.kind === "dir" && place.path === parentOf(path)) await this.reload();
  }

  showSettings(): void {
    this.go({ place: { kind: "settings" }, loading: false, error: null });
    if (!this.snapshot.roots) void this.reload();
  }

  /** The $HOME picker, to add a root or move the uploads folder. */
  async pick(purpose: "root" | "uploads"): Promise<void> {
    const home = this.snapshot.roots?.home;
    if (home) await this.load({ kind: "pick", purpose, path: home });
  }

  /** "Add this folder" / "Use this folder" in the picker. */
  async choose(): Promise<void> {
    const { place } = this.snapshot;
    if (place.kind !== "pick") return;
    await this.save(() => (place.purpose === "root" ? this.api.addRoot(place.path) : this.api.setUploadsDir(place.path)));
  }

  async removeRoot(path: string): Promise<void> {
    await this.save(() => this.api.removeRoot(path));
  }

  /** A Settings change: the roots it answers with apply even after a navigation; the place goes back to Settings only if none happened. */
  private async save(change: () => Promise<Roots>): Promise<void> {
    if (this.snapshot.saving) return;
    await this.run({ saving: true, error: null }, async () => {
      try {
        const roots = await change();
        this.update({ roots });
      } finally {
        this.update({ saving: false });
      }
    }, () => { this.update({ place: { kind: "settings" }, loading: false }); });
  }

  /** Lists `place` from its first page. */
  private load(place: ListedPlace): Promise<void> {
    const source = place.kind === "dir" ? "list" : "dirs";
    const hidden = this.snapshot.hidden;
    // The old pages stay up (greyed by `loading`) until the new ones arrive, unless they
    // belong to another kind of list.
    const keep = this.snapshot.pages?.source === source ? this.snapshot.pages : null;
    return this.run(
      { place, pages: keep, loading: true, error: null },
      () => (source === "list" ? this.api.list(place.path, 0, hidden) : this.api.dirs(place.path, 0, hidden)),
      // The daemon answers with the canonical path; the place follows it.
      (listing) => { this.update({ place: { ...place, path: listing.path }, pages: { ...listing, source, hidden }, loading: false }); },
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
    const stale = (place.kind === "dir" || place.kind === "pick") && pages?.path !== place.path;
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
