import { useState } from "preact/hooks";
import { useApp } from "../../app/context";
import { describeError } from "../../files/browser";
import { HttpRefusal } from "../../net/http";
import { useStore } from "../../ui/store";
import { IconButton } from "../../ui/primitives/IconButton";
import type { FilesSession } from "./session";

/**
 * The star in a folder's header: adds the folder to the host's favorites or removes it, with no
 * confirmation (nothing on disk changes). Home and Uploads are always listed, so they have none.
 */
export function FavoriteToggle({ session, path }: { session: FilesSession; path: string }) {
  const app = useApp();
  const favorites = useStore(session.browser, (s) => s.favorites);
  const [busy, setBusy] = useState(false);
  if (!favorites || path === favorites.home || path === favorites.uploadsDir.canonical) return null;
  // The daemon removes by the folder it names, so a second entry for it goes too.
  const stored = favorites.favorites.find((f) => f.canonical === path);

  const toggle = async (): Promise<void> => {
    setBusy(true);
    try {
      await (stored ? session.browser.removeFavorite(path) : session.browser.addFavorite(path));
    } catch (error) {
      app.notify(describeError(error instanceof HttpRefusal ? error : new HttpRefusal(0, "internal"), session.hostName));
    }
    setBusy(false);
  };

  return (
    <IconButton
      icon={stored ? "starFilled" : "star"}
      label={stored ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={stored !== undefined}
      disabled={busy}
      onClick={() => { void toggle(); }}
    />
  );
}
