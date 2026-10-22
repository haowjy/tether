// The file API client (fs.md). Hand-written wire types until src/proto/fs.rs is generated
// for TypeScript like the WebSocket messages; keep them in step with fs.md "Routes".

import type { ErrorBody, HttpError } from "../proto/generated/messages";

export interface RootEntry {
  /** As stored in config.toml. */
  path: string;
  /** Null when the entry is missing or not a directory. */
  canonical: string | null;
  ok: boolean;
}

export interface Roots {
  /** The canonical $HOME. */
  home: string;
  roots: RootEntry[];
  uploadsDir: RootEntry;
}

export interface Entry {
  name: string;
  /** After following a link. */
  kind: "dir" | "file" | "other" | "broken";
  /** The entry itself is a symlink. */
  link: boolean;
  size?: number;
  /** Unix seconds; absent for "broken" and in the picker. */
  mtime?: number;
  /** Files: the type /fs/raw would send. */
  mime?: string;
  /** Present (false) only for a name that isn't UTF-8: listed, never openable. */
  utf8?: false;
}

export interface Listing {
  path: string;
  root: string;
  /** Null when the parent is outside the scope. */
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

/**
 * The daemon's generated codes, plus the client's own: `network` when nothing answered,
 * `incompatible` from native's proxy, `http_<status>` for a refusal without a code.
 */
export type ErrorCode = HttpError | "network" | "incompatible" | `http_${string}`;

/** A refusal: the daemon's `{"error": code}` ({@link ErrorBody}), or one of the client's codes. */
export class FsError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode) {
    super(code);
  }
}

export interface FsApi {
  roots(): Promise<Roots>;
  list(path: string, offset: number, hidden: boolean): Promise<Listing>;
  /** The $HOME picker: directories only. */
  dirs(path: string, offset: number, hidden: boolean): Promise<Listing>;
  addRoot(path: string): Promise<Roots>;
  removeRoot(path: string): Promise<Roots>;
  setUploadsDir(path: string): Promise<Roots>;
  probe(path: string): Promise<Probe>;
  text(path: string, limit: number, signal?: AbortSignal): Promise<TextPreview>;
  /** The URL an `<img>` loads a file from. */
  rawUrl(path: string): string;
}

/** `busy` is answered with `Retry-After: 1`; a couple of retries ride out a burst. */
const BUSY_RETRIES = 2;

/**
 * One request to a host's HTTP origin. A refusal becomes an {@link FsError} with the
 * daemon's code, a dead network `network`; `busy` is retried `retries` times.
 */
export async function send(target: string, init: RequestInit = {}, retries = BUSY_RETRIES, fetchFn: typeof fetch = (input, opts) => fetch(input, opts)): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(target, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new FsError(0, "network");
    }
    if (res.ok) return res;
    const code = await res.json().then((b: unknown) => (b as Partial<ErrorBody> | null)?.error, () => undefined);
    const err = new FsError(res.status, typeof code === "string" ? code : `http_${String(res.status)}`);
    if (err.code !== "busy" || attempt >= retries) throw err;
    const wait = Number(res.headers.get("Retry-After")) || 1;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
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
  const post = (route: string, path: string): Promise<Roots> =>
    json<Roots>(`${origin}/fs/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
  const page = (offset: number, hidden: boolean): string => `?offset=${String(offset)}&hidden=${hidden ? "1" : "0"}`;

  return {
    roots: () => json<Roots>(`${origin}/fs/roots`),
    list: (path, offset, hidden) => json<Listing>(url("list", path, page(offset, hidden))),
    dirs: (path, offset, hidden) => json<Listing>(url("dirs", path, page(offset, hidden))),
    addRoot: (path) => post("roots/add", path),
    removeRoot: (path) => post("roots/remove", path),
    setUploadsDir: (path) => post("uploads-dir", path),

    async probe(path) {
      try {
        const res = await send(url("raw", path), { headers: { Range: "bytes=0-0" } }, BUSY_RETRIES, fetchFn);
        void res.body?.cancel();
        const size = res.status === 206 ? totalOf(res.headers.get("Content-Range")) : Number(res.headers.get("Content-Length") ?? NaN);
        return { kind: "file", mime: res.headers.get("Content-Type"), size: Number.isFinite(size) ? size : null };
      } catch (error) {
        if (error instanceof FsError && error.code === "not_a_file") return { kind: "dir" };
        if (error instanceof FsError && error.code === "bad_range") return { kind: "file", mime: null, size: 0 }; // empty
        throw error;
      }
    },

    async text(path, limit, signal) {
      let res: Response;
      try {
        res = await send(url("raw", path), { headers: { Range: `bytes=0-${String(limit - 1)}` }, ...(signal && { signal }) }, BUSY_RETRIES, fetchFn);
      } catch (error) {
        if (error instanceof FsError && error.code === "bad_range") return { text: "", size: 0, truncated: false };
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
