// The one parser for a saved workspace (client-architecture.md §6.1). Storage is a trust
// boundary: an older build wrote what comes back, so the adapters hand it over as `unknown`
// and every version decision lives here.
import type { SavedWorkspace } from "../platform/types";

const versionOf = (raw: unknown): unknown => (raw as { version?: unknown } | null)?.version;

/** The current version, or null for anything else. */
export const parseSavedWorkspace = (raw: unknown): SavedWorkspace | null => (versionOf(raw) === 2 ? (raw as SavedWorkspace) : null);

/** Version 1 tabs followed windows: none of its tabs or drafts names a session, so the controller clears all local data. */
export const isWindowTabWorkspace = (raw: unknown): boolean => versionOf(raw) === 1;
