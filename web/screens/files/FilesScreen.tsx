// Files: the rail destination on desktop, Home's Files pane on phone (Home renders this).
import { useAppView, useApp } from "../../app/context";
import { Spinner } from "../../ui/primitives/Spinner";
import { FilesPane } from "./FilesPane";
import { filesSession } from "./session";

export function FilesScreen() {
  const app = useApp();
  const host = useAppView((v) => v.hosts.find((h) => h.admission.kind === "admitted") ?? v.hosts[0]);
  if (!host) return <Spinner label="Checking access" />;
  return <FilesPane session={filesSession(app, host)} />;
}
