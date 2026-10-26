/** http(s) opens a page that gets no reference back to this one; mailto: hands the address to the mail app and leaves this page in place. */
export function openURL(url: string): void {
  if (/^mailto:/i.test(url)) location.assign(url);
  else if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
}

/**
 * The tether app runs only on iPhone and iPad. iPadOS 13+ reports a Macintosh user agent, told
 * apart from a Mac by its touch points. A UA can be spoofed and the page cannot see whether the
 * app is installed, so on iOS the offer may still find nothing to open.
 */
export function canOpenApp(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function openInApp(origin: string): void {
  location.assign(`tether://add?host=${encodeURIComponent(origin)}`);
}
