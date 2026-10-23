/** http(s) opens a page that gets no reference back to this one; mailto: hands the address to the mail app and leaves this page in place. */
export function openURL(url: string): void {
  if (/^mailto:/i.test(url)) location.assign(url);
  else if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener");
}
