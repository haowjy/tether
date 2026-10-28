import { useEffect, useRef } from "preact/hooks";
import type { Entry } from "../../files/api";
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

/** The first row of a folder list, and of its completions: one step up, named for the folder it goes to. */
export function UpRow({ label, name, roving, onOpen, ...rest }: { label: string; name: string; roving?: boolean; onOpen: () => void; onMouseDown?: (e: MouseEvent) => void }) {
  return <Row {...(roving && { roving })} {...rest} icon="back" label={label} aria-label={`Up to ${name}`} class={styles.item} onClick={onOpen} />;
}

/** A folder that was moved or deleted since the tab last showed it: only the way up remains. */
export function MissingFolder({ parent }: { parent?: { name: string; onOpen: () => void } }) {
  return (
    <div class={styles.wrap}>
      {parent && <div class={styles.list}><UpRow label={parent.name} name={parent.name} onOpen={parent.onOpen} /></div>}
      <EmptyState icon="folder" title="This folder no longer exists" />
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
  /** The first row: up to the enclosing folder. Absent at `/`. */
  parent?: { name: string; onOpen: () => void };
}

export function DirList({ path, entries, total, truncated, hidden, loading, onOpen, onMore, onToggleHidden, parent }: DirListProps) {
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
          {parent && <UpRow label={parent.name} name={parent.name} onOpen={parent.onOpen} />}
          <EmptyState icon="folder" title="This folder is empty">{hidden ? undefined : "Hidden files are not shown."}</EmptyState>
        </>
      )}
      {entries.length > 0 && (
        <RovingList label="Contents" class={styles.list}>
          {parent && <UpRow roving label={parent.name} name={parent.name} onOpen={parent.onOpen} />}
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
