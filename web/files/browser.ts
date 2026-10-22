import { FsError, type Entry, type FsApi, type Listing, type Roots } from "./api";

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
  error: FsError | null;
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

/**
 * The file manager's state, apart from the DOM: which place is shown, the directory pages
 * loaded for it, and the roots. Nothing is fetched until a place needs it, and only the
 * page in view (plan.md "Bandwidth").
 */
export class FileBrowser {
  /** The host's file API, which the viewers read through too. */
  readonly api: FsApi;
  private readonly onHidden: ((hidden: boolean) => void) | undefined;
  private readonly listeners = new Set<() => void>();
  private view: FilesView;
  /** Bumped on every navigation, so an answer for a place already left is dropped. */
  private seq = 0;

  constructor(opts: BrowserOptions) {
    this.api = opts.api;
    this.onHidden = opts.onHidden;
    this.view = { place: { kind: "roots" }, roots: null, pages: null, loading: true, error: null, hidden: opts.hidden, saving: false };
  }

  get snapshot(): FilesView {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Opens at `cwd` when a root holds it, else at the roots (plan.md "File manager"). */
  async start(cwd: string | null): Promise<void> {
    const seq = ++this.seq;
    this.update({ place: { kind: "roots" }, loading: true, error: null });
    try {
      const roots = await this.api.roots();
      if (seq !== this.seq) return;
      this.update({ roots });
      if (cwd && scope(roots).some((root) => within(cwd, root))) await this.openDir(cwd);
      else this.update({ loading: false });
    } catch (error) {
      if (seq === this.seq) this.fail(error);
    }
  }

  /** The roots list. */
  async showRoots(): Promise<void> {
    const seq = ++this.seq;
    this.update({ place: { kind: "roots" }, loading: true, error: null });
    try {
      const roots = await this.api.roots();
      if (seq === this.seq) this.update({ roots, loading: false });
    } catch (error) {
      if (seq === this.seq) this.fail(error);
    }
  }

  openDir(path: string): Promise<void> {
    return this.load({ kind: "dir", path }, "list", path);
  }

  /** A listing entry tapped. */
  async openEntry(entry: Entry): Promise<void> {
    const dir = this.view.pages?.path;
    if (dir === undefined || entry.utf8 === false) return;
    const path = join(dir, entry.name);
    if (this.view.place.kind === "pick") {
      if (entry.kind === "dir") await this.load({ ...this.view.place, path }, "dirs", path);
      return;
    }
    if (entry.kind === "dir") await this.openDir(path);
    else if (entry.kind === "file") {
      this.seq++;
      this.update({ place: { kind: "file", file: { path, name: entry.name, size: entry.size ?? null, mtime: entry.mtime ?? null, mime: entry.mime ?? null } }, error: null, loading: false });
    }
  }

  /** A path from a Markdown link: a file is viewed, a directory listed. */
  async openPath(path: string): Promise<void> {
    const seq = ++this.seq;
    this.update({ loading: true, error: null });
    try {
      const probe = await this.api.probe(path);
      if (seq !== this.seq) return;
      if (probe.kind === "dir") {
        await this.openDir(path);
        return;
      }
      if (this.view.pages?.path !== parentOf(path)) this.view = { ...this.view, pages: null };
      this.update({ place: { kind: "file", file: { path, name: baseName(path), size: probe.size, mtime: null, mime: probe.mime } }, loading: false });
    } catch (error) {
      if (seq === this.seq) this.fail(error);
    }
  }

  /** `[<]` in the sheet's header: up one level, out of a viewer, or back to Settings. */
  async back(): Promise<void> {
    const { place, pages } = this.view;
    switch (place.kind) {
      case "roots":
        return;
      case "file": {
        const dir = parentOf(place.file.path);
        // The listing it was opened from is still loaded, scrolled where it was.
        if (pages?.path === dir && pages.source === "list") {
          this.seq++;
          this.update({ place: { kind: "dir", path: dir }, error: null, loading: false });
        } else {
          await this.openDir(dir);
        }
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
        if (pages?.path === place.path && pages.parent !== null) await this.load({ ...place, path: pages.parent }, "dirs", pages.parent);
        else this.showSettings();
        return;
    }
  }

  /** The current listing again from its first page: pull-to-refresh, or after an upload. */
  async reload(): Promise<void> {
    const { place } = this.view;
    if (place.kind === "dir") await this.openDir(place.path);
    else if (place.kind === "pick") await this.load(place, "dirs", place.path);
    else if (place.kind === "roots" || place.kind === "settings") {
      const seq = ++this.seq;
      this.update({ loading: true, error: null });
      try {
        const roots = await this.api.roots();
        if (seq === this.seq) this.update({ roots, loading: false });
      } catch (error) {
        if (seq === this.seq) this.fail(error);
      }
    }
  }

  /** The next page, when the list scrolls near its end. */
  async more(): Promise<void> {
    const { pages, loading } = this.view;
    if (!pages || loading || pages.entries.length >= pages.total) return;
    const seq = this.seq;
    this.update({ loading: true });
    try {
      const offset = pages.entries.length;
      const next = await (pages.source === "list" ? this.api.list(pages.path, offset, pages.hidden) : this.api.dirs(pages.path, offset, pages.hidden));
      if (seq !== this.seq || this.view.pages !== pages) return;
      this.update({ pages: { ...pages, total: next.total, truncated: next.truncated, entries: [...pages.entries, ...next.entries] }, loading: false });
    } catch (error) {
      if (seq === this.seq) this.fail(error);
    }
  }

  async toggleHidden(): Promise<void> {
    const hidden = !this.view.hidden;
    this.update({ hidden });
    this.onHidden?.(hidden);
    const { place } = this.view;
    if (place.kind === "dir" || place.kind === "pick") await this.reload();
  }

  /** An upload landed at `path`: relist if it is in the folder on screen. */
  async uploaded(path: string): Promise<void> {
    const { place } = this.view;
    if (place.kind === "dir" && place.path === parentOf(path)) await this.reload();
  }

  showSettings(): void {
    this.seq++;
    this.update({ place: { kind: "settings" }, loading: false, error: null });
    if (!this.view.roots) void this.reload();
  }

  /** The $HOME picker, to add a root or move the uploads folder. */
  async pick(purpose: "root" | "uploads"): Promise<void> {
    const home = this.view.roots?.home;
    if (home) await this.load({ kind: "pick", purpose, path: home }, "dirs", home);
  }

  /** "Add this folder" / "Use this folder" in the picker. */
  async choose(): Promise<void> {
    const { place } = this.view;
    if (place.kind !== "pick") return;
    await this.save(() => (place.purpose === "root" ? this.api.addRoot(place.path) : this.api.setUploadsDir(place.path)));
  }

  async removeRoot(path: string): Promise<void> {
    await this.save(() => this.api.removeRoot(path));
  }

  private async save(change: () => Promise<Roots>): Promise<void> {
    if (this.view.saving) return;
    const seq = ++this.seq;
    this.update({ saving: true, error: null });
    try {
      const roots = await change();
      this.update({ roots, saving: false, ...(seq === this.seq && { place: { kind: "settings" }, loading: false }) });
    } catch (error) {
      this.update({ saving: false });
      if (seq === this.seq) this.fail(error);
    }
  }

  private async load(place: Place, source: Pages["source"], path: string): Promise<void> {
    const seq = ++this.seq;
    const hidden = this.view.hidden;
    // The old pages stay up (greyed by `loading`) until the new ones arrive, unless they
    // belong to another kind of list.
    const keep = this.view.pages?.source === source ? this.view.pages : null;
    this.update({ place, pages: keep, loading: true, error: null });
    try {
      const listing = await (source === "list" ? this.api.list(path, 0, hidden) : this.api.dirs(path, 0, hidden));
      if (seq !== this.seq) return;
      // The daemon answers with the canonical path; the place follows it.
      const at = { ...place, path: listing.path } as Place;
      this.update({ place: at, pages: { ...listing, source, hidden }, loading: false });
    } catch (error) {
      if (seq !== this.seq) return;
      // Another folder's entries mustn't stand in for the one that failed.
      if (this.view.pages?.path !== path) this.view = { ...this.view, pages: null };
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    this.update({ loading: false, error: error instanceof FsError ? error : new FsError(0, "internal") });
  }

  private update(patch: Partial<FilesView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
}

/** One line for a refusal, in the file manager's words (fs.md "Errors"). */
export function describeError(error: FsError, host: string): string {
  switch (error.code) {
    case "network": return `Can't reach ${host}. Is Tailscale on?`;
    case "outside_roots": return "That's outside your folders.";
    case "outside_home": return "Only folders inside your home folder can be added.";
    case "denied": return "Permission denied.";
    case "not_found": return "It isn't there any more.";
    case "not_a_directory": return "That's a file, not a folder.";
    case "not_a_file": return "That isn't a regular file.";
    case "busy": return `${host} is busy. Try again in a moment.`;
    case "config_unavailable": return "tether can't read config.toml on the server. Fix it there.";
    case "config_read_only": return "config.toml can't be written on the server.";
    case "incompatible": return `tether on ${host} is a different version.`;
    case "auth_required": case "forbidden": case "http_401": return `This iPhone isn't enrolled on ${host}.`;
    case "bad_request": return "The server refused that path.";
    default: return `Something went wrong on ${host} (${error.code}).`;
  }
}
