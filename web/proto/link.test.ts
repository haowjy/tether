import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HostLink, type LinkClose } from "./link";
import type { ServerMsg } from "./generated/messages";

class FakeSocket {
  static readonly OPEN = 1;
  readyState = 0;
  binaryType = "";
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  constructor(readonly url: string, readonly protocols: string[]) {}
  send(s: string): void { this.sent.push(s); }
  close(code: number): void { this.closedWith = code; }
  open(): void { this.readyState = 1; this.onopen?.(); }
  serverSends(data: unknown): void { this.onmessage?.({ data }); }
  serverCloses(code: number): void { this.onclose?.({ code }); }
}

const welcome: ServerMsg = {
  type: "welcome",
  data: { protocol: 1, daemon: { version: "0.1" }, host: { id: "h", name: "devbox" } },
};

function setup() {
  vi.stubGlobal("WebSocket", FakeSocket);
  let sock!: FakeSocket;
  const events = { welcomes: 0, messages: [] as ServerMsg[], frames: [] as unknown[], closes: [] as LinkClose[] };
  const link = new HostLink(
    { url: "wss://h/ws", token: "tok", build: "1", createSocket: (u, p) => (sock = new FakeSocket(u, p)) as unknown as WebSocket },
    {
      welcome: () => { events.welcomes++; },
      message: (m) => events.messages.push(m),
      frame: (f) => events.frames.push(f),
      close: (c) => events.closes.push(c),
    },
  );
  return { link, sock, events };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("HostLink", () => {
  it("offers the token in the subprotocol list and says hello on open", () => {
    const { sock } = setup();
    expect(sock.protocols).toEqual(["tether.v1", "tether.auth.tok"]);
    sock.open();
    expect(JSON.parse(sock.sent[0] ?? "")).toEqual({
      type: "hello",
      data: { protocol: 1, client: { kind: "ios", build: "1" } },
    });
  });

  it("holds everything but hello until welcome", () => {
    const { link, sock, events } = setup();
    sock.open();
    link.send({ type: "ping", data: { t: 1 } });
    expect(sock.sent).toHaveLength(1);
    sock.serverSends(JSON.stringify(welcome));
    expect(events.welcomes).toBe(1);
    link.send({ type: "ping", data: { t: 1 } });
    expect(sock.sent).toHaveLength(2);
  });

  it("decodes frames and ignores nothing else silently", () => {
    const { sock, events } = setup();
    sock.open();
    sock.serverSends(JSON.stringify(welcome));
    const out = new Uint8Array([1, 0, 0, 0, 7, 0x68, 0x69]).buffer;
    sock.serverSends(out);
    expect(events.frames).toEqual([{ kind: "output", watch: 7, bytes: new Uint8Array([0x68, 0x69]) }]);
    sock.serverSends(new Uint8Array([9, 0, 0, 0, 7]).buffer); // unknown kind
    expect(events.closes[0]).toMatchObject({ cause: "protocol", retry: true });
    expect(sock.closedWith).toBe(4003);
  });

  it("does not retry after 4001 or 4401, retries after other codes", () => {
    for (const [code, retry] of [[4001, false], [4401, false], [4000, true], [4004, true], [1006, true]] as const) {
      const { sock, events } = setup();
      sock.serverCloses(code);
      expect(events.closes).toEqual([{ code, retry }]);
    }
  });

  it("gives up on a socket stuck in CONNECTING", () => {
    const { events } = setup();
    vi.advanceTimersByTime(5_000);
    expect(events.closes).toEqual([{ code: 1006, retry: true, cause: "connectTimeout" }]);
  });

  it("pings every 10 s and drops a link silent for 25 s", () => {
    const { sock, events } = setup();
    sock.open();
    sock.serverSends(JSON.stringify(welcome));
    vi.advanceTimersByTime(10_000);
    expect(sock.sent.filter((s) => s.includes('"ping"'))).toHaveLength(1);
    sock.serverSends(JSON.stringify({ type: "pong", data: { t: 1 } }));
    vi.advanceTimersByTime(30_000);
    expect(events.closes).toEqual([{ code: 1006, retry: true, cause: "idle" }]);
  });
});
