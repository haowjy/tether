// The + beside a sessions sheet's tabs or search: a small menu of New session and Browse files
// on `host`. A modal dialog of plain buttons anchored to the +, so Escape, a press outside and
// focus return are `Dialog`'s. It is local state and not a router entry: the form that holds it
// unmounts it when it closes, so Back or Escape on the sheet takes the menu with it.
import { useState } from "preact/hooks";
import { useApp } from "../../app/context";
import type { HostClient } from "../../net/hosts";
import { Dialog } from "../../ui/primitives/Dialog";
import { IconButton } from "../../ui/primitives/IconButton";
import { NewActions } from "./NewActions";
import type { Commit } from "./SessionPicks";

export function NewMenu({ host, commit }: { host: HostClient | undefined; commit: Commit }) {
  const app = useApp();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = (): void => { setAnchor(null); };
  return (
    <>
      <IconButton
        icon="plus"
        label="New session or Browse files"
        aria-haspopup="dialog"
        onClick={(e) => {
          app.focus.noteOpener(e.currentTarget);
          setAnchor(e.currentTarget);
        }}
      />
      <Dialog open={anchor !== null} title="New session or Browse files" variant={{ kind: "menu", to: anchor }} header={null} onClose={close}>
        {anchor && <NewActions host={host} commit={(pick) => { close(); commit(pick); }} />}
      </Dialog>
    </>
  );
}
