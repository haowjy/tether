// Paste and copy interception on the terminal surface (client-architecture.md §7.5, §7.2).
// A capture-phase listener runs before xterm's own, from either browser source (xterm's
// textarea or tether's owned input), so the browser and tmux can never both bracket a paste.
// `Pastes` is what a paste, a copy and an inserted path do after that.
import type { AppController } from "../../app/controller";
import type { PasteResult } from "../../net/host";
import type { InsertResult, TabDriver } from "../../tabs/driver";
import { cannotInsert, shellQuote } from "../../tabs/input";
import { tabLabels } from "../../workspace/labels";

/** Over this many UTF-8 bytes a paste is refused, never split: splitting breaks bracketing. */
export const MAX_PASTE_BYTES = 256 * 1024;

const encoder = new TextEncoder();

/** The refusal's words, or null when `text` fits. */
export function pasteRefusal(text: string): string | null {
  const bytes = encoder.encode(text).length;
  return bytes > MAX_PASTE_BYTES ? `Too large to paste (${String(Math.ceil(bytes / 1024))} KiB; the limit is ${String(MAX_PASTE_BYTES / 1024)} KiB)` : null;
}

/** What a paste carries: the first image if it holds one, else its plain text. */
export type Pasted = { kind: "image"; file: File } | { kind: "text"; text: string } | { kind: "empty" };

export function readPaste(data: DataTransfer | null): Pasted {
  const image = [...(data?.files ?? [])].find((f) => f.type.startsWith("image/"));
  if (image) return { kind: "image", file: image };
  const text = data?.getData("text/plain") ?? "";
  return text ? { kind: "text", text } : { kind: "empty" };
}

export interface ClipboardTarget {
  /** A paste arrived: the caller captures the tab, since the surface is shared by every tab. */
  onPaste(pasted: Pasted): void;
  /** The selection's logical text, "" with none. */
  selectionText(): string;
}

/**
 * Takes over `paste` and `copy` on `surface`. A paste is never left to xterm
 * (`stopPropagation` and `preventDefault`: xterm listens on both its textarea and its
 * element), and a copy carries the selection's logical text instead of xterm's.
 */
export function interceptClipboard(surface: HTMLElement, target: ClipboardTarget): void {
  surface.addEventListener(
    "paste",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      target.onPaste(readPaste(event.clipboardData));
    },
    { capture: true },
  );
  surface.addEventListener(
    "copy",
    (event) => {
      const text = target.selectionText();
      if (!text || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
}

interface PastesDeps {
  app: AppController;
  driver(id: string): TabDriver | undefined;
  /** The tab on screen, null when none is or a native screen covers Terminal. */
  shown(): string | null;
  /** Sends what was typed so far: it goes before a paste. */
  flushInput(): void;
  /** Closes the selection and returns its logical text. */
  takeSelection(): string;
  dismissSelection(): void;
}

/** Paste, copy and inserted paths for the tab on screen, and what is said when they fail. */
export class Pastes {
  /** Takes a paste's answer if it is for a line the dock sent; what it declines becomes a notice. */
  private claimant: (id: string, result: PasteResult) => boolean = () => false;

  constructor(private readonly deps: PastesDeps) {}

  /** The one claimant of paste answers (the dock's line drafts). */
  claim(claimant: (id: string, result: PasteResult) => boolean): void {
    this.claimant = claimant;
  }

  /** A paste into the tab on screen: text goes as one paste without Enter, an image is uploaded and its path typed. */
  paste(pasted: Pasted): void {
    // The tab is captured now: the upload below finishes later.
    const id = this.deps.shown();
    const driver = id === null ? undefined : this.deps.driver(id);
    if (pasted.kind === "empty" || id === null || !driver) return;
    this.deps.flushInput(); // what was typed before the paste goes first
    if (pasted.kind === "text") {
      const refusal = pasteRefusal(pasted.text);
      if (refusal) this.deps.app.notify(refusal);
      else if (driver.paste(pasted.text) === null) this.deps.app.notify("Not sent: the tab isn't connected");
      return;
    }
    void this.pasteImage(id, pasted.file);
  }

  /** The edit menu's Copy, inside its tap: the selection's logical text goes to the clipboard. */
  copySelection(): void {
    const text = this.deps.takeSelection();
    if (!text) return;
    const { app } = this.deps;
    void app.platform.clipboard.writeText(text).then((result) => {
      app.notify(result === "ok" ? "Copied" : "Couldn't copy: the browser refused clipboard access");
    });
  }

  /** The edit menu's Paste, inside its tap: the clipboard goes to the terminal as one paste, without Enter. */
  pasteFromMenu(): void {
    const { app } = this.deps;
    const id = this.deps.shown();
    const tab = app.snapshot.workspace.tabs.find((t) => t.id === id);
    this.deps.dismissSelection();
    if (!tab) return;
    void app.platform.clipboard.read(tab.key).then((result) => {
      if (result === "denied") app.notify("Couldn't paste: the browser refused clipboard access");
      else if (result === "empty") app.notify("Nothing to paste");
      else if ("text" in result) this.paste({ kind: "text", text: result.text });
      else if ("image" in result) this.paste({ kind: "image", file: result.image });
    });
  }

  /** Types `path` into tab `id`, quoted. A refusal is reported here: the caller needn't. */
  insertPath(id: string, path: string): InsertResult {
    const driver = this.deps.driver(id);
    const result = driver?.insertPath(path) ?? "refused";
    if (result === "refused") this.deps.app.notify(cannotInsert(path, driver ? "the tab isn't connected" : "that tab is closed") + " The file is still in Files.");
    return result;
  }

  /** A paste's answer from the daemon: the dock's claimant first, else a failure becomes a notice. */
  result(id: string, result: PasteResult): void {
    if (this.claimant(id, result) || result.type === "pasted") return;
    const { app } = this.deps;
    const tab = tabLabels(app.snapshot.workspace.tabs, (hostId) => app.hosts.byHostId(hostId)?.name ?? hostId)
      .find((label) => label.id === id)?.full ?? "the closed tab";
    if (result.type === "pasteLost") {
      app.notify(`May not have been sent to ${tab}: the connection was lost before tmux confirmed the paste`);
      return;
    }
    const label = result.data.code === "tmux" ? "May not have been sent" : "Not sent";
    app.notify(`${label} to ${tab}: ${result.data.message}`);
  }

  /** Uploads the pasted image, then types its quoted path into the tab it was pasted in. */
  private async pasteImage(id: string, file: File): Promise<void> {
    const { app } = this.deps;
    const { platform } = app;
    const tab = app.snapshot.workspace.tabs.find((t) => t.id === id);
    const client = tab && app.hosts.byHostId(tab.key.host);
    if (!platform.uploads.send || !client) {
      app.notify("Paste images from Files → Upload");
      return;
    }
    app.notify("Uploading image…");
    for await (const event of platform.uploads.send(client.entry.handle, file, new AbortController().signal)) {
      if ("error" in event) {
        app.notify(`Upload failed: ${event.error}`);
      } else if ("path" in event) {
        const name = event.path.split("/").pop() ?? event.path;
        // The tab may be covered or still connecting: the path then waits for its watch. A refusal says so itself.
        const result = this.insertPath(id, event.path);
        if (result === "typed") app.notify(`Inserted ${shellQuote(name)}`);
        else if (result === "queued") app.notify(`Uploaded ${name}: its path will be inserted when that tab is on screen and connected`);
      }
    }
  }
}
