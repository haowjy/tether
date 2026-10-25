// A file API over an in-memory tree, following fs.md's rules closely enough for the
// browser model's tests: roots scope the list, the picker is $HOME, dirs sort first, pages
// of `page` entries. Paths are already canonical.
import { HttpRefusal } from "../../net/http";
import type { Entry, FsApi, Listing, Roots } from "../../files/api";
import { within } from "../../files/paths";
import type { FakeDaemon } from ".";

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
  /** Every call fails as a dead network does. */
  offline = false;
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
      if (path === this.tree.home || !within(path, this.tree.home)) throw new HttpRefusal(403, "outside_home");
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
      if (mime === undefined) throw new HttpRefusal(404, "not_found");
      return { kind: "file" as const, mime, size: 10 };
    });
  }

  text(path: string): Promise<{ text: string; size: number; truncated: boolean }> {
    if (this.tree.files[path] === undefined) return Promise.reject(new HttpRefusal(404, "not_found"));
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
    if (root === undefined) throw new HttpRefusal(403, dirsOnly ? "outside_home" : "outside_roots");
    if (!this.tree.dirs.includes(path)) throw new HttpRefusal(404, this.tree.files[path] ? "not_a_directory" : "not_found");
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
    const run = (): Promise<T> => new Promise((resolve, reject) => { if (this.offline) reject(new HttpRefusal(0, "network")); else resolve(body()); });
    if (!this.hold) return run();
    return new Promise((resolve, reject) => { this.held.push(() => { run().then(resolve, reject); }); });
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** `/home/a%20b` → `/home/a b`: the inverse of the client's per-segment percent-encoding. */
const decodePath = (encoded: string): string => encoded.split("/").map(decodeURIComponent).join("/");

/**
 * The daemon's `/fs/*` routes (fs.md "Routes") over `fs`, for `FakeDaemon.fs`: the app's real
 * HTTP client talks to the tree. A raw read answers the whole file as 206 with its
 * `Content-Range`, which the client's one-byte probe and its text preview both accept.
 */
export function serveFs(fs: FakeFs): NonNullable<FakeDaemon["fs"]> {
  const page = (query: URLSearchParams): [number, boolean] => [Number(query.get("offset") ?? 0), query.get("hidden") === "1"];
  const bodyPath = (body: string | null): string => (JSON.parse(body ?? "{}") as { path: string }).path;
  const route = async ({ method, path, query, body }: Parameters<NonNullable<FakeDaemon["fs"]>>[0]): Promise<Response> => {
    const at = (prefix: string): string => decodePath(path.slice(prefix.length));
    if (method === "GET" && path === "/fs/roots") return json(200, await fs.roots());
    if (method === "GET" && path.startsWith("/fs/list/")) return json(200, await fs.list(at("/fs/list"), ...page(query)));
    if (method === "GET" && path.startsWith("/fs/dirs/")) return json(200, await fs.dirs(at("/fs/dirs"), ...page(query)));
    if (method === "POST" && path === "/fs/roots/add") return json(200, await fs.addRoot(bodyPath(body)));
    if (method === "POST" && path === "/fs/roots/remove") return json(200, await fs.removeRoot(bodyPath(body)));
    if (method === "POST" && path === "/fs/uploads-dir") return json(200, await fs.setUploadsDir(bodyPath(body)));
    if (method === "GET" && path.startsWith("/fs/raw/")) {
      const target = at("/fs/raw");
      const probed = await fs.probe(target);
      if (probed.kind === "dir") throw new HttpRefusal(400, "not_a_file");
      const { text } = await fs.text(target);
      if (text === "") throw new HttpRefusal(416, "bad_range");
      const bytes = new TextEncoder().encode(text).length;
      return new Response(text, { status: 206, headers: { "Content-Type": probed.mime ?? "application/octet-stream", "Content-Range": `bytes 0-${String(bytes - 1)}/${String(bytes)}` } });
    }
    return json(404, { error: "not_found" });
  };
  return (request) => route(request).catch((error: unknown) => {
    if (error instanceof HttpRefusal) return json(error.status, { error: error.code });
    throw error;
  });
}
