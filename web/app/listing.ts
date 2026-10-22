import type { Host, TabPort } from "../net/host";
import type { ClientMsg, ErrorCode, ServerMsg, SessionRef, TmuxListing, WindowRef } from "../proto/generated/messages";
import type { Halt } from "../tabs/connection";

const ASK_TIMEOUT_MS = 5_000;

/** Why a request got no answer: the daemon's refusal, a halted host, or no reply in time. */
export class AskError extends Error {
  constructor(message: string, readonly reason: ErrorCode | Halt | "timeout" | "background") {
    super(message);
  }
}

/**
 * Sends one request on a host's socket and waits for its answer. The socket is open only
 * while the answer is awaited, unless a tab keeps it open anyway.
 */
function ask<T>(host: Host, build: (req: number) => ClientMsg, answer: (msg: ServerMsg, req: number) => { value: T } | undefined): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = host.nextReq();
    const finish = (done: () => void): void => {
      clearTimeout(timer);
      host.leave(port);
      done();
    };
    const send = (): void => { host.send(port, build(req)); };
    const port: TabPort = {
      linkUp: send,
      linkLost: ({ halt }) => { if (halt) finish(() => { reject(new AskError(`host halted: ${halt}`, halt)); }); },
      paused: () => { finish(() => { reject(new AskError("app in background", "background")); }); },
      frame: () => undefined,
      message: (msg: ServerMsg) => {
        if (msg.type === "error" && msg.data.req === req) {
          const { code, message } = msg.data;
          finish(() => { reject(new AskError(message, code)); });
          return;
        }
        const got = answer(msg, req);
        if (got) finish(() => { resolve(got.value); });
      },
    };
    const timer = setTimeout(() => { finish(() => { reject(new AskError("timed out", "timeout")); }); }, ASK_TIMEOUT_MS);
    host.join(port);
    if (host.ready) send();
  });
}

/** Which tmux sessions and windows the host has; null when no tmux server runs. */
export function listWindows(host: Host): Promise<TmuxListing | null> {
  return ask(host, (req) => ({ type: "listSessions", data: { req } }), (msg, req) =>
    msg.type === "sessions" && msg.data.req === req ? { value: msg.data.tmux } : undefined);
}

export type CreateTarget = { kind: "window"; session: SessionRef } | { kind: "session" };

/** A new tmux window in a session, or a new session; resolves with the window made. */
export function create(host: Host, target: CreateTarget, name: string | null, dir: string | null): Promise<WindowRef> {
  const opts = { ...(name !== null && { name }), ...(dir !== null && { dir }) };
  return ask(
    host,
    (req) => target.kind === "window"
      ? { type: "newWindow", data: { req, session: target.session, ...opts } }
      : { type: "newSession", data: { req, ...opts } },
    (msg, req) => msg.type === "created" && msg.data.req === req ? { value: msg.data.window } : undefined,
  );
}
