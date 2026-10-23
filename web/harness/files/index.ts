// Fixtures for the Files lane: the real app on a fake file tree served through the fake
// daemon's `/fs` routes, open at `#/files`. The saved workspace stands in for the router's
// Files place after a reload, so each fixture can open at a folder or a preview. Watches are
// answered, so an inserted path reaches a tab's real input.
import type { SavedWorkspace } from "../../platform/types";
import type { Fixture, Fixtures } from "../fixture";
import { LISTING, SAVED } from "../shared";
import { filesTree, HOME, REPO, serveTree, type FilesFs } from "./fakes";
import type { FakeTree } from "../../platform/test/fs";

const at = (place: NonNullable<SavedWorkspace["files"]>["place"] | null, tree?: FakeTree, configure?: (fs: FilesFs) => void): Fixture => ({
  options: () => ({ workspace: { ...SAVED, files: place && { hostId: "h-pop", place } } }),
  daemon: (d) => {
    d.listing = LISTING;
    d.watch = "ok";
    serveTree(d, tree, configure);
  },
});

export const fixtures: Fixtures = {
  /** The roots list; two tabs open, the active one live. */
  files: at(null),
  filesFolder: at({ kind: "dir", path: REPO }),
  filesMarkdown: at({ kind: "file", path: `${REPO}/README.md` }),
  filesCode: at({ kind: "file", path: `${REPO}/src/main.rs` }),
  filesImage: at({ kind: "file", path: `${REPO}/shot.png` }),
  filesVideo: at({ kind: "file", path: `${REPO}/demo.mp4` }),
  filesBinary: at({ kind: "file", path: `${REPO}/tether.bin` }),
  filesEmpty: at({ kind: "dir", path: `${REPO}/empty` }),
  /** No roots configured at all. */
  filesNoRoots: at(null, { ...filesTree(), roots: [], dirs: [HOME, `${HOME}/code`] }),
  /** The folder refuses to list. */
  filesDenied: at({ kind: "dir", path: REPO }, undefined, (fs) => { fs.denied.add(REPO); }),
};
