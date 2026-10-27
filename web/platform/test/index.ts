// The in-memory Platform for vitest and the harness. Only tests and harness/
// import it (lint rule 4). The daemon is faked at two seams, so the real code above runs:
// HTTP (`fetch`, which answers /auth/*) and the socket (a FakeLink that welcomes and answers
// listings and watches). Nothing here knows which environment it stands in for.
import { tabId } from "../tabKey";
import { FakeLink } from "./host";
import { UploadScript } from "./uploads";
import type { AuthInfo } from "../../net/admission";
import type { LinkHandlers } from "../../proto/link";
import type { ClientMsg, SessionRef, ShownWindow, Size, TmuxListing } from "../../proto/generated/messages";
import type {
  BootResult,
  DraftRecord,
  HapticKind,
  HostEntry,
  Lifecycle,
  Platform,
  PlatformEvent,
  SavedWorkspace,
  TabKey,
  UpdateState,
  Viewport,
} from "../types";

export const PHONE: Viewport = {
  layout: "phone",
  density: "touch",
  directInput: "owned",
  scheme: "dark",
  width: 393,
  stableHeight: 852,
  visibleHeight: 852,
  keyboardInset: 0,
  safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
  keyboard: false,
};

export const DESKTOP: Viewport = {
  layout: "desktop",
  density: "compact",
  directInput: "xterm",
  scheme: "dark",
  width: 1280,
  stableHeight: 800,
  visibleHeight: 800,
  keyboardInset: 0,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  keyboard: false,
};

/** What the fake daemon says. Tests and fixtures edit it between steps. */
export interface FakeDaemon {
  /** `/auth/info`: `"down"` answers nothing. */
  info: AuthInfo | "down";
  /** `/auth/node/session`. */
  node: "enrolled" | "notEnrolled" | "refused" | "busy" | "badOrigin";
  nodeName: string;
  refusedReason: string;
  /** The code `POST /auth/node/enroll` accepts. */
  code: string;
  listing: TmuxListing | null;
  /** How the daemon answers `watch`: a snapshot, a refusal for its session limit, or nothing (the default). */
  watch?: "ok" | { limit: string } | "never";
  /** The size every watched window has: the watching tab's own size when unset. A size that is not the tab's shows the band. */
  windowSize?: Size;
  /** Answers `/fs/*` requests (`serveFs` serves a tree); `undefined` falls through to a 404. */
  fs?: (request: { method: string; path: string; query: URLSearchParams; body: string | null }) => Response | Promise<Response> | undefined;
  /** Requests seen, `"METHOD /path?query"`, in order. */
  requests: string[];
}

export const PAGE_ORIGIN = "https://pop-os.tail.ts.net";

export interface TestPlatformOptions {
  viewport?: Viewport;
  lifecycle?: Lifecycle;
  workspace?: SavedWorkspace | null;
  /** `pageOrigin: null` stands in for a token-admitted host. */
  hosts?: HostEntry[];
  /** Offer `updates` and `install` capabilities. */
  pwa?: boolean;
  /** Offer `manageHosts`, as the app does (Add server, Settings' Manage servers); a tap is recorded in `opened`. */
  managed?: boolean;
}

export interface TestPlatform extends Platform {
  daemon: FakeDaemon;
  fetch: typeof fetch;
  emit(event: PlatformEvent): void;
  setViewport(patch: Partial<Viewport>): void;
  setLifecycle(patch: Partial<Lifecycle>): void;
  setUpdate(state: UpdateState): void;
  /** What `uploads.pick` streams: a spec pushes progress, a path or an error, then ends the pick. */
  uploadScript: UploadScript;
  /** Every socket the app opened, newest last. */
  links: FakeLink[];
  focusRequests: string[];
  /** Every `input.setActiveTab` call, newest last. */
  clipboardWrites: string[];
  opened: string[];
  haptics: HapticKind[];
  restarts: string[];
  savedWorkspaces: SavedWorkspace[];
  drafts: Map<string, DraftRecord>;
  /** What `install.installed()` reports, when the capability is offered. */
  installed: boolean;
}

export function defaultDaemon(): FakeDaemon {
  return {
    info: { hostId: "h-pop", name: "pop-os", protocol: { min: 2, max: 2 }, browserOrigin: PAGE_ORIGIN, browserRefused: null },
    node: "enrolled",
    nodeName: "laptop",
    refusedReason: "routes",
    code: "7KQ4XM2P",
    listing: null,
    requests: [],
  };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function daemonFetch(daemon: FakeDaemon): typeof fetch {
  return (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://x");
    const method = init?.method ?? "GET";
    daemon.requests.push(`${method} ${url.pathname}${url.search}`);
    if (daemon.info === "down") return Promise.reject(new TypeError("network"));
    switch (`${method} ${url.pathname}`) {
      case "GET /auth/info":
        return Promise.resolve(json(200, daemon.info));
      case "GET /auth/node/session":
        return Promise.resolve(nodeReply(daemon));
      case "POST /auth/node/enroll": {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { code?: string };
        if (daemon.node === "refused") return Promise.resolve(nodeReply(daemon));
        if (daemon.node === "busy") return Promise.resolve(json(503, { error: "busy" }));
        if (body.code !== daemon.code) return Promise.resolve(json(403, { error: "bad_code" }));
        daemon.node = "enrolled";
        return Promise.resolve(json(200, { deviceName: daemon.nodeName }));
      }
      case "POST /auth/node/remove":
        daemon.node = "notEnrolled";
        return Promise.resolve(new Response(null, { status: 204 }));
      default: {
        const answer = url.pathname.startsWith("/fs/")
          ? daemon.fs?.({ method, path: url.pathname, query: url.searchParams, body: typeof init?.body === "string" ? init.body : null })
          : undefined;
        return Promise.resolve(answer ?? json(404, { error: "not_found" }));
      }
    }
  };
}

function nodeReply(daemon: FakeDaemon): Response {
  switch (daemon.node) {
    case "enrolled":
      return json(200, { deviceName: daemon.nodeName });
    case "notEnrolled":
      return json(401, { error: "not_enrolled", node: { name: daemon.nodeName } });
    case "refused":
      return json(403, { error: "node_refused", reason: daemon.refusedReason });
    case "badOrigin":
      return json(403, { error: "bad_origin" });
    case "busy":
      return json(503, { error: "identity_unavailable" });
  }
}

/** Tells the tab which window its session shows now, with that window's snapshot, as the daemon does for a watch and for every change of the current window. */
function showWindow(link: FakeLink, daemon: FakeDaemon, watch: number, session: SessionRef, size: Size): void {
  const current = daemon.listing?.sessions.find((s) => s.id === session.session)?.windows.find((w) => w.active);
  if (!current) return;
  const window: ShownWindow = { id: current.id, index: current.index, name: current.name, size: daemon.windowSize ?? size };
  link.say({ type: "watching", data: { watch, window, session, pane: current.id, cwd: null } });
  link.frame({ kind: "snapshot", watch, cols: window.size.cols, rows: window.size.rows, restore: new TextEncoder().encode(`${current.name}$ `) });
}

function answerWatch(link: FakeLink, daemon: FakeDaemon, msg: Extract<ClientMsg, { type: "watch" }>, watches: Map<number, { session: SessionRef; size: Size }>): void {
  const { watch, session, size } = msg.data;
  if (daemon.watch === undefined || daemon.watch === "never") return;
  if (daemon.watch !== "ok") {
    link.say({ type: "watchEnded", data: { watch, reason: "limit", message: daemon.watch.limit } });
    return;
  }
  watches.set(watch, { session, size });
  showWindow(link, daemon, watch, session, size);
}

/** `selectWindow` changes the session's current window; the watching tab follows. */
function changeWindow(link: FakeLink, daemon: FakeDaemon, msg: Extract<ClientMsg, { type: "selectWindow" }>, watches: Map<number, { session: SessionRef; size: Size }>): void {
  const session = watches.get(msg.data.watch)?.session;
  const listed = daemon.listing?.sessions.find((s) => s.id === session?.session);
  if (!session || !listed) return;
  const target = listed.windows.find((w) => w.id === msg.data.window);
  if (!target) {
    link.say({ type: "error", data: { req: msg.data.req, watch: msg.data.watch, code: "tmux", message: "can't find window" } });
    return;
  }
  for (const w of listed.windows) w.active = w === target;
  for (const [watch, w] of watches) if (w.session.session === session.session) showWindow(link, daemon, watch, session, w.size);
  link.say({ type: "sessionsChanged" });
}

export function createTestPlatform(options: TestPlatformOptions = {}): TestPlatform {
  const daemon = defaultDaemon();
  const listeners = new Set<(event: PlatformEvent) => void>();
  let viewport = options.viewport ?? DESKTOP;
  let lifecycle = options.lifecycle ?? { visible: true, online: true, locked: false, covered: false };
  const hosts = options.hosts ?? [{ handle: "h1", hostId: null, name: null, pageOrigin: PAGE_ORIGIN }];

  const uploadScript = new UploadScript();
  const platform: TestPlatform = {
    daemon,
    uploadScript,
    fetch: daemonFetch(daemon),
    links: [],
    focusRequests: [],
    clipboardWrites: [],
    opened: [],
    haptics: [],
    restarts: [],
    savedWorkspaces: [],
    drafts: new Map(),
    installed: false,

    boot: (): Promise<BootResult> => Promise.resolve({ hosts, workspace: options.workspace ?? null, viewport, lifecycle, focusMode: null, lineSnapshot: null }),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(event) {
      for (const l of [...listeners]) l(event);
    },
    setViewport(patch) {
      viewport = { ...viewport, ...patch };
      platform.emit({ type: "viewport", viewport });
    },
    setLifecycle(patch) {
      lifecycle = { ...lifecycle, ...patch };
      platform.emit({ type: "lifecycle", lifecycle });
    },
    setUpdate(state) {
      platform.emit({ type: "update", state });
    },

    transport: {
      openSocket(_handle: string, handlers: LinkHandlers) {
        const link = new FakeLink(handlers);
        platform.links.push(link);
        queueMicrotask(() => {
          if (link.closed || daemon.info === "down") {
            if (!link.closed) link.drop(1006);
            return;
          }
          const id = daemon.info.hostId;
          link.ready = true;
          handlers.welcome({ protocol: 2, daemon: { version: "0", completion: false }, host: { id, name: daemon.info.name } });
        });
        const send = link.send.bind(link);
        const watches = new Map<number, { session: SessionRef; size: Size }>();
        link.send = (msg: ClientMsg) => {
          send(msg);
          if (msg.type === "listSessions") link.say({ type: "sessions", data: { req: msg.data.req, tmux: daemon.listing } });
          else if (msg.type === "watch") answerWatch(link, daemon, msg, watches);
          else if (msg.type === "selectWindow") changeWindow(link, daemon, msg, watches);
        };
        return link;
      },
      httpBase: () => "",
    },
    input: {
      setFocus: (mode) => { platform.focusRequests.push(mode); },
      setLine: () => Promise.resolve(0),
      setLineCaret: () => undefined,
      stepLineCaret: () => undefined,
      insertLine: () => undefined,
      submitLine: () => undefined,
      selectAllLine: () => undefined,
      setArmedModifier: () => undefined,
      setActiveTab: () => {},
    },
    storage: {
      saveWorkspace: (ws) => { platform.savedWorkspaces.push(ws); },
      drafts: {
        get: (key: TabKey) => Promise.resolve(platform.drafts.get(tabId(key)) ?? null),
        put(record, baseRevision) {
          const k = tabId(record.key);
          const stored = platform.drafts.get(k);
          if (stored && stored.revision > baseRevision) return Promise.resolve("conflict");
          platform.drafts.set(k, record);
          return Promise.resolve("ok");
        },
        delete: (key) => {
          platform.drafts.delete(tabId(key));
          return Promise.resolve();
        },
        list: () => Promise.resolve([...platform.drafts.values()]),
      },
      clearLocalData: () => {
        platform.drafts.clear();
        return Promise.resolve();
      },
    },
    uploads: { pick: () => uploadScript.pick() },
    clipboard: {
      writeText: (text) => {
        platform.clipboardWrites.push(text);
        return Promise.resolve("ok");
      },
      read: () => Promise.resolve("empty"),
    },
    openURL: (url) => { platform.opened.push(url); },
    playVideo: () => "inline",
    haptic: (kind) => { platform.haptics.push(kind); },
    restart: (reason) => { platform.restarts.push(reason); },
  };

  if (options.pwa) {
    platform.updates = { check: () => Promise.resolve(), apply: () => { platform.restarts.push("update"); } };
    platform.install = { installed: () => platform.installed };
  }
  if (options.managed) platform.manageHosts = () => { platform.opened.push("manage-hosts"); };
  return platform;
}
