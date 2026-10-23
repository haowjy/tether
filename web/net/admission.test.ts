import { describe, expect, it } from "vitest";
import { enrolResult, fromClose, fromInfo, fromSession, isRetryable, TOKEN_REFUSED, type AuthInfo } from "./admission";

const info = (over: Partial<AuthInfo> = {}): AuthInfo => ({
  hostId: "h1",
  name: "pop-os",
  protocol: { min: 1, max: 1 },
  browserOrigin: "https://pop-os.tail.ts.net",
  browserRefused: null,
  ...over,
});
const here = "https://pop-os.tail.ts.net";

describe("fromInfo", () => {
  it("asks the session route when the origin matches", () => {
    expect(fromInfo(info(), here)).toEqual({ askSession: true });
  });
  it("shows the canonical origin when the page is elsewhere, and opens no socket", () => {
    expect(fromInfo(info(), "http://localhost:5173")).toEqual({ admission: { kind: "wrongOrigin", origin: here } });
  });
  it("reports why browsers can't use the host", () => {
    expect(fromInfo(info({ browserOrigin: null, browserRefused: "ambiguous_origin" }), here)).toEqual({
      admission: { kind: "originRefused", reason: "ambiguous_origin" },
    });
  });
  it("refuses a protocol outside the daemon's range", () => {
    expect(fromInfo(info({ protocol: { min: 2, max: 3 } }), here)).toEqual({ admission: { kind: "incompatible" } });
  });
});

describe("fromSession", () => {
  it("maps every answer of the session route", () => {
    expect(fromSession({ status: 200 })).toEqual({ kind: "admitted" });
    expect(fromSession({ status: 401, error: "not_enrolled", nodeName: "laptop" })).toEqual({ kind: "notEnrolled", nodeName: "laptop" });
    expect(fromSession({ status: 403, error: "node_refused", reason: "routes" })).toEqual({ kind: "nodeRefused", reason: "routes" });
    expect(fromSession({ status: 403, error: "bad_origin" })).toEqual({ kind: "deciding" });
    expect(fromSession({ status: 503 })).toEqual({ kind: "deciding" });
    expect(fromSession({ status: 0 })).toEqual({ kind: "unreachable" });
  });
  it("retries only what can change", () => {
    expect(isRetryable(fromSession({ status: 503 }))).toBe(true);
    expect(isRetryable(fromSession({ status: 0 }))).toBe(true);
    expect(isRetryable(fromSession({ status: 403, error: "node_refused" }))).toBe(false);
    expect(isRetryable(fromInfo(info({ protocol: { min: 2, max: 2 } }), here) as never)).toBe(false);
  });
});

describe("fromClose", () => {
  it("never takes 4401 as notEnrolled by itself", () => {
    expect(fromClose(4401)).toBe("recheck");
    expect(fromClose(4503)).toEqual({ kind: "deciding" });
    expect(fromClose(4001)).toEqual({ kind: "incompatible" });
    expect(fromClose(1006)).toBeNull();
  });
  it("reads a native token refusal as a pairing that is gone", () => {
    expect(TOKEN_REFUSED).toEqual({ kind: "notEnrolled", nodeName: null });
  });
});

describe("enrolResult", () => {
  it("maps the enrol answers", () => {
    expect(enrolResult({ status: 200 })).toEqual({ kind: "enrolled" });
    expect(enrolResult({ status: 403, error: "bad_code" })).toEqual({ kind: "badCode" });
    expect(enrolResult({ status: 403, error: "node_refused", reason: "shared" })).toEqual({ kind: "nodeRefused", reason: "shared" });
    expect(enrolResult({ status: 503 })).toEqual({ kind: "tryAgain" });
    expect(enrolResult({ status: 0 })).toEqual({ kind: "tryAgain" });
  });
});
