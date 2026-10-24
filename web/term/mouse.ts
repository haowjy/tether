// Mouse reports as the application asked for them (xterm's encodings), for the touch
// gestures that become a click or a wheel. xterm.js encodes desktop mouse events itself, but
// with stdin off (tether's own input) it sends none, and a touch has no mouse event to encode.

/** xterm's mouse tracking mode: `none` until the application asks for reports (seeded by the snapshot). */
export type MouseMode = "none" | "x10" | "vt200" | "drag" | "any";

/** The report format the application selected: DECSET 1006 is `sgr`, 1005 `utf8`, otherwise the classic one. */
export type MouseEncoding = "x10" | "utf8" | "sgr";

export type MouseReport = "press" | "release" | "wheelUp" | "wheelDown";

const BUTTON: Record<MouseReport, number> = { press: 0, release: 3, wheelUp: 64, wheelDown: 65 };
const encoder = new TextEncoder();

/**
 * The bytes for `report` at the zero-based `col` and `row`, or null when this encoding cannot
 * say that position (the classic format stops at column 223).
 */
export function mouseReport(report: MouseReport, col: number, row: number, encoding: MouseEncoding): Uint8Array | null {
  const button = BUTTON[report];
  if (encoding === "sgr") {
    // A release keeps the button and ends in `m`.
    const code = report === "release" ? 0 : button;
    return encoder.encode(`\x1b[<${String(code)};${String(col + 1)};${String(row + 1)}${report === "release" ? "m" : "M"}`);
  }
  const limit = encoding === "utf8" ? 2015 - 32 : 255 - 32;
  if (col + 1 > limit || row + 1 > limit) return null;
  const tail = encoder.encode(String.fromCharCode(32 + button, 32 + col + 1, 32 + row + 1));
  if (encoding === "utf8") return Uint8Array.from([0x1b, 0x5b, 0x4d, ...tail]);
  // The classic format is one byte per value, whatever the character set.
  return Uint8Array.from([0x1b, 0x5b, 0x4d, 32 + button, 32 + col + 1, 32 + row + 1]);
}

/**
 * The input for a gesture the application can take as a mouse event, or null when it can't
 * and the caller should do something else: no mouse mode, a position the encoding can't say,
 * or (for a wheel) the classic X10 mode, which reports presses only. A tap is a press and a
 * release, a press alone in X10 mode.
 */
export function mouseInput(gesture: "tap" | "wheelUp" | "wheelDown", col: number, row: number, mode: MouseMode, encoding: MouseEncoding): { bytes: string }[] | null {
  if (mode === "none" || (gesture !== "tap" && mode === "x10")) return null;
  const kinds: MouseReport[] = gesture !== "tap" ? [gesture] : mode === "x10" ? ["press"] : ["press", "release"];
  const events: { bytes: string }[] = [];
  for (const kind of kinds) {
    const report = mouseReport(kind, col, row, encoding);
    if (!report) return null;
    events.push({ bytes: btoa(String.fromCharCode(...report)) });
  }
  return events;
}
