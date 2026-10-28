import type { SavedWorkspace, TabKey } from "../../platform/types";
import type { TmuxListing } from "../../proto/generated/messages";
import type { Fixtures } from "../fixture";
import { serveTree } from "../files/fakes";
import { Gallery } from "./Gallery";

const key = (session: number): TabKey => ({ host: "h-pop", session: { server: "main:1-1", session } });

export const LISTING: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: [
    {
      id: 1,
      name: "tether",
      bell: { mark: 0, covered: true },
      windows: [
        { id: 1, index: 0, name: "agent", active: true, activity: 0 },
        { id: 2, index: 1, name: "shell", active: false, activity: 0 },
      ],
    },
    { id: 2, name: "notes", bell: { mark: 0, covered: true }, windows: [{ id: 3, index: 0, name: "shell", active: true, activity: 0 }] },
  ],
};

/** Two tabs saved by a previous page load; the third names a session the daemon no longer has. */
export const SAVED: SavedWorkspace = {
  version: 3,
  tabs: [
    { kind: "terminal", key: key(1), session: "tether", window: "agent" },
    { kind: "terminal", key: key(2), session: "notes", window: "shell" },
    { kind: "terminal", key: key(99), session: "gone", window: "window" },
  ],
  active: "h-pop/main:1-1/$1",
  lastTerminal: { "h-pop": "h-pop/main:1-1/$1" },
};

/** `SAVED`'s tabs (the third names a session that is gone) and a Files tab after the first. */
export const WITH_FILES: SavedWorkspace = {
  ...SAVED,
  tabs: SAVED.tabs.flatMap((t, i) => (i === 0 ? [t, { kind: "files" as const, id: "files-1", host: "h-pop", place: { kind: "dir" as const, path: "~" } }] : [t])),
};

export const fixtures: Fixtures = {
  /** Admitted, no tabs. */
  home: { daemon: (d) => { d.listing = LISTING; serveTree(d); } },
  /** Admitted, with a saved workspace: restore decides each tab from the first listing. */
  restored: { options: () => ({ workspace: SAVED }), daemon: (d) => { d.listing = LISTING; serveTree(d); } },
  /** The daemon has no tmux server. */
  noServer: { daemon: (d) => { d.listing = null; } },
  enrol: { daemon: (d) => { d.node = "notEnrolled"; d.nodeName = "laptop"; } },
  wrongOrigin: { daemon: (d) => { if (d.info !== "down") d.info = { ...d.info, browserOrigin: "https://other.tail.ts.net" }; } },
  originRefused: { daemon: (d) => { if (d.info !== "down") d.info = { ...d.info, browserOrigin: null, browserRefused: "ambiguous_origin" }; } },
  nodeRefused: { daemon: (d) => { d.node = "refused"; d.refusedReason = "routes"; } },
  incompatible: { daemon: (d) => { if (d.info !== "down") d.info = { ...d.info, protocol: { min: 3, max: 4 } }; } },
  unreachable: { daemon: (d) => { d.info = "down"; } },
  /** The daemon can't decide: Home keeps its place, and says "Checking access…" after 10 s. */
  deciding: { daemon: (d) => { d.node = "busy"; } },
  /** A token-admitted host: no page origin, admitted until the transport reports a refusal. */
  tokenHost: { options: () => ({ hosts: [{ handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null }] }), daemon: (d) => { d.listing = LISTING; } },
  /** Every primitive in every state, for the design-system review and axe. */
  gallery: { render: Gallery, daemon: (d) => { d.listing = LISTING; } },
};

