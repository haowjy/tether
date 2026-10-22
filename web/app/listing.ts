import type { Host, TabPort } from "../net/host";
import type { ServerMsg, TmuxListing } from "../proto/generated/messages";

const LISTING_TIMEOUT_MS = 5_000;

/**
 * Asks a host which tmux sessions and windows it has. The host's socket is open only
 * while the answer is awaited, unless a tab keeps it open anyway.
 */
export function listWindows(host: Host): Promise<TmuxListing | null> {
  return new Promise((resolve, reject) => {
    const req = host.nextReq();
    const finish = (done: () => void): void => {
      clearTimeout(timer);
      host.leave(port);
      done();
    };
    const ask = (): void => { host.send(port, { type: "listSessions", data: { req } }); };
    const port: TabPort = {
      linkUp: ask,
      linkLost: ({ halt }) => { if (halt) finish(() => { reject(new Error(`host halted: ${halt}`)); }); },
      paused: () => { finish(() => { reject(new Error("app in background")); }); },
      frame: () => undefined,
      message: (msg: ServerMsg) => {
        if (msg.type === "sessions" && msg.data.req === req) finish(() => { resolve(msg.data.tmux); });
      },
    };
    const timer = setTimeout(() => { finish(() => { reject(new Error("timed out")); }); }, LISTING_TIMEOUT_MS);
    host.join(port);
    if (host.ready) ask();
  });
}
