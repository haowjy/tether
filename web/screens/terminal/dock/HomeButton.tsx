import { useApp } from "../../../app/context";
import { DockButton } from "../../../ui/primitives/DockButton";
import { Icon } from "../../../ui/primitives/Icon";

/** The phone's resting bar's Home, before the current-tab button on a terminal tab and on a Files tab alike. The tabs stay open. */
export function HomeButton() {
  const app = useApp();
  return (
    <DockButton kind="control" aria-label="Home" onClick={() => { app.router.goHome(); }}>
      <Icon name="home" size={20} />
    </DockButton>
  );
}
