/** http(s) only; the opened page gets no reference back to this one. */
export function openURL(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  window.open(url, "_blank", "noopener");
}
