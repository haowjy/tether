// A file API over an in-memory tree, following fs.md's rules closely enough for the
// browser model's tests: roots scope the list, the picker is $HOME, dirs sort first, pages
// of `page` entries. Paths are already canonical.
import { FsError, type Entry, type FsApi, type Listing, type Roots } from "./api";
import { within } from "./browser";

export interface FakeTree {
  home: string;
  roots: string[];
  uploads: string;
  /** Directory paths and file paths (with their mime); parents are implied. */
  dirs: string[];
  files: Record<string, string>;
}

export class FakeFs implements FsApi {
  calls: string[] = [];
  /** Answers wait for `release()` while set, so a test can interleave them. */
  hold = false;
  private held: (() => void)[] = [];

  constructor(readonly tree: FakeTree, readonly page = 3) {}

  release(): void {
    const waiting = this.held;
    this.held = [];
    for (const go of waiting) go();
  }

  roots(): Promise<Roots> {
    return this.answer("roots", () => this.rootsNow());
  }

  list(path: string, offset: number, hidden: boolean): Promise<Listing> {
    return this.answer(`list ${path} ${String(offset)}`, () => this.listing(this.scope(), path, offset, hidden, false));
  }

  dirs(path: string, offset: number, hidden: boolean): Promise<Listing> {
    return this.answer(`dirs ${path} ${String(offset)}`, () => this.listing([this.tree.home], path, offset, hidden, true));
  }

  addRoot(path: string): Promise<Roots> {
    return this.answer(`add ${path}`, () => {
      if (path === this.tree.home || !within(path, this.tree.home)) throw new FsError(403, "outside_home");
      if (!this.tree.roots.includes(path)) this.tree.roots.push(path);
      return this.rootsNow();
    });
  }

  removeRoot(path: string): Promise<Roots> {
    return this.answer(`remove ${path}`, () => {
      this.tree.roots = this.tree.roots.filter((r) => r !== path);
      return this.rootsNow();
    });
  }

  setUploadsDir(path: string): Promise<Roots> {
    return this.answer(`uploads ${path}`, () => {
      this.tree.uploads = path;
      return this.rootsNow();
    });
  }

  probe(path: string): Promise<{ kind: "dir" } | { kind: "file"; mime: string | null; size: number | null }> {
    return this.answer(`probe ${path}`, () => {
      if (this.tree.dirs.includes(path)) return { kind: "dir" as const };
      const mime = this.tree.files[path];
      if (mime === undefined) throw new FsError(404, "not_found");
      return { kind: "file" as const, mime, size: 10 };
    });
  }

  text(): Promise<{ text: string; size: number; truncated: boolean }> {
    return Promise.resolve({ text: "", size: 0, truncated: false });
  }

  rawUrl(path: string): string {
    return `fake://h/fs/raw${path}`;
  }

  private scope(): string[] {
    return [...this.tree.roots, this.tree.uploads];
  }

  private rootsNow(): Roots {
    const entry = (path: string) => ({ path, canonical: path, ok: this.tree.dirs.includes(path) });
    return { home: this.tree.home, roots: this.tree.roots.map(entry), uploadsDir: entry(this.tree.uploads) };
  }

  private listing(scope: string[], path: string, offset: number, hidden: boolean, dirsOnly: boolean): Listing {
    const root = scope.filter((r) => within(path, r)).sort((a, b) => b.length - a.length)[0];
    if (root === undefined) throw new FsError(403, dirsOnly ? "outside_home" : "outside_roots");
    if (!this.tree.dirs.includes(path)) throw new FsError(404, this.tree.files[path] ? "not_a_directory" : "not_found");
    const childOf = (p: string): string | null => {
      const rest = p.slice(path === "/" ? 1 : path.length + 1);
      return within(p, path) && p !== path && !rest.includes("/") ? rest : null;
    };
    const entries: Entry[] = [
      ...this.tree.dirs.flatMap((d) => { const name = childOf(d); return name ? [{ name, kind: "dir" as const, link: false }] : []; }),
      ...(dirsOnly ? [] : Object.entries(this.tree.files).flatMap(([f, mime]) => {
        const name = childOf(f);
        return name ? [{ name, kind: "file" as const, link: false, size: 10, mtime: 0, mime }] : [];
      })),
    ].filter((e) => hidden || !e.name.startsWith("."));
    const parent = path.slice(0, Math.max(1, path.lastIndexOf("/")));
    return {
      path,
      root,
      parent: path !== root && within(parent, root) ? parent : null,
      total: entries.length,
      offset,
      truncated: false,
      entries: entries.slice(offset, offset + this.page),
    };
  }

  private answer<T>(call: string, body: () => T): Promise<T> {
    this.calls.push(call);
    const run = (): Promise<T> => new Promise((resolve) => { resolve(body()); });
    if (!this.hold) return run();
    return new Promise((resolve, reject) => { this.held.push(() => { run().then(resolve, reject); }); });
  }
}
