// Test doubles for the host layer: a socket that records what is sent and lets a test
// say what the daemon says.
import type { Frame } from "../proto/frames";
import type { ClientMsg, ServerMsg } from "../proto/generated/messages";
import type { LinkClose, LinkHandlers } from "../proto/link";
import { Host, type Link } from "./host";

export class FakeLink implements Link {
  ready = false;
  sent: ClientMsg[] = [];
  closed = false;
  constructor(readonly handlers: LinkHandlers) {}
  send(msg: ClientMsg): void { this.sent.push(msg); }
  close(): void { this.closed = true; this.ready = false; }
  types(): string[] { return this.sent.map((m) => m.type); }
  welcome(): void {
    this.ready = true;
    this.handlers.welcome({ protocol: 1, daemon: { version: "0" }, host: { id: "h", name: "n" } });
  }
  say(msg: ServerMsg): void { this.handlers.message(msg); }
  frame(frame: Frame): void { this.handlers.frame(frame); }
  output(watch: number, text: string): void { this.frame({ kind: "output", watch, bytes: new TextEncoder().encode(text) }); }
  snapshot(watch: number, text: string): void {
    this.frame({ kind: "snapshot", watch, cols: 80, rows: 24, restore: new TextEncoder().encode(text) });
  }
  drop(code = 1006, cause?: LinkClose["cause"]): void {
    this.ready = false;
    this.handlers.close({ code, retry: code !== 4401 && code !== 4001, ...(cause && { cause }) });
  }
}

export function makeHost() {
  const links: FakeLink[] = [];
  const events: string[] = [];
  const host = new Host({
    open: (h) => { const l = new FakeLink(h); links.push(l); return l; },
    onRejected: () => events.push("rejected"),
    onStuck: () => events.push("stuck"),
    random: () => 0.5, // exact backoff base
  });
  const link = (): FakeLink => links[links.length - 1] as FakeLink;
  return { host, links, link, events };
}
