// The one parser for a saved workspace (client-architecture.md §6.1). Storage is a trust
// boundary: an older build wrote what comes back, so the adapters hand it over as `unknown`
// and every version decision lives here. Anything but the current version is discarded
// whole, never converted; drafts are keyed by tab key and are not this parser's to touch.
import { isTabKey, tabId } from "../platform/tabKey";
import type { FilesPlace, SavedTab, SavedWorkspace } from "../platform/types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

export function isPlace(v: unknown): v is FilesPlace {
  return isRecord(v) && (v["kind"] === "dir" || v["kind"] === "file") && isString(v["path"]);
}

/** A saved place. Builds before "Files without a scope" saved the favorites page as `{kind:"roots"}`: it reads as `~`. */
function parsePlace(v: unknown): FilesPlace | null {
  if (isRecord(v) && v["kind"] === "roots") return { kind: "dir", path: "~" };
  return isPlace(v) ? v : null;
}

function parseTab(v: unknown): SavedTab | null {
  if (!isRecord(v)) return null;
  if (v["kind"] === "terminal") return isTabKey(v["key"]) && isString(v["session"]) && isString(v["window"]) ? (v as unknown as SavedTab) : null;
  if (v["kind"] !== "files" || !isString(v["id"]) || !isString(v["host"])) return null;
  const place = parsePlace(v["place"]);
  return place && { kind: "files", id: v["id"], host: v["host"], place };
}

const idOf = (t: SavedTab): string => (t.kind === "terminal" ? tabId(t.key) : t.id);

/** The current version, or null for anything else: an older version, or a record that is not a workspace. A tab id seen twice keeps its first tab. */
export function parseSavedWorkspace(raw: unknown): SavedWorkspace | null {
  if (!isRecord(raw) || raw["version"] !== 3 || !Array.isArray(raw["tabs"])) return null;
  const parsed = (raw["tabs"] as unknown[]).map(parseTab);
  if (parsed.some((t) => t === null)) return null;
  const { active, hostName, lastTerminal } = raw;
  if (active !== null && !isString(active)) return null;
  const seen = new Set<string>();
  const tabs = (parsed as SavedTab[]).filter((t) => !seen.has(idOf(t)) && seen.add(idOf(t)));
  const last = isRecord(lastTerminal) ? Object.fromEntries(Object.entries(lastTerminal).filter((e): e is [string, string] => isString(e[1]))) : {};
  const bellSeen = isRecord(raw["bellSeen"]) ? Object.fromEntries(Object.entries(raw["bellSeen"]).filter((e): e is [string, number] => Number.isInteger(e[1]))) : {};
  return { version: 3, tabs, active, lastTerminal: last, ...(isString(hostName) && { hostName }), bellSeen };
}
