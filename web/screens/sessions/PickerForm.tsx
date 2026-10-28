// The picker (browser-behaviors.md "Picker (desktop) and picker sheet (phone)"): a Sessions / Files
// switch, and + for the side showing, then a search that filters it, over that side's list. One
// component for the desktop popover, the phone half sheet and a server's full-height sheet; those
// are `Picker`, `Sessions` and `ServerSheet`, each only a container and what it adds (a Back, a
// tab strip). Any pick closes the picker and then acts, so the tab it opens gets focus. A pick
// leaves no picker entry in history: Back from the tab never reopens the picker.
import type { ComponentProps } from "preact";
import { useEffect, useId, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { Dialog } from "../../ui/primitives/Dialog";
import { PageBar, ToolBar } from "../../ui/primitives/DialogBars";
import { Choice } from "../../ui/primitives/Choice";
import { IconButton } from "../../ui/primitives/IconButton";
import { SearchField } from "../../ui/primitives/TextField";
import { useStore } from "../../ui/store";
import { HostRootLists } from "./HostRootLists";
import { openNewSession, reasonOf, useActiveHost } from "./NewSession";
import { pickerMemoryOf, type Side } from "./pickerMemory";
import { closing, SessionPicks, useQuery } from "./SessionPicks";
import styles from "./PickerForm.module.css";

const SIDES = [{ value: "sessions", label: "Sessions" }, { value: "files", label: "Files" }] as const;
const FIND: Record<Side, string> = { sessions: "Find a session", files: "Find a folder" };

type DialogProps = ComponentProps<typeof Dialog>;

interface PickerFormProps extends Pick<DialogProps, "open" | "onClose" | "title" | "returnFocusTo" | "footer"> {
  variant: NonNullable<DialogProps["variant"]>;
  /** One server's sessions and folders, by handle (a server's sheet); every listable server's otherwise. */
  only?: string | undefined;
  /** A full-height sheet's way out: Back, named for where it goes. */
  back?: string;
  /** Search takes focus on opening, with a fine pointer (the desktop popover). */
  searchFocus?: boolean;
}

export function PickerForm({ open, onClose, title, variant, returnFocusTo, footer, only, back, searchFocus }: PickerFormProps) {
  const app = useApp();
  const memory = pickerMemoryOf(app);
  const side = useStore(memory, (s) => s.side);
  const panel = useId();
  // The Files side asks for folders when first shown, then stays mounted (hidden) until the picker closes.
  const [filesShown, setFilesShown] = useState(false);
  useEffect(() => { setFilesShown(open && (filesShown || side === "files")); }, [open, side]);
  const [query, setQuery] = useQuery(open);
  const commit = closing(app);
  // + acts on the one server the sheet is for, else the active tab's.
  const active = useActiveHost();
  const own = useAppView((v) => v.hosts.find((h) => h.entry.handle === only));
  const host = only === undefined ? active : own;
  const reason = reasonOf(host);
  const hostId = host?.hostId;
  const plus = side === "sessions" ? "New session" : "New Files tab";
  // Row one: the switch, filling the middle, and + for the side showing; Back leads it on a full-height sheet.
  const controls = (
    <>
      <Choice as="tabs" label="Open from" options={SIDES} value={side} onChange={(s) => { memory.setSide(s); }} panel={panel} />
      <IconButton
        icon="plus"
        label={reason ?? plus}
        disabled={reason !== undefined}
        onClick={(e) => {
          const opener = e.currentTarget;
          // The reason covers a missing server or id: nothing runs without one.
          if (host && hostId) commit(() => { if (side === "sessions") openNewSession(app, host, opener); else app.openFiles(hostId); });
        }}
      />
    </>
  );
  return (
    <Dialog
      open={open}
      title={title}
      variant={variant}
      {...(returnFocusTo !== undefined && { returnFocusTo })}
      onClose={onClose}
      header={
        <>
          {back === undefined ? <ToolBar>{controls}</ToolBar> : <PageBar back={back} onBack={onClose}>{controls}</PageBar>}
          <ToolBar>
            <SearchField label={FIND[side]} placeholder={FIND[side]} value={query} onInput={setQuery} class={styles.search} {...(searchFocus && { "data-initial-focus": "" })} />
          </ToolBar>
        </>
      }
      {...(footer !== undefined && { footer })}
    >
      {open && SIDES.map(({ value }) => (
        <div key={value} role="tabpanel" id={`${panel}-panel-${value}`} aria-labelledby={`${panel}-tab-${value}`} hidden={side !== value}>
          {value === "sessions" ? <SessionPicks query={query} commit={commit} only={only} /> : filesShown && <HostRootLists query={query} commit={commit} only={only} />}
        </div>
      ))}
    </Dialog>
  );
}
