import { SAVED } from "../shared";
import type { TmuxListing } from "../../proto/generated/messages";
import type { Fixtures } from "../fixture";
import { States } from "./States";

const win = (id: number, index: number, name: string) => ({ id, index, name, active: index === 0, activity: 0 });

/** Thirty sessions with long names: the list must scroll, search must narrow it, and nothing may overflow. */
const MANY: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: i === 7 ? "a-session-with-a-very-long-name-that-has-to-truncate-instead-of-pushing-the-row-wider" : `project-${String(i + 1).padStart(2, "0")}`,
    windows: [win((i + 1) * 10, 0, "editor"), win((i + 1) * 10 + 1, 1, i % 2 ? "server" : "shell")],
  })),
};

export const fixtures: Fixtures = {
  /** Thirty sessions, none open. */
  homeMany: { daemon: (d) => { d.listing = MANY; } },
  /** The daemon's tmux has no sessions. */
  emptyServer: { daemon: (d) => { d.listing = { server: "main:1-1", version: "3.4", sessions: [] }; } },
  /** Offline with a saved workspace: open tabs show as checking, drafts stay reachable. */
  offlineTabs: { options: () => ({ workspace: SAVED }), daemon: (d) => { d.info = "down"; } },
  /** Every state of the sessions list at once. */
  homeStates: { render: States },
};
