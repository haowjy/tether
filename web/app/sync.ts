import type { Host, TabPort } from "../net/host";
import type { ServerMsg, TmuxListing, WindowRef } from "../proto/generated/messages";

const RELIST_DELAY_MS = 300;

/** Which tmux sessions and windows the host has; null when no tmux server runs. */
export function listWindows(host: Host): Promise<TmuxListing | null> {
  return host.request((req) => ({ type: "listSessions", data: { req } }), (reply) => (reply.type === "sessions" ? reply.data.tmux : undefined));
}

export interface HostSyncOptions {
  host: Host;
  onListing(listing: TmuxListing | null): void;
  onRenamed(window: WindowRef, name: string): void;
}

/**
 * Keeps a host's open tabs true to tmux. The daemon reports a kill only for windows with
 * a watch, and only the active tab has one, so this lists the host on every connect and,
 * debounced, on every `sessionsChanged`.
 */
export class HostSync {
  private readonly opts: HostSyncOptions;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly port: TabPort = {
    linkUp: () => { this.list(); },
    linkLost: () => { clearTimeout(this.timer); },
    paused: () => { clearTimeout(this.timer); },
    frame: () => undefined,
    message: (msg: ServerMsg) => {
      if (msg.type === "windowRenamed") this.opts.onRenamed(msg.data.window, msg.data.name);
      else if (msg.type === "sessionsChanged") {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { this.list(); }, RELIST_DELAY_MS);
      }
    },
  };

  constructor(opts: HostSyncOptions) {
    this.opts = opts;
    opts.host.join(this.port);
    if (opts.host.ready) this.list();
  }

  /** The last tab on the host closed. */
  stop(): void {
    clearTimeout(this.timer);
    this.opts.host.leave(this.port);
  }

  /** A failed listing is dropped: the next connect or change lists again. */
  private list(): void {
    listWindows(this.opts.host).then((listing) => { this.opts.onListing(listing); }, () => undefined);
  }
}
