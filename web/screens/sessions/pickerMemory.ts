// The side the picker was last on, shared by its three containers (the half sheet, the desktop
// popover, a server's sheet): one value for the page.
import type { AppController } from "../../app/controller";
import { Store } from "../../ui/store";

export type Side = "sessions" | "files";

class PickerMemory extends Store<{ side: Side }> {
  constructor() {
    super({ side: "sessions" });
  }

  setSide(side: Side): void {
    this.update({ side });
  }
}

const memories = new WeakMap<AppController, PickerMemory>();

export function pickerMemoryOf(app: AppController): PickerMemory {
  let memory = memories.get(app);
  if (!memory) {
    memory = new PickerMemory();
    memories.set(app, memory);
  }
  return memory;
}
