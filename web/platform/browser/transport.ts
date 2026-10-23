import { HostLink } from "../../proto/link";
import type { Transport } from "../types";

/** Same-origin `/ws`, offering `tether.v1` only: the browser holds no credential. */
export function createBrowserTransport(): Transport {
  return {
    openSocket(_handle, handlers) {
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      return new HostLink({ url: `${scheme}://${location.host}/ws`, build: import.meta.env.MODE, kind: "web" }, handlers);
    },
    httpBase: () => "",
  };
}
