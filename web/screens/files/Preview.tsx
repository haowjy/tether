import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useApp, useAppView } from "../../app/context";
import { formatSize, formatTime } from "../../files/format";
import { describeError, type FileRef } from "../../files/browser";
import { viewerFor } from "../../files/kinds";
import type { LinkTarget } from "../../files/render/markdown";
import type { HttpRefusal } from "../../net/http";
import { Button } from "../../ui/primitives/Button";
import { insertTargetOf } from "../../workspace/state";
import { insertPath, useInsertTarget } from "./insert";
import { ImageViewer } from "./ImageViewer";
import type { FilesSession } from "./session";
import { CodeViewer, MarkdownViewer } from "./TextViewers";
import styles from "./Viewers.module.css";

function Meta({ file }: { file: FileRef }) {
  return (
    <dl class={styles.meta}>
      <dt>Path</dt><dd class={styles.mono}>{file.path}</dd>
      {file.size !== null && <><dt>Size</dt><dd>{formatSize(file.size)}</dd></>}
      {file.mtime !== null && <><dt>Modified</dt><dd>{formatTime(file.mtime)}</dd></>}
      {file.mime && <><dt>Type</dt><dd class={styles.mono}>{file.mime}</dd></>}
    </dl>
  );
}

/** Video and audio: native's player opens on arrival; the browser plays them inline over Range requests. */
function MediaViewer({ session, file }: { session: FilesSession; file: FileRef }) {
  const app = useApp();
  const [mode, setMode] = useState<"checking" | "handled" | "inline">("checking");
  useEffect(() => {
    setMode(app.platform.playVideo(session.handle, file.path) === "handled" ? "handled" : "inline");
  }, [app, session.handle, file.path]);
  const url = session.browser.api.rawUrl(file.path);
  if (mode === "checking") return null;
  if (mode === "inline") {
    return (
      <div class={styles.media}>
        {(file.mime ?? "").startsWith("audio/")
          ? <audio controls preload="metadata" src={url} aria-label={file.name} />
          : <video controls playsInline preload="metadata" src={url} aria-label={file.name} />}
      </div>
    );
  }
  return (
    <div class={styles.panel}>
      <Meta file={file} />
      <Button variant="primary" onClick={() => { app.platform.playVideo(session.handle, file.path); }}>Play {file.name}</Button>
    </div>
  );
}

/** Insert path, with the file's details: the tab it goes to is the last terminal tab of this host, read from the workspace and captured on the click. */
function InsertBar({ file, children }: { file: FileRef; children?: ComponentChildren }) {
  const app = useApp();
  const last = useAppView((v) => insertTargetOf(v.workspace));
  const target = useInsertTarget(last);
  return (
    <div class={styles.bar}>
      <Button
        variant="primary"
        icon="terminal"
        disabledReason={target ? (target.blocked ?? undefined) : "Open a terminal tab first"}
        onClick={() => { if (target) insertPath(app, target.id, file.path); }}
      >
        {target ? `Insert path into ${target.label}` : "Insert path"}
      </Button>
      <p class={styles.facts}>
        {file.size !== null && <span>{formatSize(file.size)}</span>}
        {file.mtime !== null && <span>{formatTime(file.mtime)}</span>}
      </p>
      {children}
    </div>
  );
}

export function Preview({ session, file, onLink }: { session: FilesSession; file: FileRef; onLink: (target: LinkTarget) => void }) {
  const phone = useAppView((v) => v.viewport.layout === "phone");
  const [asText, setAsText] = useState(false);
  const [wrap, setWrap] = useState(phone);
  const describe = (error: HttpRefusal): string => describeError(error, session.hostName);
  const kind = asText ? "code" : viewerFor(file.mime);
  const api = session.browser.api;

  return (
    <div class={styles.preview}>
      <InsertBar file={file}>
        {kind === "code" && <Button variant="quiet" class={styles.toggle} aria-pressed={wrap} onClick={() => { setWrap(!wrap); }}>Wrap lines</Button>}
      </InsertBar>
      <div class={styles.viewer}>
        {kind === "code" && <CodeViewer key={file.path} api={api} file={file} wrap={wrap} plain={asText} describe={describe} />}
        {kind === "markdown" && <MarkdownViewer key={file.path} api={api} file={file} onLink={onLink} describe={describe} />}
        {kind === "image" && <ImageViewer key={file.path} url={api.rawUrl(file.path)} name={file.name} />}
        {kind === "media" && <MediaViewer key={file.path} session={session} file={file} />}
        {kind === "binary" && (
          <div class={styles.panel}>
            <Meta file={file} />
            <Button onClick={() => { setAsText(true); }}>Open as text</Button>
          </div>
        )}
      </div>
    </div>
  );
}
