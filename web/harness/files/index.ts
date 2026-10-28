// Fixtures for the Files lane: the real app on a fake file tree served through the fake
// daemon's `/fs` routes, open on a Files tab. The saved workspace holds that tab and its
// place, so each fixture can open at a folder or a preview. Watches are answered, so an
// inserted path reaches a tab's real input.
import type { FilesPlace } from "../../platform/types";
import type { Fixture, Fixtures } from "../fixture";
import { LISTING, SAVED } from "../shared";
import { ETC, filesTree, findTree, FIND_ROOT, HOME, REPO, serveTree, type FilesFs } from "./fakes";
import type { FakeTree } from "../../platform/test/fs";

const at = (place: FilesPlace, tree?: FakeTree, configure?: (fs: FilesFs) => void): Fixture => ({
  options: () => ({ workspace: { ...SAVED, tabs: [...SAVED.tabs, { kind: "files", id: "files-1", host: "h-pop", place: place }], active: "files-1" } }),
  openActive: true,
  daemon: (d) => {
    d.listing = LISTING;
    d.watch = "ok";
    serveTree(d, tree, configure);
  },
});

export const fixtures: Fixtures = {
  /** A new Files tab: it opens `~`. */
  files: at({ kind: "dir", path: "~" }),
  filesFolder: at({ kind: "dir", path: REPO }),
  filesMarkdown: at({ kind: "file", path: `${REPO}/README.md` }),
  filesCode: at({ kind: "file", path: `${REPO}/src/main.rs` }),
  filesImage: at({ kind: "file", path: `${REPO}/shot.png` }),
  filesVideo: at({ kind: "file", path: `${REPO}/demo.mp4` }),
  filesBinary: at({ kind: "file", path: `${REPO}/tether.bin` }),
  filesEmpty: at({ kind: "dir", path: `${REPO}/empty` }),
  /** `/`: no up row. */
  filesRoot: at({ kind: "dir", path: "/" }),
  /** A folder, and a file, outside the home folder. */
  filesOutside: at({ kind: "dir", path: ETC }),
  filesOutsideFile: at({ kind: "file", path: `${ETC}/hosts` }),
  /** No favorites configured. */
  filesNoFavorites: at({ kind: "dir", path: "~" }, { ...filesTree(), favorites: [] }),
  /** A folder that was deleted or moved since the tab last showed it. */
  filesGone: at({ kind: "dir", path: `${HOME}/gone/deeper` }),
  /** Finding folders by path (the path field), on a home with `~/repos/tether` as its one favorite. */
  filesFind: at({ kind: "dir", path: FIND_ROOT }, findTree()),
  /** Listing `src` never answers (slow), `docs` is refused (denied), the network drops `src` (offline), the daemon cuts `web` short at its scan cap (capped). */
  filesFindSlow: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.hanging.add(`${FIND_ROOT}/src`); }),
  filesFindDenied: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.denied.add(`${FIND_ROOT}/docs`); }),
  filesFindOffline: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.unreachable.add(`${FIND_ROOT}/src`); }),
  filesFindCapped: at({ kind: "dir", path: FIND_ROOT }, findTree(), (fs) => { fs.capped.add(`${FIND_ROOT}/web`); }),
  /** The folder refuses to list. */
  filesDenied: at({ kind: "dir", path: REPO }, undefined, (fs) => { fs.denied.add(REPO); }),
};
