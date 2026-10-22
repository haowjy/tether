import type { HostEntry, Native } from "../native/bridge";
import { Host, type Link } from "../net/host";
import { HostLink, type LinkHandlers } from "../proto/link";
import { CloseCode } from "../proto/generated/messages";
import { httpFsApi, type FsApi } from "../files/api";
import { httpComplete, type CompleteFn } from "../complete/suggest";

/** Everything that talks to one host, built once when native first lists it. */
export interface HostClient {
  /** Native's latest word on the host. */
  readonly entry: HostEntry;
  /** The one WebSocket all its tabs share. */
  readonly socket: Host;
  readonly fs: FsApi;
  readonly complete: CompleteFn;
}

/**
 * The one place a host's WebSocket URL is built: from native's `baseURL`, never the name
 * (ios-shell.md "Boot and host payloads"). The dev shim's `baseURL` is the page's own
 * origin, which the Vite proxy forwards.
 */
export function socketUrl(host: HostEntry): string {
  const url = new URL("/ws", host.baseURL);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  return url.href;
}

/**
 * A {@link Link} whose token comes from native, so the socket opens a moment after the
 * host asks for it. Native may answer that the app is locked or the host not enrolled;
 * both end the attempt like a closed socket would.
 */
class TokenLink implements Link {
  private inner: HostLink | null = null;
  private closed = false;

  constructor(entry: HostEntry, native: Native, handlers: LinkHandlers) {
    native.token(entry.id).then(
      (reply) => {
        if (this.closed) return;
        if ("token" in reply) {
          this.inner = new HostLink({ url: socketUrl(entry), token: reply.token, build: import.meta.env.MODE, kind: native.kind }, handlers);
        } else if ("notEnrolled" in reply) {
          handlers.close({ code: CloseCode.BadToken, retry: false });
        } else {
          handlers.close({ code: 1006, retry: true }); // locked: the host backs off until `lock` says otherwise
        }
      },
      () => { if (!this.closed) handlers.close({ code: 1006, retry: true }); },
    );
  }

  get ready(): boolean {
    return this.inner?.ready ?? false;
  }

  send(msg: Parameters<Link["send"]>[0]): void {
    this.inner?.send(msg);
  }

  close(): void {
    this.closed = true;
    this.inner?.close();
  }
}

/**
 * The hosts native knows, each with its {@link HostClient}. The sockets run only while the
 * app is active and unlocked; a host that disappears from the list closes.
 */
export class HostRegistry {
  private readonly hosts = new Map<string, HostClient>();
  private active = true;
  private locked: boolean;

  constructor(
    private readonly native: Native,
    private readonly onStuck: () => void,
    locked: boolean,
  ) {
    this.locked = locked;
  }

  get(id: string): HostClient | undefined {
    return this.hosts.get(id);
  }

  /** In native's order. */
  all(): HostClient[] {
    return [...this.hosts.values()];
  }

  /** The `hosts` message: add new hosts and drop those no longer listed. */
  set(entries: HostEntry[]): void {
    for (const entry of entries) {
      const known = this.hosts.get(entry.id);
      this.hosts.set(entry.id, known ? { ...known, entry } : this.create(entry));
    }
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, { socket }] of this.hosts) {
      if (ids.has(id)) continue;
      socket.background();
      this.hosts.delete(id);
    }
    this.apply();
  }

  setActive(active: boolean): void {
    this.active = active;
    this.apply();
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    this.apply();
  }

  /** The network came back. */
  nudge(): void {
    for (const { socket } of this.hosts.values()) socket.nudge();
  }

  private create(entry: HostEntry): HostClient {
    const { id } = entry;
    const origin = this.native.httpOrigin(entry);
    const socket = new Host({
      // Each socket is built from native's latest entry for the host.
      open: (handlers) => new TokenLink(this.hosts.get(id)?.entry ?? entry, this.native, handlers),
      onRejected: () => { this.native.hostRejected(id); },
      onStuck: this.onStuck,
    });
    return { entry, socket, fs: httpFsApi(origin), complete: httpComplete(origin) };
  }

  private apply(): void {
    const running = this.active && !this.locked;
    for (const { socket } of this.hosts.values()) {
      if (running) socket.foreground();
      else socket.background();
    }
  }
}
