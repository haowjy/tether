import { useApp } from "../../app/context";
import type { Destination } from "../../app/router";
import { IconButton } from "../../ui/primitives/IconButton";
import styles from "./Rail.module.css";

/** The persistent 56 px icon rail on desktop: Home, Terminal, Files. No expandable sidebar. */
export function Rail({ destination }: { destination: Destination }) {
  const app = useApp();
  return (
    <nav class={styles.rail} aria-label="Workspace">
      <IconButton icon="home" label="Home" placement="right" current={destination === "home"} onClick={() => { app.router.go("home"); }} />
      <IconButton
        icon="terminal"
        label="Terminal"
        placement="right"
        current={destination === "terminal"}
        onClick={() => {
          app.router.go("terminal");
          // With no tab, the Terminal destination opens the picker (browser-behaviors.md "Terminal").
          if (app.snapshot.workspace.tabs.length === 0) app.router.openOverlay({ screen: "picker", name: "open" });
        }}
      />
      <IconButton icon="folder" label="Files" placement="right" current={destination === "files"} onClick={() => { app.router.go("files"); }} />
    </nav>
  );
}
