import type { HostEntry, Native } from "../native/bridge";
import { Host, type Link } from "../net/host";
import { HostLink, type LinkHandlers } from "../proto/link";
import { CloseCode } from "../proto/generated/messages";

/**
 * The one place a host's WebSocket URL is built (ios-shell.md "Where the web UI comes
 * from"). The desktop dev page reaches every host through the Vite proxy on its own origin.
 */
export function socketUrl(host: HostEntry): string {
  if (import.meta.env.DEV) return `${location.origin.replace(/^http/, "ws")}/ws`;
  return `wss://${host.name}/ws`;
}

/**
 * A {@link Link} whose token comes from native, so the socket opens a moment after the
 * host asks for it. Native may answer that the app is locked or the host not enrolled;
 * both end the attempt like a closed socket would.
 */
class TokenLink implements Link {
  private inner: HostLink | null = null;
  private closed = false;

  constructor(entry: HostEntry, native: Native, kind: "ios" | "web", handlers: LinkHandlers) {
    native.token(entry.id).then(
      (reply) => {
        if (this.closed) return;
        if ("token" in reply) {
          this.inner = new HostLink({ url: socketUrl(entry), token: reply.token, build: import.meta.env.MODE, kind }, handlers);
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
 * The hosts native knows, each with its one shared socket. The sockets run only while the
 * app is active and unlocked; a host that disappears from the list closes.
 */
export class HostRegistry {
  private readonly hosts = new Map<string, { entry: HostEntry; host: Host }>();
  private active = true;
  private locked: boolean;

  constructor(
    private readonly native: Native,
    private readonly kind: "ios" | "web",
    private readonly onStuck: () => void,
    locked: boolean,
  ) {
    this.locked = locked;
  }

  get(id: string): Host | undefined {
    return this.hosts.get(id)?.host;
  }

  entries(): HostEntry[] {
    return [...this.hosts.values()].map((h) => h.entry);
  }

  /** The `hosts` message: add new hosts and drop those no longer listed. */
  set(entries: HostEntry[]): void {
    for (const entry of entries) {
      const known = this.hosts.get(entry.id);
      if (known) known.entry = entry;
      else this.hosts.set(entry.id, { entry, host: this.create(entry) });
    }
    const ids = new Set(entries.map((e) => e.id));
    for (const [id, { host }] of this.hosts) {
      if (ids.has(id)) continue;
      host.background();
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
    for (const { host } of this.hosts.values()) host.nudge();
  }

  private create(entry: HostEntry): Host {
    return new Host({
      open: (handlers) => new TokenLink(entry, this.native, this.kind, handlers),
      onRejected: () => { this.native.hostRejected(entry.id); },
      onStuck: this.onStuck,
    });
  }

  private apply(): void {
    const running = this.active && !this.locked;
    for (const { host } of this.hosts.values()) {
      if (running) host.foreground();
      else host.background();
    }
  }
}
