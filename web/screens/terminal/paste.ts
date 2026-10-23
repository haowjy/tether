// Paste and copy interception on the terminal surface (client-architecture.md §7.5, §7.2).
// A capture-phase listener runs before xterm's own, from either browser source (xterm's
// textarea or tether's owned input), so the browser and tmux can never both bracket a paste.

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
