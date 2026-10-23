// Stub: W3 (Files) owns this file. It holds the hidden file input (lint rule 1 allows a raw
// <input> here) and streams uploads to /fs/upload. Until then, no picker and no uploads.
import type { Uploads } from "../types";

export function createBrowserUploads(): Uploads {
  return {
    pick: () => ({ [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) }),
  };
}
