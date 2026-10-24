// Fixtures for the phone dock and the session switcher: the saved workspace restored against a
// daemon that answers `watch`, so the dock opens on a live tab in the phone layout.
import type { Fixtures } from "../fixture";
import { LISTING, SAVED } from "../shared";

export const fixtures: Fixtures = {
  /** A live tab with two others open, in the phone layout: the dock at rest. */
  dock: { options: () => ({ workspace: SAVED }), daemon: (d) => { d.listing = LISTING; d.watch = "ok"; } },
  /** No tab open: the dock's chip reads "Sessions". */
  dockEmpty: { daemon: (d) => { d.listing = LISTING; } },
};
