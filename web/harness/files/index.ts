// Fixtures for the Files lane: the screen on a fake file tree, framed as Home's phone pane
// or the desktop destination, open at `#/files`. The saved workspace stands in for the
// router's Files place after a reload, so each fixture can open at a folder or a preview.
import { h } from "preact";
import type { SavedWorkspace } from "../../platform/types";
import type { Fixture, Fixtures } from "../fixture";
import { LISTING, SAVED } from "../shared";
import { Frame } from "./Frame";
import { filesTree, REPO } from "./fakes";

const at = (place: NonNullable<SavedWorkspace["files"]>["place"] | null): Fixture => ({
  options: () => ({ workspace: { ...SAVED, files: place && { hostId: "h-pop", place } } }),
  daemon: (d) => { d.listing = LISTING; },
  render: () => h(Frame, {}),
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
  filesNoRoots: {
    ...at(null),
    render: () => h(Frame, { tree: { ...filesTree(), roots: [], dirs: [] } }),
  },
  /** The folder refuses to list. */
  filesDenied: {
    ...at({ kind: "dir", path: REPO }),
    render: () => h(Frame, { configure: (fs) => { fs.denied.add(REPO); } }),
  },
};
