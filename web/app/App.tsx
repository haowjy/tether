import { AppProvider, useApp, useAppView } from "./context";
import type { AppController } from "./controller";
import { Toast } from "../ui/primitives/Toast";
import { Shell } from "../screens/shell/Shell";

function Notices() {
  const app = useApp();
  const notice = useAppView((v) => v.notice);
  return <Toast message={notice} onDismiss={() => { app.dismissNotice(); }} />;
}

export function App({ app }: { app: AppController }) {
  return (
    <AppProvider app={app}>
      <Shell />
      <Notices />
    </AppProvider>
  );
}
