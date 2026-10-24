import type { Link } from "../../net/host";
import { HostLink, type LinkHandlers } from "../../proto/link";
import { CloseCode, type ClientMsg } from "../../proto/generated/messages";
import type { Transport } from "../types";
import type { Bridge } from "./bridge";

/**
 * A socket whose URL and token come from native just before it opens (ios-shell.md
 * "Transport"). `Host` gets its Link at once and the real `HostLink` follows when native
 * answers. The token lives in this closure and goes nowhere else except back to native
 * when the daemon refuses it.
 */
class NativeLink implements Link {
  private inner: HostLink | null = null;
  private closed = false;

  constructor(
    private readonly handle: string,
    private readonly handlers: LinkHandlers,
    private readonly bridge: Bridge,
  ) {
    void this.open();
  }

  get ready(): boolean {
    return this.inner?.ready ?? false;
  }

  send(msg: ClientMsg): void {
    this.inner?.send(msg);
  }

  close(): void {
    this.closed = true;
    this.inner?.close();
  }

  private async open(): Promise<void> {
    const reply = await this.bridge.socket(this.handle).catch(() => null);
    if (this.closed) return;
    if (reply === null || "locked" in reply) {
      // Locked: `lifecycle.locked` stops the sockets and its unlock restarts them; the backoff covers the gap.
      this.fail(1006, true);
    } else if ("notEnrolled" in reply) {
      this.fail(CloseCode.BadToken, false); // no token to echo: native already has none
    } else {
      const { url, token } = reply;
      this.inner = new HostLink({ url, token, build: import.meta.env.MODE, kind: "ios" }, {
        ...this.handlers,
        close: (close) => {
          if (close.code === CloseCode.BadToken) this.bridge.hostRejected(this.handle, token);
          this.handlers.close(close);
        },
      });
    }
  }

  private fail(code: number, retry: boolean): void {
    this.closed = true;
    this.handlers.close({ code, retry });
  }
}

/** `tether-app://h-<handle>` is native's HTTP proxy for a host (auth, files, completion); sockets use the Link above. */
export function createNativeTransport(bridge: Bridge): Transport {
  return {
    openSocket: (handle, handlers) => new NativeLink(handle, handlers, bridge),
    httpBase: (handle) => `tether-app://h-${handle}`,
  };
}
