const RELOAD_KEY = "tether.lastStuckReload";
const RELOAD_EVERY_MS = 10 * 60_000;

/**
 * A stuck socket reloads the page, at most once per 10 minutes, so a slow cellular link
 * can't loop reloads; past that the host stays halted with Retry. An update always reloads
 * (the user tapped it).
 */
export function restart(reason: "stuck" | "update"): void {
  if (reason === "stuck") {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_EVERY_MS) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  }
  location.reload();
}
