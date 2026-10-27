import type { TabKey } from "./types";

/** A tab key as a string: its identity in maps, storage and the workspace. The `$` is tmux's session sigil; it keeps a session tab's id apart from a v1 window tab's, which had none. */
export function tabId(key: TabKey): string {
  return `${key.host}/${key.session.server}/$${String(key.session.session)}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Whether storage returned a session {@link TabKey}: an older build's window key `{ host, window }` is not one. */
export function isTabKey(v: unknown): v is TabKey {
  if (!isRecord(v) || typeof v["host"] !== "string" || !isRecord(v["session"])) return false;
  return typeof v["session"]["server"] === "string" && Number.isSafeInteger(v["session"]["session"]);
}
