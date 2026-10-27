// The browser's preferences (browser-behaviors.md "Visual treatment"): localStorage, which can
// throw (blocked storage, private modes) or hold anything. A failure to read falls back to the
// defaults and a failure to write keeps the choice for this page: the control still works.
import type { Appearance, Preferences, TextSize } from "../types";

const KEY = "tether.preferences";
const APPEARANCES: readonly Appearance[] = ["system", "light", "dark"];
const TEXT_SIZES: readonly TextSize[] = ["small", "default", "large", "larger"];

const DEFAULTS: Preferences = { appearance: "system", textSize: "default" };

function load(): Preferences {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, unknown> | null;
    const appearance = APPEARANCES.find((a) => a === stored?.["appearance"]);
    const textSize = TEXT_SIZES.find((t) => t === stored?.["textSize"]);
    return { appearance: appearance ?? DEFAULTS.appearance, textSize: textSize ?? DEFAULTS.textSize };
  } catch {
    return DEFAULTS;
  }
}

export interface BrowserPreferences {
  read(): Preferences;
  set<K extends keyof Preferences>(name: K, value: Preferences[K]): void;
}

export function createBrowserPreferences(): BrowserPreferences {
  let current = load();
  return {
    read: () => current,
    set(name, value) {
      current = { ...current, [name]: value };
      try {
        localStorage.setItem(KEY, JSON.stringify(current));
      } catch {
        // Blocked or full: the choice holds for this page.
      }
    },
  };
}
