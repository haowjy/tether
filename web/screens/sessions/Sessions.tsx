// The phone's half-height picker (client-architecture.md §7.4, browser-behaviors.md "Picker (desktop)
// and picker sheet (phone)"): the router overlay `{ screen: "sessions", name: "sheet" }`, opened by
// the current-tab button over the current tab. Under the picker's own rows sit the open tabs: a
// tap on one switches the tab behind the sheet and the sheet stays, while any pick closes it. The
// router owns when it is open, so Back, Escape and the backdrop all close it the same way.
import { useOverlay } from "../../app/context";
import { PickerForm } from "./PickerForm";
import { SheetTabs } from "./SheetTabs";

export function Sessions() {
  const { open, close } = useOverlay("sessions", "sheet");
  return <PickerForm open={open} onClose={close} title="Open" variant="sheet" footer={open && <SheetTabs />} />;
}
