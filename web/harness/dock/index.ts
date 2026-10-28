// Fixtures for the phone dock and the sessions overlay: the saved workspace restored against a
// daemon that answers `watch`, so the dock opens on a live tab in the phone layout.
import type { Fixtures } from "../fixture";
import type { TmuxListing } from "../../proto/generated/messages";
import { serveTree } from "../files/fakes";
import { LISTING, SAVED, WITH_FILES } from "../shared";

const win = (id: number, index: number, name: string) => ({ id, index, name, active: index === 0, activity: 0 });

/** Eight sessions on one server; `tether` has three windows. */
const SEVERAL: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: [
    { id: 1, name: "tether", bell: { mark: 0, covered: true }, windows: [win(1, 0, "agent"), win(2, 1, "shell"), win(4, 2, "logs")] },
    { id: 2, name: "notes", bell: { mark: 0, covered: true }, windows: [win(3, 0, "shell")] },
    ...["blog", "infra", "dotfiles", "scratch", "mars", "a-session-with-a-very-long-name-that-has-to-truncate"].map((name, i) => ({ id: i + 5, name, bell: { mark: 0, covered: true }, windows: [win(20 + i, 0, "zsh")] })),
  ],
};

const SHEET = { screen: "sessions", name: "sheet" } as const;

export const fixtures: Fixtures = {
  /** A live tab with two others open, in the phone layout: the dock at rest. */
  dock: { options: () => ({ workspace: SAVED }), openActive: true, daemon: (d) => { d.listing = LISTING; d.watch = "ok"; } },
  /** No tab open: the dock's chip reads "Sessions". */
  dockEmpty: { daemon: (d) => { d.listing = LISTING; } },
  /** The sessions overlay over a live tab: several sessions, the active one with three windows ("here" and its windows), another open, a Files tab in the strip. The overlay name picks the form, so this is the half-height sheet in either layout. */
  sessions: { options: () => ({ workspace: WITH_FILES }), openActive: true, overlay: SHEET, daemon: (d) => { d.listing = SEVERAL; d.watch = "ok"; serveTree(d); } },
  /** The half-height sheet with two servers listed: each side groups its list by server. */
  sessionsTwoServers: {
    options: () => ({
      workspace: WITH_FILES,
      hosts: [
        { handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null },
        { handle: "h2", hostId: "h-mac", name: "jimmys-macbook-air", pageOrigin: null },
      ],
    }),
    openActive: true,
    overlay: SHEET,
    daemon: (d) => { d.listing = SEVERAL; d.watch = "ok"; serveTree(d); },
  },
  /** The overlay over a Files tab: no session reads "here". */
  sessionsOnFiles: {
    options: () => ({ workspace: { ...WITH_FILES, active: "files-1" } }),
    openActive: true,
    overlay: SHEET,
    daemon: (d) => { d.listing = SEVERAL; d.watch = "ok"; serveTree(d); },
  },
  /** No tab open and the server has no sessions. */
  sessionsEmpty: { overlay: SHEET, daemon: (d) => { d.listing = { server: "main:1-1", version: "3.4", sessions: [] }; } },
  /** The server can't be reached: the saved tabs stay, the list says it can't load yet. */
  sessionsOffline: { options: () => ({ workspace: WITH_FILES }), openActive: true, overlay: SHEET, daemon: (d) => { d.info = "down"; serveTree(d); } },
};
