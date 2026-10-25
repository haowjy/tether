import type { TabKey } from "./types";

/** A tab key as a string: its identity in maps, storage and the workspace. The `$` is tmux's session sigil; it keeps a session tab's id apart from a v1 window tab's, which had none. */
export function tabId(key: TabKey): string {
  return `${key.host}/${key.session.server}/$${String(key.session.session)}`;
}
