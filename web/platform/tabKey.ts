import type { TabKey } from "./types";

/** A tab key as a string: its identity in maps, storage and the workspace. */
export function tabId(key: TabKey): string {
  return `${key.host}/${key.window.server}/${String(key.window.window)}`;
}
