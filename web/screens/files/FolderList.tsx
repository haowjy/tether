import { useEffect, useRef } from "preact/hooks";
import type { Entry, Roots } from "../../files/api";
import { entryPlace } from "../../files/browser";
import { formatSize } from "../../files/format";
import type { FilesPlace } from "../../platform/types";
import { Button } from "../../ui/primitives/Button";
import { EmptyState } from "../../ui/primitives/EmptyState";
import type { IconName } from "../../ui/primitives/Icon";
import { Row } from "../../ui/primitives/Row";
import { RovingList } from "../../ui/primitives/RovingList";
import { Spinner } from "../../ui/primitives/Spinner";
import styles from "./FolderList.module.css";

/** `/home/j/repo` → `~/repo`: how a path reads on the phone. */
export function shorten(path: string, home: string | null): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

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

export function RootsList({ roots, hostName, onOpen }: { roots: Roots; hostName: string; onOpen: (place: FilesPlace) => void }) {
  const rows = [
    ...roots.roots.map((r) => ({ key: r.path, entry: r, meta: undefined })),
    { key: "uploads", entry: roots.uploadsDir, meta: "Uploads" },
  ];
  const usable = rows.filter((r) => r.entry.ok && r.entry.canonical !== null);
  return (
    <div class={styles.wrap}>
      {usable.length === 0 ? (
        <EmptyState icon="folder" title="No folders to show">Add one to roots in ~/.config/tether/config.toml on {hostName}.</EmptyState>
      ) : (
        <RovingList label="Folders" class={styles.list}>
          {rows.map(({ key, entry, meta }) => (
            <Row
              key={key}
              roving
              class={styles.item}
              icon="folder"
              label={shorten(entry.canonical ?? entry.path, roots.home)}
              meta={entry.ok ? meta : "Missing"}
              {...(entry.ok && { trailing: "chevron" as const })}
              disabled={!entry.ok || entry.canonical === null}
              onClick={() => { if (entry.canonical) onOpen({ kind: "dir", path: entry.canonical }); }}
            />
          ))}
        </RovingList>
      )}
      {usable.length > 0 && <p class={styles.note}>Folders are set in ~/.config/tether/config.toml on {hostName}.</p>}
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
}

export function DirList({ path, entries, total, truncated, hidden, loading, onOpen, onMore, onToggleHidden }: DirListProps) {
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
      {entries.length === 0 ? (
        <EmptyState icon="folder" title="This folder is empty">{hidden ? undefined : "Hidden files are not shown."}</EmptyState>
      ) : (
        <RovingList label="Contents" class={styles.list}>
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
