import { describeError } from "../../files/browser";
import { shorten } from "../../files/format";
import type { Completion, CompletionRow } from "../../files/pathfield";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./FolderList.module.css";
import find from "./PathField.module.css";

export const rowId = (listId: string, name: string): string => `${listId}-${name}`;

interface Props {
  listId: string;
  completion: Completion;
  home: string;
  hostName: string;
  /** The highlighted row's name. */
  highlighted: string | null;
  /** A tap on a row opens that folder. */
  onOpen: (row: CompletionRow) => void;
  onRetry: () => void;
}

/**
 * What the list shows while the path field is being edited: the typed parent's subfolders that
 * match, each a tap to open. Rows take the tap without taking focus from the field, which
 * keeps the keyboard up until the folder opens.
 */
export function CompletionList({ listId, completion: c, home, hostName, highlighted, onOpen, onRetry }: Props) {
  const { typed, folder } = c;
  if (c.note === "start") return <p class={find.note}>Type a path that starts with ~ or /.</p>;
  if (c.note === "outside" || !typed) return <EmptyState icon="folder" title="Outside your folders" />;
  const parent = shorten(typed.parent, home);
  if (folder?.status === "error") {
    return <EmptyState icon="alert" title={describeError(folder.error, hostName)} action={<Button onClick={onRetry}>Try again</Button>} />;
  }
  const loading = !folder || folder.status === "loading";
  return (
    <div class={styles.wrap} aria-busy={loading}>
      <p class={find.where}>
        <span class={find.parent} title={typed.parent}>in {parent}</span>
        {loading && <><Spinner label="Loading the folder" /><span>Loading</span></>}
      </p>
      {c.rows.length > 0 && (
        <div id={listId} role="listbox" aria-label="Folders" class={styles.list}>
          {c.rows.map((row) => (
            <Row
              key={row.name}
              id={rowId(listId, row.name)}
              role="option"
              aria-selected={row.name === highlighted}
              tabIndex={-1}
              class={styles.item}
              icon="folder"
              label={row.name}
              meta={row.added ? undefined : "not added"}
              trailing="chevron"
              selected={row.name === highlighted}
              // The row takes the tap without taking focus from the field, so the keyboard doesn't drop before the open.
              onMouseDown={(e) => { e.preventDefault(); }}
              onClick={() => { onOpen(row); }}
            />
          ))}
        </div>
      )}
      {!loading && c.rows.length === 0 && (
        <p class={find.note}>{typed.segment === "" ? `No folders in ${parent}` : `No folder in ${parent} starts with ${typed.segment}`}</p>
      )}
      {c.capped && <p class={styles.note}>Only the first 1,000 folders are searched, keep typing to narrow.</p>}
    </div>
  );
}
