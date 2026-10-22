import type { ErrorBody, HttpError } from "../proto/generated/messages";

// The generic client for a host's HTTP origin (the file API, /complete).

/**
 * The daemon's generated codes, plus the client's own: `network` when nothing answered,
 * `incompatible` from native's proxy, `http_<status>` for a refusal without a code.
 */
export type RefusalCode = HttpError | "network" | "incompatible" | `http_${string}`;

/** A refusal: the daemon's `{"error": code}` ({@link ErrorBody}), or one of the client's codes. */
export class HttpRefusal extends Error {
  constructor(readonly status: number, readonly code: RefusalCode) {
    super(code);
  }
}

/** `busy` is answered with `Retry-After: 1`; a couple of retries ride out a burst. */
export const BUSY_RETRIES = 2;

/**
 * One request to a host's HTTP origin. A refusal becomes an {@link HttpRefusal} with the
 * daemon's code, a dead network `network`; `busy` is retried `retries` times.
 */
export async function send(target: string, init: RequestInit = {}, retries = BUSY_RETRIES, fetchFn: typeof fetch = (input, opts) => fetch(input, opts)): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(target, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new HttpRefusal(0, "network");
    }
    if (res.ok) return res;
    const code = await res.json().then((b: unknown) => (b as Partial<ErrorBody> | null)?.error, () => undefined);
    const err = new HttpRefusal(res.status, typeof code === "string" ? code : `http_${String(res.status)}`);
    if (err.code !== "busy" || attempt >= retries) throw err;
    const wait = Number(res.headers.get("Retry-After")) || 1;
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}
