import { useState } from "preact/hooks";
import { Banner } from "../../ui/primitives/Banner";
import { Button } from "../../ui/primitives/Button";
import { Dialog } from "../../ui/primitives/Dialog";
import { TitleBar } from "../../ui/primitives/DialogBars";
import { EmptyState } from "../../ui/primitives/EmptyState";
import { Icon, type IconName } from "../../ui/primitives/Icon";
import { IconButton } from "../../ui/primitives/IconButton";
import { RovingList } from "../../ui/primitives/RovingList";
import { Row } from "../../ui/primitives/Row";
import { Spinner } from "../../ui/primitives/Spinner";
import { StatusBand } from "../../ui/primitives/StatusBand";
import { TabStrip, type Pill } from "../../ui/primitives/TabStrip";
import { CodeField } from "../../ui/primitives/CodeField";
import { SearchField, TextField } from "../../ui/primitives/TextField";
import { Toast } from "../../ui/primitives/Toast";
import styles from "./Gallery.module.css";

const ICONS: IconName[] = ["home", "back", "sessions", "folder", "plus", "close", "keyboard", "chevron", "chevronDown", "search", "terminal", "file", "refresh", "settings", "upload", "check", "alert", "image", "film", "external"];

const PILLS: Pill[] = [
  { id: "a", host: "h", kind: "terminal", session: "tether", window: "agent", full: "tether agent", tone: "live", state: "connected", bell: false },
  { id: "b", host: "h", kind: "terminal", session: "notes", window: "shell", full: "notes shell", tone: "reconnecting", state: "reconnecting", bell: true },
  { id: "c", host: "h", kind: "terminal", session: "a-very-long-session-name", window: "a-very-long-window-name", full: "a-very-long-session-name a-very-long-window-name", tone: "error", state: "limited", bell: false },
  { id: "d", host: "h", kind: "terminal", session: "scratch", window: "vim", full: "scratch vim", tone: "gone", state: "closed", bell: false },
  { id: "e", host: "h", kind: "terminal", session: "website", window: "dev", full: "website dev", tone: "idle", state: "not on screen", bell: false },
];

function Section({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section class={styles.section}>
      <h2 class={styles.heading}>{title}</h2>
      <div class={styles.stack}>{children}</div>
    </section>
  );
}

/** Every primitive in every state: the design-system review's page, and the axe target for the primitives. */
export function Gallery() {
  const [dialog, setDialog] = useState<"dialog" | "sheet" | null>(null);
  const [active, setActive] = useState("a");
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("7KQ4");
  const [name, setName] = useState("");
  return (
    <main class={styles.gallery}>
      <h1 class={styles.title}>Primitives</h1>
      <Section title="Buttons">
        <div class={styles.wrap}>
          <Button variant="primary">Create</Button>
          <Button>Cancel</Button>
          <Button variant="quiet">Retry</Button>
          <Button variant="primary" icon="plus">New session</Button>
          <Button disabledReason="Open a terminal tab first">Insert path</Button>
        </div>
        <div class={styles.wrap}>
          <IconButton icon="plus" label="Open another session" />
          <IconButton icon="keyboard" label="Show keyboard" current />
          <IconButton icon="close" label="Close" disabled />
        </div>
      </Section>
      <Section title="Icons">
        <div class={styles.wrap}>
          {ICONS.map((name) => <Icon key={name} name={name} size={24} />)}
          {ICONS.slice(0, 4).map((name) => <Icon key={name} name={name} size={16} />)}
        </div>
      </Section>
      <Section title="Fields">
        <TextField label="Name (optional)" value={name} onInput={setName} hint="Leave blank to let tmux choose." />
        <TextField label="Start directory" value="relative/path" onInput={() => undefined} error="Use an absolute directory path, or leave blank." />
        <CodeField label="Code" value={code} onInput={setCode} />
        <SearchField label="Find a session or window" placeholder="Find a session or window" value={query} onInput={setQuery} />
      </Section>
      <Section title="Rows">
        <RovingList label="Sessions" class={styles.stack}>
          <Row roving icon="sessions" label="tether" meta="2 windows" selected />
          <Row roving icon="sessions" label="notes" meta="1 window" />
          <Row roving icon="folder" label="src" meta="Folder" trailing="chevron" />
          <Row roving icon="file" label="README.md" meta="2 KB" trailing="chevron" />
        </RovingList>
      </Section>
      <Section title="Tab strip">
        <TabStrip pills={PILLS} active={active} onSelect={setActive} onClose={() => undefined} />
      </Section>
      <Section title="Status">
        <Banner title="Can't reach pop-os" tone="warning" action={{ label: "Retry", onAction: () => undefined }}>Check that Tailscale is on, then retry.</Banner>
        <Banner title="Update ready" action={{ label: "Update", onAction: () => undefined }} />
        <Banner title="This device isn't enrolled on pop-os" tone="error">Run tether enroll on the server for a code.</Banner>
        <div class={styles.band}>
          <StatusBand tone="reconnecting" text="Reconnecting to pop-os" hint="Retrying in 4s" action={{ label: "Retry now", onAction: () => undefined }} />
        </div>
        <div class={styles.band}>
          <StatusBand tone="error" text="tether on pop-os allows 3 tmux sessions at a time" hint="Close tabs from other sessions, in this or another tether window or the app, to open this one." action={{ label: "Retry", onAction: () => undefined }} />
        </div>
        <div class={styles.wrap}><Spinner /><span>Updating</span></div>
        <EmptyState icon="terminal" title="Open a window with + or from Home." />
      </Section>
      <Section title="Dialogs">
        <div class={styles.wrap}>
          <Button onClick={() => { setDialog("dialog"); }}>Open dialog</Button>
          <Button onClick={() => { setDialog("sheet"); }}>Open sheet</Button>
        </div>
      </Section>
      <Toast message="2 tabs closed: their windows are gone" onDismiss={() => undefined} />
      <Dialog open={dialog !== null} variant={dialog ?? "dialog"} title="Open session" header={<TitleBar title="Open session" onClose={() => { setDialog(null); }} />} onClose={() => { setDialog(null); }}>
        <SearchField label="Find a session or window" value="" onInput={() => undefined} />
        <EmptyState icon="sessions" title="No matching sessions or windows." />
      </Dialog>
    </main>
  );
}
