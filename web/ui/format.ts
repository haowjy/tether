/** Unix seconds → "now", "5m", "3h", "2d", then a date such as "Oct 2": how long ago, short. */
export function ago(unixSeconds: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (s < 60) return "now";
  if (s < 3600) return `${String(Math.floor(s / 60))}m`;
  if (s < 86400) return `${String(Math.floor(s / 3600))}h`;
  if (s < 86400 * 7) return `${String(Math.floor(s / 86400))}d`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(s > 86400 * 300 && { year: "numeric" }) });
}
