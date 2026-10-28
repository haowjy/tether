import { useEffect, useRef } from "preact/hooks";
import type { Entry, Roots } from "../../files/api";
import { entryPlace } from "../../files/browser";
import { formatSize, shorten } from "../../files/format";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { IconButton } from "../../ui/primitives/IconButton";
import type { IconName } from "../../ui/primitives/Icon";
import { Row } from "../../ui/primitives/Row";
import { RovingList } from "../../ui/primitives/RovingList";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./FolderList.module.css";

function iconFor(entry: Entry): IconName {
  if (entry.kind === "dir") return "folder";
  const type = entry.mime ?? "";
  return type.startsWith("image/") ? "image" : type.startsWith("video/") || type.startsWith("audio/") ? "film" : "file";
}

/** What a row says on its right: a size for a file, and why anything unopenable can't be opened. */
function metaFor(entry: Entry): string | undefined {
  if (entry.utf8 === false) return "Name can't be opened";
  if (entry.kind === "broken") return "Broken link";
  if (entry.kind === "other") return "Not a file";
  return entry.kind === "file" && entry.size !== undefined ? formatSize(entry.size) : undefined;
}

export interface RootsListProps {
  roots: Roots;
  hostName: string;
  onOpen: (place: FilesPlace) => void;
  /** Starts the path field at `~/`. With `onRemove`, the list edits the roots; without both it only opens them (the picker's). */
  onAdd?: () => void;
  onRemove?: (path: string, from: HTMLElement) => void;
  /** Only the folders whose shown path contains this, ignoring case. */
  query?: string;
}

export function RootsList({ roots, hostName, onOpen, onAdd, onRemove, query = "" }: RootsListProps) {
  const rows = [
    ...roots.roots.map((r) => ({ key: r.path, entry: r, removable: true, meta: undefined })),
    { key: "uploads", entry: roots.uploadsDir, removable: false, meta: "Uploads" },
  ].map((row) => ({ ...row, label: shorten(row.entry.canonical ?? row.entry.path, roots.home) }));
  const usable = rows.filter((r) => r.entry.ok && r.entry.canonical !== null);
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((r) => r.label.toLowerCase().includes(needle));
  const add = onAdd && (
    <Button icon="plus" focusTarget="addFolder" onClick={onAdd}>Add folder…</Button>
  );
  return (
    <div class={styles.wrap}>
      {usable.length === 0 ? (
        <EmptyState icon="folder" title="No folders to show" {...(add && { action: add })}>Add a folder inside your home folder to browse it here.</EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon="search" title="No matching folders">Nothing on {hostName} matches "{query.trim()}".</EmptyState>
      ) : (
        <>
          <RovingList label="Folders" class={styles.list}>
            {shown.map(({ key, entry, removable, meta, label }) => (
              <div key={key} class={styles.line}>
                <Row
                  roving
                  class={styles.item}
                  icon="folder"
                  label={label}
                  meta={entry.ok ? meta : "Missing"}
                  {...(entry.ok && { trailing: "chevron" as const })}
                  disabled={!entry.ok || entry.canonical === null}
                  onClick={() => { if (entry.canonical) onOpen({ kind: "dir", path: entry.canonical }); }}
                />
                {removable && onRemove && <IconButton icon="close" label={`Remove ${label}`} class={styles.remove} onClick={(e) => { onRemove(entry.path, e.currentTarget); }} />}
              </div>
            ))}
          </RovingList>
          {add && <div class={styles.footer}>{add}</div>}
          {onAdd && <p class={styles.note}>Uploads go to the folder marked Uploads. Change it in ~/.config/tether/config.toml on {hostName}.</p>}
        </>
      )}
    </div>
  );
}

export interface DirListProps {
  path: string;
  entries: Entry[];
  total: number;
  truncated: boolean;
  hidden: boolean;
  loading: boolean;
  onOpen: (place: FilesPlace) => void;
  onMore: () => void;
  onToggleHidden: () => void;
  /** A folder outside the roots lists its subfolders only. */
  foldersOnly: boolean;
  /** The first row: up to the enclosing folder. Absent at a root. */
  parent?: { name: string; onOpen: () => void };
}

export function DirList({ path, entries, total, truncated, hidden, loading, onOpen, onMore, onToggleHidden, foldersOnly, parent }: DirListProps) {
  const more = entries.length < total;
  const sentinel = useRef<HTMLDivElement>(null);
  const latest = useRef(onMore);
  latest.current = onMore;
  // The next page loads as the end of the list nears the screen.
  useEffect(() => {
    const el = sentinel.current;
    if (!more || !el) return undefined;
    const observer = new IntersectionObserver((seen) => { if (seen.some((s) => s.isIntersecting)) latest.current(); }, { rootMargin: "300px 0px" });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [more, entries.length]);

  return (
    <div class={styles.wrap} aria-busy={loading}>
      {entries.length === 0 && (
        <>
          {parent && <Row icon="back" label={parent.name} aria-label={`Up to ${parent.name}`} class={styles.item} onClick={parent.onOpen} />}
          <EmptyState icon="folder" title={foldersOnly ? "No folders here" : "This folder is empty"}>{hidden ? undefined : "Hidden files are not shown."}</EmptyState>
        </>
      )}
      {entries.length > 0 && (
        <RovingList label="Contents" class={styles.list}>
          {parent && <Row roving icon="back" label={parent.name} aria-label={`Up to ${parent.name}`} class={styles.item} onClick={parent.onOpen} />}
          {entries.map((entry) => {
            const place = entryPlace(path, entry);
            return (
              <Row
                key={entry.name}
                roving
                class={styles.item}
                icon={iconFor(entry)}
                label={entry.name}
                meta={metaFor(entry)}
                {...(place && { trailing: "chevron" as const })}
                disabled={place === null}
                onClick={() => { if (place) onOpen(place); }}
              />
            );
          })}
        </RovingList>
      )}
      {more && (
        <div ref={sentinel} class={styles.more}>
          {loading ? <Spinner label="Loading more" /> : <Button variant="quiet" onClick={onMore}>Show more ({String(total - entries.length)} left)</Button>}
        </div>
      )}
      {truncated && <p class={styles.note}>This folder is too big to list in full. Use the terminal for the rest.</p>}
      <div class={styles.footer}>
        <Button variant="quiet" onClick={onToggleHidden}>{hidden ? "Hide hidden files" : "Show hidden files"}</Button>
      </div>
    </div>
  );
}
