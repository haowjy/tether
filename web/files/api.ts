// The file API client (fs.md). Hand-written wire types until src/proto/fs.rs is generated
// for TypeScript like the WebSocket messages; keep them in step with fs.md "Routes".

import { BUSY_RETRIES, HttpRefusal, send } from "../net/http";

export interface PlaceEntry {
  /** As stored in config.toml. */
  path: string;
  /** Null when the entry is missing or not a directory. */
  canonical: string | null;
  ok: boolean;
}

export interface Favorites {
  /** The canonical $HOME. */
  home: string;
  favorites: PlaceEntry[];
  uploadsDir: PlaceEntry;
}

export interface Entry {
  name: string;
  /** After following a link. */
  kind: "dir" | "file" | "other" | "broken";
  /** The entry itself is a symlink. */
  link: boolean;
  size?: number;
  /** Unix seconds; absent for "broken". */
  mtime?: number;
  /** Files: the type /fs/raw would send. */
  mime?: string;
  /** Present (false) only for a name that isn't UTF-8: listed, never openable. */
  utf8?: false;
}

export interface Listing {
  path: string;
  /** Null only at `/`. */
  parent: string | null;
  total: number;
  offset: number;
  truncated: boolean;
  entries: Entry[];
}

/** A file's first bytes as text, for the code and Markdown viewers. */
export interface TextPreview {
  text: string;
  /** The whole file's size, when the response says. */
  size: number | null;
  truncated: boolean;
}

/** What a one-byte read says about a path: its type and size, or that it is a directory. */
export type Probe = { kind: "file"; mime: string | null; size: number | null } | { kind: "dir" };

export interface FsApi {
  favorites(): Promise<Favorites>;
  list(path: string, offset: number, hidden: boolean): Promise<Listing>;
  addFavorite(path: string): Promise<Favorites>;
  removeFavorite(path: string): Promise<Favorites>;
  setUploadsDir(path: string): Promise<Favorites>;
  probe(path: string): Promise<Probe>;
  text(path: string, limit: number, signal?: AbortSignal): Promise<TextPreview>;
  /** The URL an `<img>` loads a file from. */
  rawUrl(path: string): string;
}

/** `/a/b c` → `/a/b%20c`: each segment percent-encoded, joined with `/` (fs.md "Routes"). */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** The inverse of {@link encodePath} for a `/fs/raw/…` URL path; null for any other URL path. */
export function rawPathOf(urlPath: string): string | null {
  const prefix = "/fs/raw/";
  if (!urlPath.startsWith(prefix)) return null;
  try {
    return "/" + urlPath.slice(prefix.length).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

/** `bytes 0-99/1234` → 1234; null when absent or unreadable (native must expose it). */
function totalOf(contentRange: string | null): number | null {
  const m = contentRange ? /\/(\d+)\s*$/.exec(contentRange) : null;
  return m?.[1] ? Number(m[1]) : null;
}

/**
 * The file API on one host's HTTP origin: `tether-app://h-{host}` in the app, the dev
 * server's proxy on the desktop. Native (or the proxy) adds the Bearer token.
 */
export function httpFsApi(origin: string, fetchFn?: typeof fetch): FsApi {
  const url = (route: string, path: string, query = ""): string => `${origin}/fs/${route}${encodePath(path)}${query}`;
  const json = async <T>(target: string, init?: RequestInit): Promise<T> => (await (await send(target, init, BUSY_RETRIES, fetchFn)).json()) as T;
  const post = (route: string, path: string): Promise<Favorites> =>
    json<Favorites>(`${origin}/fs/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
  const page = (offset: number, hidden: boolean): string => `?offset=${String(offset)}&hidden=${hidden ? "1" : "0"}`;

  return {
    favorites: () => json<Favorites>(`${origin}/fs/favorites`),
    list: (path, offset, hidden) => json<Listing>(url("list", path, page(offset, hidden))),
    addFavorite: (path) => post("favorites/add", path),
    removeFavorite: (path) => post("favorites/remove", path),
    setUploadsDir: (path) => post("uploads-dir", path),

    async probe(path) {
      try {
        const res = await send(url("raw", path), { headers: { Range: "bytes=0-0" } }, BUSY_RETRIES, fetchFn);
        void res.body?.cancel();
        const size = res.status === 206 ? totalOf(res.headers.get("Content-Range")) : Number(res.headers.get("Content-Length") ?? NaN);
        return { kind: "file", mime: res.headers.get("Content-Type"), size: Number.isFinite(size) ? size : null };
      } catch (error) {
        if (error instanceof HttpRefusal && error.code === "not_a_file") return { kind: "dir" };
        if (error instanceof HttpRefusal && error.code === "bad_range") return { kind: "file", mime: null, size: 0 }; // empty
        throw error;
      }
    },

    async text(path, limit, signal) {
      let res: Response;
      try {
        res = await send(url("raw", path), { headers: { Range: `bytes=0-${String(limit - 1)}` }, ...(signal && { signal }) }, BUSY_RETRIES, fetchFn);
      } catch (error) {
        if (error instanceof HttpRefusal && error.code === "bad_range") return { text: "", size: 0, truncated: false };
        throw error;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const size = res.status === 206 ? totalOf(res.headers.get("Content-Range")) : bytes.length;
      return {
        text: new TextDecoder().decode(bytes),
        size,
        // Without Content-Range (a cross-origin header native may not expose), a full window means more may follow.
        truncated: size !== null ? size > bytes.length : bytes.length >= limit,
      };
    },

    rawUrl: (path) => url("raw", path),
  };
}
