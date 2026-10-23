// The Files fixtures' stand-ins: a file tree with content (platform/test/fs.ts is the
// listing; this adds what the viewers read), and uploads a spec drives event by event.
import { encodePath } from "../../files/api";
import { HttpRefusal } from "../../net/http";
import { FakeFs, type FakeTree } from "../../platform/test/fs";
import type { UploadEvent, Uploads } from "../../platform/types";

const svg = (fill: string): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="${fill}"/><circle cx="320" cy="200" r="90" fill="white"/></svg>`)}`;

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

const CONTENT: Record<string, string> = {
  [`${REPO}/README.md`]: README,
  [`${REPO}/Cargo.toml`]: '[package]\nname = "tether"\nversion = "0.1.0"\n',
  [`${REPO}/src/main.rs`]: MAIN_RS,
  [`${REPO}/docs/plan.md`]: "# Plan\n\nThe product and UX spec.\n",
  [`${REPO}/docs/fs.md`]: "# File API\n\nRoots, listing, raw reads.\n",
  [`${REPO}/.env`]: "TOKEN=hidden\n",
};

/** The file tree with content for the viewers and a `data:` URL for each image. */
export class FilesFs extends FakeFs {
  /** Paths whose listing is refused, for the error state. */
  denied = new Set<string>();

  override list(path: string, offset: number, hidden: boolean): ReturnType<FakeFs["list"]> {
    if (this.denied.has(path)) return Promise.reject(new HttpRefusal(403, "denied"));
    return super.list(path, offset, hidden);
  }

  override addRoot(path: string): ReturnType<FakeFs["addRoot"]> {
    if (path === ESCAPE) return Promise.reject(new HttpRefusal(403, "outside_home"));
    return super.addRoot(path);
  }

  override text(path = ""): Promise<{ text: string; size: number; truncated: boolean }> {
    const text = CONTENT[path] ?? `${path.split("/").pop() ?? path}\n`;
    return Promise.resolve({ text, size: text.length, truncated: false });
  }

  override rawUrl(path: string): string {
    // Documents resolve their relative links against this, so it has the real route's shape.
    return path.endsWith(".png") || path.endsWith(".jpg") ? svg("#3b6ea8") : `/fs/raw${encodePath(path)}`;
  }
}

/** An upload stream a spec drives: `push` an event, `end` the pick. */
export class UploadScript implements Uploads {
  picks = 0;
  private buffered: UploadEvent[] = [];
  private waiting: ((r: IteratorResult<UploadEvent>) => void) | null = null;
  private ended = false;

  pick(): AsyncIterable<UploadEvent> {
    this.picks++;
    this.buffered = [];
    this.ended = false;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          const event = this.buffered.shift();
          if (event) return Promise.resolve({ done: false, value: event });
          if (this.ended) return Promise.resolve({ done: true, value: undefined });
          return new Promise((resolve) => { this.waiting = resolve; });
        },
      }),
    };
  }

  push(event: UploadEvent): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: false, value: event });
    } else {
      this.buffered.push(event);
    }
  }

  end(): void {
    this.ended = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ done: true, value: undefined });
    }
  }
}
