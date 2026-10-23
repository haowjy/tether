// The uploads Files started, as the screen shows them: progress while they run, then the
// saved path and the tab to offer it to. The adapter owns the queue and the request
// (client-architecture.md §5.7); this only folds its events into a list.
import type { UploadEvent } from "../platform/types";
import { Store } from "../ui/store";

export type UploadItem = { id: string; target: string | null } & (
  | { state: "uploading"; progress: number }
  | { state: "done"; path: string }
  | { state: "failed"; message: string }
);

export class UploadTracker extends Store<{ items: UploadItem[] }> {
  constructor(private readonly landed: (path: string) => void) {
    super({ items: [] });
  }

  /**
   * Follows one pick until its stream ends. `target` is the tab that was active when the
   * action started: the path is offered to it, never to whichever tab is active later.
   */
  async track(events: AsyncIterable<UploadEvent>, target: string | null): Promise<void> {
    const mine = new Set<string>();
    try {
      for await (const event of events) {
        mine.add(event.id);
        this.apply(event, target);
      }
    } catch {
      // A stream that breaks fails what it had not finished.
    }
    this.items(this.snapshot.items.map((i) => (mine.has(i.id) && i.state === "uploading" ? { id: i.id, target: i.target, state: "failed" as const, message: "The upload was interrupted" } : i)));
  }

  dismiss(id: string): void {
    this.items(this.snapshot.items.filter((i) => i.id !== id));
  }

  private items(items: UploadItem[]): void {
    this.update({ items });
  }

  private apply(event: UploadEvent, target: string | null): void {
    const item: UploadItem =
      "progress" in event ? { id: event.id, target, state: "uploading", progress: event.progress }
      : "path" in event ? { id: event.id, target, state: "done", path: event.path }
      : { id: event.id, target, state: "failed", message: event.error };
    const items = [...this.snapshot.items];
    const at = items.findIndex((i) => i.id === event.id);
    if (at < 0) items.push(item);
    else items[at] = item;
    this.items(items);
    if (item.state === "done") this.landed(item.path);
  }
}
