// The one parser for a saved workspace (client-architecture.md §6.1). Storage is a trust
// boundary: an older build wrote what comes back, so the adapters hand it over as `unknown`
// and every version decision lives here. Anything but the current version is discarded
// whole, never converted; drafts are keyed by tab key and are not this parser's to touch.
import { isTabKey, tabId } from "../platform/tabKey";
import type { FilesPlace, SavedTab, SavedWorkspace } from "../platform/types";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isString = (v: unknown): v is string => typeof v === "string";

function isPlace(v: unknown): v is FilesPlace {
  if (!isRecord(v)) return false;
  return v["kind"] === "roots" || ((v["kind"] === "dir" || v["kind"] === "file") && isString(v["path"]));
}

function isTab(v: unknown): v is SavedTab {
  if (!isRecord(v)) return false;
  if (v["kind"] === "terminal") return isTabKey(v["key"]) && isString(v["session"]) && isString(v["window"]);
  return v["kind"] === "files" && isString(v["id"]) && isString(v["host"]) && isPlace(v["place"]);
}

const idOf = (t: SavedTab): string => (t.kind === "terminal" ? tabId(t.key) : t.id);

/** The current version, or null for anything else: an older version, or a record that is not a workspace. A tab id seen twice keeps its first tab. */
export function parseSavedWorkspace(raw: unknown): SavedWorkspace | null {
  if (!isRecord(raw) || raw["version"] !== 3 || !Array.isArray(raw["tabs"]) || !raw["tabs"].every(isTab)) return null;
  const { active, hostName, lastTerminal } = raw;
  if (active !== null && !isString(active)) return null;
  const seen = new Set<string>();
  const tabs = raw["tabs"].filter((t) => !seen.has(idOf(t)) && seen.add(idOf(t)));
  const last = isRecord(lastTerminal) ? Object.fromEntries(Object.entries(lastTerminal).filter((e): e is [string, string] => isString(e[1]))) : {};
  return { version: 3, tabs, active, lastTerminal: last, ...(isString(hostName) && { hostName }) };
}
