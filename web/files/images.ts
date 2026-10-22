// Images reach /fs/raw two at a time (fs.md "Two slots are enough for the web"): the
// daemon has two raw slots, and `<img>` doesn't retry a `busy`. Each starts loading only
// once it scrolls into view (plan.md "Bandwidth").

const SLOTS = 2;
let running = 0;
const waiting: (() => void)[] = [];

function next(): void {
  while (running < SLOTS && waiting.length > 0) {
    running++;
    waiting.shift()?.();
  }
}

/** Points `img` at `src` when a slot is free; the returned function gives up on it. */
export function loadImage(img: HTMLImageElement, src: string): () => void {
  let state: "waiting" | "loading" | "done" = "waiting";
  const release = (): void => {
    if (state !== "loading") return;
    state = "done";
    running--;
    next();
  };
  const start = (): void => {
    state = "loading";
    img.addEventListener("load", release, { once: true });
    img.addEventListener("error", release, { once: true });
    img.src = src;
  };
  waiting.push(start);
  next();
  return () => {
    if (state === "waiting") {
      const at = waiting.indexOf(start);
      if (at >= 0) waiting.splice(at, 1);
      state = "done";
    } else {
      release();
    }
  };
}

/**
 * Loads every `img[data-src]` under `root` as it nears the visible part of `scroller`.
 * Returns the function that stops watching and drops what hasn't loaded.
 */
export function lazyImages(root: HTMLElement, scroller: HTMLElement | null): () => void {
  const cancels: (() => void)[] = [];
  const observer = new IntersectionObserver((seen) => {
    for (const { isIntersecting, target } of seen) {
      if (!isIntersecting || !(target instanceof HTMLImageElement)) continue;
      observer.unobserve(target);
      const src = target.dataset["src"];
      if (src) cancels.push(loadImage(target, src));
    }
  }, { root: scroller, rootMargin: "200px 0px" });
  for (const img of root.querySelectorAll<HTMLImageElement>("img[data-src]")) observer.observe(img);
  return () => {
    observer.disconnect();
    for (const cancel of cancels) cancel();
  };
}
