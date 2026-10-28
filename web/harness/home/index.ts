import { LISTING, SAVED, WITH_FILES } from "../shared";
import { serveTree } from "../files/fakes";
import type { TmuxListing } from "../../proto/generated/messages";
import type { Fixtures } from "../fixture";
import { Cards } from "./Cards";
import { States } from "./States";

const win = (id: number, index: number, name: string) => ({ id, index, name, active: index === 0, activity: 0 });

/** Thirty sessions with long names: the list must scroll, search must narrow it, and nothing may overflow. */
const MANY: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    name: i === 7 ? "a-session-with-a-very-long-name-that-has-to-truncate-instead-of-pushing-the-row-wider" : `project-${String(i + 1).padStart(2, "0")}`,
    bell: { mark: 0, covered: true }, windows: [win((i + 1) * 10, 0, "editor"), win((i + 1) * 10 + 1, 1, i % 2 ? "server" : "shell")],
  })),
};

const SEVERAL: TmuxListing = {
  server: "main:1-1",
  version: "3.4",
  sessions: ["tether", "notes", "blog", "infra", "dotfiles", "scratch", "mars", "a-session-with-a-very-long-name-that-has-to-truncate", "api"].map((name, i) => ({
    id: i + 1,
    name,
    bell: { mark: 0, covered: true }, windows: [win(i * 10 + 1, 0, "zsh")],
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
  /** Every state of a Home server card at once. */
  homeCards: { render: Cards },
  /** Saved terminal tabs and a Files tab on a live server: rows on the card and "Sessions and files". */
  homeTabs: { options: () => ({ workspace: WITH_FILES }), daemon: (d) => { d.listing = SEVERAL; serveTree(d); } },
  /** Two servers, one card each, in the app (Add server shown). */
  homeTwoServers: {
    options: () => ({
      workspace: SAVED,
      managed: true,
      hosts: [
        { handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null },
        { handle: "h2", hostId: "h-mac", name: "jimmys-macbook-air", pageOrigin: null },
      ],
    }),
    daemon: (d) => { d.listing = LISTING; serveTree(d); },
  },
  /** The app with no server added: enrolment instructions and Add server. */
  homeNoServers: { options: () => ({ hosts: [], managed: true }) },
  /** A phone browser that hasn't installed the app: Home shows Add to Home Screen. */
  homeInstall: { options: () => ({ pwa: true }), daemon: (d) => { d.listing = LISTING; } },
  /** Settings, the page behind Home's gear, in the browser. */
  settings: { overlay: { screen: "settings", name: "settings" }, daemon: (d) => { d.listing = LISTING; } },
  /** Settings in the app: Manage servers, and no Remove this device (the host admits by token). */
  settingsApp: {
    options: () => ({ managed: true, hosts: [{ handle: "h1", hostId: "h-pop", name: "pop-os", pageOrigin: null }] }),
    overlay: { screen: "settings", name: "settings" },
    daemon: (d) => { d.listing = LISTING; },
  },
  /** A server's full-height sessions sheet, as "Sessions and files" opens it. */
  serverSheet: { overlay: { screen: "sessions", name: "server", params: { host: "h1" } }, daemon: (d) => { d.listing = SEVERAL; serveTree(d); } },
};
