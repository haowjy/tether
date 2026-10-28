// The desktop's picker: the router overlay `{ screen: "sessions", name: "picker" }`, opened by the
// top row's +, as a popover under that row anchored to + (the focus registry's `plus`). Escape or
// a press outside dismisses it and leaves the active tab as it is.
import { useAppView, useOverlay } from "../../app/context";
import { PickerForm } from "./PickerForm";

export function Picker() {
  const { open, close } = useOverlay("sessions", "picker");
  const touch = useAppView((v) => v.viewport.density === "touch");
  const noTabs = useAppView((v) => v.workspace.tabs.length === 0);
  return <PickerForm open={open} onClose={close} title="Open" variant={{ to: "plus" }} returnFocusTo={noTabs || touch ? "plus" : "terminal"} searchFocus />;
}
