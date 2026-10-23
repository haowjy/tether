// Persist now (client-architecture.md §5.5): the one owner of "hand everything pending to
// storage at once". The saved workspace is assembled, not owned: each owner (the workspace
// reducer, FileBrowser, sessions/) supplies its part when this saves and receives its part
// back at boot. Draft writes are debounced by drafts/, which registers a flusher.
import type { PlatformStorage, SavedWorkspace } from "../platform/types";

export class Persist {
  private files: () => SavedWorkspace["files"] = () => null;
  private expanded: () => SavedWorkspace["expanded"] = () => ({});
  private readonly flushers = new Set<() => void>();

  constructor(
    private readonly storage: PlatformStorage,
    private readonly tabs: () => Pick<SavedWorkspace, "tabs" | "active">,
    /** What boot loaded; each owner takes its part from here. */
    readonly saved: SavedWorkspace | null,
  ) {}

  /** FileBrowser says where the Files place is. */
  provideFiles(getter: () => SavedWorkspace["files"]): void {
    this.files = getter;
  }

  /** sessions/ says which sessions are expanded. */
  provideExpanded(getter: () => SavedWorkspace["expanded"]): void {
    this.expanded = getter;
  }

  /** drafts/ registers its pending-write flush; returns the way to stop. */
  onFlush(flush: () => void): () => void {
    this.flushers.add(flush);
    return () => { this.flushers.delete(flush); };
  }

  /** The workspace changed: hand storage the assembled workspace (the adapter coalesces). */
  save(): void {
    this.storage.saveWorkspace({
      version: 1,
      ...this.tabs(),
      files: this.files(),
      expanded: this.expanded(),
    });
  }

  /** Every pending draft write and the assembled workspace, now. Called when the page is hidden, before a restart or an update, and on `storage: closing`. */
  persistNow(): void {
    for (const flush of this.flushers) flush();
    this.save();
  }
}
