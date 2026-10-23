// Stub: W4 (PWA) owns this file. It implements `updates` (the service worker's check and
// apply) and `install` (display-mode: standalone), and emits `update` events. Until then the
// browser platform offers neither capability.
import type { Platform } from "../types";

export function createPwa(): Pick<Platform, "updates" | "install"> {
  return {};
}
