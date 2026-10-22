import type { Host, TabPort } from "../net/host";
import type { ServerMsg, TmuxListing, WindowRef } from "../proto/generated/messages";

const RELIST_DELAY_MS = 300;

/** Whether `window` is in `listing`; a restarted tmux has a new server id, so none match. */
export function listed(listing: TmuxListing | null, window: WindowRef): boolean {
  return listing?.server === window.server && listing.sessions.some((s) => s.windows.some((w) => w.id === window.window));
}

export interface HostSyncOptions {
  host: Host;
  /** A listing arrived, asked for by anyone on this host. */
  onListing(listing: TmuxListing | null): void;
  onRenamed(window: WindowRef, name: string): void;
}

/**
 * Keeps a host's open tabs true to tmux. The daemon reports a kill only for windows with
 * a watch, and only the active tab has one, so this lists the host on every connect and,
 * debounced, on every `sessionsChanged`. Listings other callers asked for arrive here too.
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
      if (msg.type === "sessions") this.opts.onListing(msg.data.tmux);
      else if (msg.type === "windowRenamed") this.opts.onRenamed(msg.data.window, msg.data.name);
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

  private list(): void {
    this.opts.host.send(this.port, { type: "listSessions", data: { req: this.opts.host.nextReq() } });
  }
}
