// Fixtures for the terminal screen: the saved workspace restored against a daemon that
// answers `watch`, so each connection state can be photographed and checked with axe.
import type { Fixtures } from "../fixture";
import { LISTING, SAVED } from "../shared";

export const fixtures: Fixtures = {
  /** The active tab is bound and painted. */
  terminalLive: { options: () => ({ workspace: SAVED }), openActive: true, daemon: (d) => { d.listing = LISTING; d.watch = "ok"; } },
  /** The daemon refuses the watch for its session limit. */
  terminalLimited: {
    options: () => ({ workspace: SAVED }),
    openActive: true,
    daemon: (d) => { d.listing = LISTING; d.watch = { limit: "tether on pop-os allows 1 tmux session at a time; open now: notes" }; },
  },
};
