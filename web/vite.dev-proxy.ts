// The only dev-only code in the client (client-architecture.md §5.11): a proxy so the
// unchanged browser adapter runs against Vite's dev server and a daemon on this box.
//
// - It talks to the daemon as a local peer and presents a native token: `Authorization` on
//   HTTP, `tether.auth.<token>` beside `tether.v1` on `/ws`. The token lives here, in the
//   proxy process (TETHER_DEV_TOKEN); page code never sees it.
// - It answers `GET /auth/node/session` itself (a token-bearing request there is a 400), and
//   rewrites `/auth/info.browserOrigin` to the dev server's own origin, so the page and
//   `net/admission.ts` admit it as they would in production.
// - It injects a credential, so it refuses foreign origins (HTTP and the `/ws` upgrade alike):
//   a page on another origin must not borrow the token, the cross-site hijack auth.md rules out.
//   `Origin` must be the dev server's own origin; an upgrade without one is refused.
//   Serve's `Tailscale-User-Login` header is only a hint that the dev server was published with
//   `tailscale serve` (browser-auth.md "Next to D1"): any local caller can forge it.
//
// The Enrol and admission-problem screens can't be reached through it: the harness drives them.
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, join } from "node:path";
import type { Plugin, ProxyOptions } from "vite";

/** The one list of daemon paths, as Vite proxy keys (a leading `^` makes the key a regex, so `/wsx` is not `/ws`) and as the check's matchers. */
const API_PATHS = ["/ws", "/auth", "/fs", "/complete"].map((path) => `^${path}(?:[/?]|$)`);
const API_MATCHERS = API_PATHS.map((key) => new RegExp(key));

/** The daemon's local front; TETHER_SOCKET overrides its platform runtime path. */
function daemonTarget(): { host: string; port: number; socketPath?: string } {
  const runtimeDir = process.platform === "darwin" ? process.env["TMPDIR"] : process.env["XDG_RUNTIME_DIR"];
  const socketPath = process.env["TETHER_SOCKET"] ?? (runtimeDir && join(runtimeDir, "tether/local.sock"));
  if (!socketPath || !isAbsolute(socketPath)) {
    throw new Error("Set TETHER_SOCKET or an absolute XDG_RUNTIME_DIR (TMPDIR on macOS) for tether's local.sock.");
  }
  return { host: "127.0.0.1", port: 0, socketPath };
}

function token(): string {
  const value = process.env["TETHER_DEV_TOKEN"];
  if (!value) throw new Error("Set TETHER_DEV_TOKEN to a device token from `tether device add` (web/README.md).");
  return value;
}

function viaServe(req: IncomingMessage): boolean {
  return typeof req.headers["tailscale-user-login"] === "string";
}

/** The origin the browser sees this dev server at, which the daemon's `browserOrigin` is rewritten to. */
function ownOrigin(req: IncomingMessage): string {
  return `${String(req.headers["x-forwarded-proto"] ?? "https")}://${req.headers.host ?? "localhost"}`;
}

/** Whether a page at the dev server's own origin sent this request. Browsers always send `Origin` on an upgrade; a same-origin GET may omit it. */
function fromOwnOrigin(req: IncomingMessage, upgrade: boolean): boolean {
  const { origin } = req.headers;
  if (origin !== undefined) return origin === ownOrigin(req);
  const site = req.headers["sec-fetch-site"];
  return !upgrade && (site === undefined || site === "same-origin" || site === "none");
}

function deny(res: ServerResponse): void {
  res.statusCode = 403;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "forbidden" }));
}

/** `/auth/info` from the daemon, with `browserOrigin` set to this dev server's origin. */
function authInfo(req: IncomingMessage, res: ServerResponse): void {
  const upstream = request({ ...daemonTarget(), path: "/auth/info", method: "GET" }, (reply) => {
    const chunks: Buffer[] = [];
    reply.on("data", (c: Buffer) => chunks.push(c));
    reply.on("end", () => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      } catch {
        res.statusCode = 502;
        res.end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ...body, browserOrigin: ownOrigin(req), browserRefused: null }));
    });
  });
  upstream.on("error", () => { res.statusCode = 502; res.end(); });
  upstream.end();
}

export function devProxy(): Plugin {
  return {
    name: "tether-dev-proxy",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (!API_MATCHERS.some((match) => match.test(req.url ?? ""))) {
          next();
        } else if (!viaServe(req) || !fromOwnOrigin(req, false)) {
          deny(res);
        } else if (path === "/auth/info") {
          authInfo(req, res);
        } else if (path === "/auth/node/session") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ deviceName: "vite dev" }));
        } else {
          next();
        }
      });
    },
    config: () => ({
      server: {
        proxy: Object.fromEntries(
          API_PATHS.map((path): [string, ProxyOptions] => [
            path,
            {
              target: daemonTarget(),
              ws: path.startsWith("^/ws"),
              // Vite runs `bypass` on an upgrade before it proxies it, with no `res`; the Connect
              // middleware above never sees upgrades. HTTP is checked there.
              bypass: (req, res) => {
                if (res || (viaServe(req) && fromOwnOrigin(req, true))) return undefined;
                req.socket.destroy();
                return false;
              },
              configure: (proxy) => {
                proxy.on("proxyReq", (proxyReq) => {
                  proxyReq.removeHeader("cookie");
                  proxyReq.setHeader("Authorization", `Bearer ${token()}`);
                });
                proxy.on("proxyReqWs", (proxyReq) => {
                  proxyReq.setHeader("Sec-WebSocket-Protocol", `tether.v1, tether.auth.${token()}`);
                });
              },
            },
          ]),
        ),
      },
    }),
  };
}
