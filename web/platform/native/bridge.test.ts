// The bridge's one contract copy is ios/TetherKit/Tests/Fixtures/bridge/, which Swift also
// decodes and re-encodes. Every fixture is decoded here: a native → web message through
// `parseEvent`, a web → native request by making the call that sends it.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Bridge, parseEvent } from "./bridge";

const DIR = new URL("../../../ios/TetherKit/Tests/Fixtures/bridge/", import.meta.url);

interface Fixture {
  direction: "webToNative" | "nativeToWeb";
  message: { type: string } & Record<string, unknown>;
  reply?: unknown;
}

const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, DIR), "utf8")) as Fixture] as const);

/** How the web makes each request, from the fixture's own fields. `ack` (latency measurement) is native's tool and the web never sends it. */
const calls: Record<string, (b: Bridge, m: Fixture["message"]) => unknown> = {
  ready: (b) => b.ready(),
  socket: (b, m) => b.socket(m["host"] as string),
  hostRejected: (b, m) => { b.hostRejected(m["host"] as string, m["token"] as string); },
  recreateWebView: (b) => { b.recreateWebView(); },
  saveWorkspace: (b, m) => { b.saveWorkspace(m["workspace"] as never); },
  focus: (b, m) => { b.setFocus(m["mode"] as never); },
  activeTab: (b, m) => { b.activeTab(m["tab"] as never); },
  lineSet: (b, m) => b.setLine(m["text"] as string, m["caret"] as number, m["tab"] as never),
  lineCaret: (b, m) => { b.lineCaret(m["index"] as number); },
  lineCaretStep: (b, m) => { b.lineCaretStep(m["step"] as -1 | 1); },
  lineInsert: (b, m) => { b.lineInsert(m["text"] as string); },
  lineSubmit: (b) => { b.lineSubmit(); },
  lineSelectAll: (b) => { b.lineSelectAll(); },
  modifiers: (b, m) => { b.modifiers(m["armed"] as "ctrl" | "alt" | null); },
  draftGet: (b, m) => b.draftGet(m["key"] as never),
  draftPut: (b, m) => b.draftPut(m["record"] as never, m["baseRevision"] as number),
  draftDelete: (b, m) => b.draftDelete(m["key"] as never),
  draftList: (b) => b.draftList(),
  copy: (b, m) => b.copy(m["text"] as string),
  readPasteboard: (b, m) => b.readPasteboard(m["tab"] as never, m["id"] as string),
  haptic: (b, m) => { b.haptic(m["kind"] as string); },
  pickMedia: (b, m) => { b.pickMedia(m["id"] as string, m["host"] as string); },
  playVideo: (b, m) => { b.playVideo(m["host"] as string, m["path"] as string); },
  manageHosts: (b) => { b.manageHosts(); },
  openURL: (b, m) => { b.openURL(m["url"] as string); },
};
const NEVER_SENT = ["ack"];

describe.each(fixtures)("fixture %s", (_name, fixture) => {
  if (fixture.direction === "nativeToWeb") {
    it("is accepted as a native event, unchanged", () => {
      expect(parseEvent(fixture.message)).toEqual(fixture.message);
    });
    return;
  }
  it("is exactly what the web sends, and its reply is usable", async () => {
    const call = calls[fixture.message.type];
    if (!call) {
      expect(NEVER_SENT).toContain(fixture.message.type);
      return;
    }
    const sent: unknown[] = [];
    const bridge = new Bridge((msg) => {
      sent.push(msg);
      return Promise.resolve(fixture.reply);
    });
    const result = await call(bridge, fixture.message);
    expect(sent).toEqual([fixture.message]);
    if (fixture.message.type === "ready") expect(result).toEqual(fixture.reply);
    else if (fixture.reply !== null && fixture.reply !== undefined && typeof result !== "undefined") expect(result).toEqual(fixture.reply);
  });
});

describe("native events", () => {
  it("drops an unknown type and a malformed event", () => {
    expect(parseEvent({ type: "network", reachable: true })).toBeNull();
    expect(parseEvent({ type: "input", events: [] })).toBeNull();
    expect(parseEvent("viewport")).toBeNull();
  });
  it("refuses a boot from another bridge version", async () => {
    await expect(new Bridge(() => Promise.resolve({ bridgeVersion: 2 })).ready()).rejects.toThrow(/bridge 2/);
  });
});
