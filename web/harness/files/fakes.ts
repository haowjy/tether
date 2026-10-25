// The Files fixtures' file tree with content (platform/test/fs.ts is the listing; this adds
// what the viewers read).
import { HttpRefusal } from "../../net/http";
import type { FakeDaemon } from "../../platform/test";
import { FakeFs, serveFs, type FakeTree } from "../../platform/test/fs";

const README = `# tether

Your tmux sessions, wherever you are.

## Building

\`\`\`sh
cargo build --release
pnpm --dir web install
\`\`\`

See [the design](docs/plan.md) and the [fs notes](docs/fs.md), or [the site](https://example.com).

- Small and bounded
- Private to the tailnet

<img alt="map" usemap="#m" src="shot.png"><map name="m"><area shape="default" href="https://evil.example/"></map>
<details><summary>more</summary>hidden</details>
<svg><a href="https://evil.example/"><text y="9">svg link</text></a></svg>
`;

const MAIN_RS = `use std::io;

/// Starts the daemon.
fn main() -> io::Result<()> {
    let name = "tether";
    println!("starting {name}");
    Ok(())
}
`;

export const HOME = "/home/jimmy";
export const REPO = `${HOME}/tether`;
export const UPLOADS = `${HOME}/tether-uploads`;
/** A folder under $HOME whose link leads outside it: the picker lists it, and the daemon refuses to add it. */
export const ESCAPE = `${HOME}/escape`;

const MD = "text/markdown; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

export function filesTree(): FakeTree {
  const extra = Array.from({ length: 12 }, (_, i) => `${REPO}/notes/note-${String(i + 1).padStart(2, "0")}.txt`);
  return {
    home: HOME,
    roots: [REPO, `${HOME}/notes`],
    uploads: UPLOADS,
    dirs: [HOME, REPO, `${REPO}/src`, `${REPO}/docs`, `${REPO}/notes`, `${REPO}/.git`, `${REPO}/empty`, `${HOME}/notes`, UPLOADS, `${HOME}/other`, `${HOME}/other/deep`, `${HOME}/.config`, ESCAPE],
    files: {
      [`${REPO}/README.md`]: MD,
      [`${REPO}/Cargo.toml`]: TEXT,
      [`${REPO}/src/main.rs`]: TEXT,
      [`${REPO}/docs/plan.md`]: MD,
      [`${REPO}/docs/fs.md`]: MD,
      [`${REPO}/shot.png`]: "image/png",
      [`${REPO}/demo.mp4`]: "video/mp4",
      [`${REPO}/tether.bin`]: "application/octet-stream",
      [`${REPO}/.env`]: TEXT,
      [`${UPLOADS}/20261022-101010Z-abcd.jpg`]: "image/jpeg",
      ...Object.fromEntries(extra.map((path) => [path, TEXT])),
    },
  };
}

/**
 * A home folder for finding folders by path: one root (`~/repos/tether`) inside a `~/repos` that
 * holds more, a folder of twenty subfolders (three pages), and ones to refuse, hang on and cap.
 */
export const FIND_ROOT = `${HOME}/repos/tether`;
export function findTree(): FakeTree {
  const many = Array.from({ length: 20 }, (_, i) => `${HOME}/repos/many/folder-${String(i + 1).padStart(2, "0")}`);
  return {
    home: HOME,
    roots: [FIND_ROOT],
    uploads: UPLOADS,
    dirs: [
      HOME, `${HOME}/repos`, FIND_ROOT, `${FIND_ROOT}/src`, `${FIND_ROOT}/web`, `${FIND_ROOT}/docs`, `${FIND_ROOT}/empty`, `${FIND_ROOT}/.git`, `${FIND_ROOT}/web/src`,
      `${HOME}/repos/tether-old`, `${HOME}/repos/test-data`, `${HOME}/repos/zebra`, `${HOME}/repos/many`, ...many,
      UPLOADS, `${HOME}/other`, `${HOME}/other/deep`, `${HOME}/.config`, ESCAPE,
    ],
    files: {
      [`${FIND_ROOT}/README.md`]: MD,
      [`${FIND_ROOT}/Cargo.toml`]: TEXT,
      [`${HOME}/repos/notes.txt`]: TEXT,
      [`${UPLOADS}/20261022-101010Z-abcd.jpg`]: "image/jpeg",
    },
  };
}

const CONTENT: Record<string, string> = {
  [`${REPO}/README.md`]: README,
  [`${REPO}/Cargo.toml`]: '[package]\nname = "tether"\nversion = "0.1.0"\n',
  [`${REPO}/src/main.rs`]: MAIN_RS,
  [`${REPO}/docs/plan.md`]: "# Plan\n\nThe product and UX spec.\n",
  [`${REPO}/docs/fs.md`]: "# File API\n\nRoots, listing, raw reads.\n",
  [`${REPO}/.env`]: "TOKEN=hidden\n",
};

/** The file tree with content for the viewers. Images are served by the harness's dev server (vite.config.ts). */
export class FilesFs extends FakeFs {
  /** Paths whose listing is refused, for the error state. */
  denied = new Set<string>();
  /** Paths whose listing never answers, for the loading state. */
  hanging = new Set<string>();
  /** Paths the network drops, for the offline state. */
  unreachable = new Set<string>();
  /** Paths whose listing the daemon says it cut short at its scan cap. */
  capped = new Set<string>();

  override async list(path: string, offset: number, hidden: boolean): ReturnType<FakeFs["list"]> {
    return this.guarded(path, await super.list(path, offset, hidden));
  }

  override async dirs(path: string, offset: number, hidden: boolean): ReturnType<FakeFs["dirs"]> {
    return this.guarded(path, await super.dirs(path, offset, hidden));
  }

  private guarded<T extends { truncated: boolean }>(path: string, listing: T): Promise<T> {
    if (this.denied.has(path)) return Promise.reject(new HttpRefusal(403, "denied"));
    if (this.unreachable.has(path)) return Promise.reject(new TypeError("Failed to fetch"));
    if (this.hanging.has(path)) return new Promise(() => undefined);
    return Promise.resolve(this.capped.has(path) ? { ...listing, truncated: true } : listing);
  }

  override addRoot(path: string): ReturnType<FakeFs["addRoot"]> {
    if (path === ESCAPE) return Promise.reject(new HttpRefusal(403, "outside_home"));
    return super.addRoot(path);
  }

  override text(path: string): Promise<{ text: string; size: number; truncated: boolean }> {
    const text = CONTENT[path] ?? `${path.split("/").pop() ?? path}\n`;
    return Promise.resolve({ text, size: text.length, truncated: false });
  }
}

/** Serves a tree over the fake daemon's `/fs` routes; the real app browses it through its own HTTP client. */
export function serveTree(daemon: FakeDaemon, tree: FakeTree = filesTree(), configure?: (fs: FilesFs) => void): void {
  const fs = new FilesFs(tree, 8);
  configure?.(fs);
  daemon.fs = serveFs(fs);
}
