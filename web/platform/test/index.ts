// The in-memory Platform for vitest and the Playwright harness. Only tests and harness/
// import it (lint rule 4). The daemon is faked at two seams, so the real code above runs:
// HTTP (`fetch`, which answers /auth/*) and the socket (a FakeLink that welcomes and answers
// listings and watches). Nothing here knows which environment it stands in for.
import { FakeLink } from "./host";
import type { AuthInfo } from "../../net/admission";
import type { LinkHandlers } from "../../proto/link";
import type { ClientMsg, TmuxListing } from "../../proto/generated/messages";
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
  UploadEvent,
  Viewport,
} from "../types";

/** An upload that ends at once with no events: the stub until the Files lane scripts uploads. */
function noEvents(): AsyncIterable<UploadEvent> {
  return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) };
}

export const PHONE: Viewport = {
  layout: "phone",
  density: "touch",
  directInput: "owned",
  scheme: "dark",
  width: 393,
  stableHeight: 852,
  visibleHeight: 852,
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
  /** Requests seen, `"METHOD /path"`, in order. */
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
}

export interface TestPlatform extends Platform {
  daemon: FakeDaemon;
  fetch: typeof fetch;
  emit(event: PlatformEvent): void;
  setViewport(patch: Partial<Viewport>): void;
  setLifecycle(patch: Partial<Lifecycle>): void;
  setUpdate(state: UpdateState): void;
  /** Every socket the app opened, newest last. */
  links: FakeLink[];
  focusRequests: string[];
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
    info: { hostId: "h-pop", name: "pop-os", protocol: { min: 1, max: 1 }, browserOrigin: PAGE_ORIGIN, browserRefused: null },
    node: "enrolled",
    nodeName: "laptop",
    refusedReason: "routes",
    code: "123456",
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
    daemon.requests.push(`${method} ${url.pathname}`);
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
      default:
        return Promise.resolve(json(404, { error: "not_found" }));
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

export function createTestPlatform(options: TestPlatformOptions = {}): TestPlatform {
  const daemon = defaultDaemon();
  const listeners = new Set<(event: PlatformEvent) => void>();
  let viewport = options.viewport ?? DESKTOP;
  let lifecycle = options.lifecycle ?? { visible: true, online: true, locked: false };
  const hosts = options.hosts ?? [{ handle: "h1", hostId: null, name: null, pageOrigin: PAGE_ORIGIN }];

  const platform: TestPlatform = {
    daemon,
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

    boot: (): Promise<BootResult> => Promise.resolve({ hosts, workspace: options.workspace ?? null, viewport, lifecycle }),
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
          handlers.welcome({ protocol: 1, daemon: { version: "0", completion: false }, host: { id, name: daemon.info.name } });
        });
        const send = link.send.bind(link);
        link.send = (msg: ClientMsg) => {
          send(msg);
          if (msg.type === "listSessions") link.say({ type: "sessions", data: { req: msg.data.req, tmux: daemon.listing } });
        };
        return link;
      },
      httpBase: () => "",
    },
    input: {
      setFocus: (mode) => { platform.focusRequests.push(mode); },
      composeResult: () => undefined,
      composeShow: () => undefined,
    },
    storage: {
      saveWorkspace: (ws) => { platform.savedWorkspaces.push(ws); },
      drafts: {
        get: (key: TabKey) => Promise.resolve(platform.drafts.get(JSON.stringify(key)) ?? null),
        put(record, baseRevision) {
          const k = JSON.stringify(record.key);
          const stored = platform.drafts.get(k);
          if (stored && stored.revision > baseRevision) return Promise.resolve("conflict");
          platform.drafts.set(k, record);
          return Promise.resolve("ok");
        },
        delete: (key) => {
          platform.drafts.delete(JSON.stringify(key));
          return Promise.resolve();
        },
        list: () => Promise.resolve([...platform.drafts.values()]),
      },
      clearLocalData: () => {
        platform.drafts.clear();
        return Promise.resolve();
      },
    },
    uploads: { pick: () => noEvents() },
    clipboard: {
      writeText: (text) => {
        platform.clipboardWrites.push(text);
        return Promise.resolve("ok");
      },
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
  return platform;
}
