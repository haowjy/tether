// The only dev-only code in the client (client-architecture.md §5.11): a proxy so the
// unchanged browser adapter runs against Vite's dev server and a daemon on this box.
//
// - It talks to the daemon as a local peer and presents a native token: `Authorization` on
//   HTTP, `tether.auth.<token>` beside `tether.v1` on `/ws`. The token lives here, in the
//   proxy process (TETHER_DEV_TOKEN); page code never sees it.
// - It answers `GET /auth/node/session` itself (a token-bearing request there is a 400), and
//   rewrites `/auth/info.browserOrigin` to the dev server's own origin, so the page and
//   `net/admission.ts` admit it as they would in production.
// - It refuses callers that did not come through Serve: Serve writes `Tailscale-User-Login`.
//   Publish the dev server with `tailscale serve` (browser-auth.md "Next to D1").
//
// The Enrol and admission-problem screens can't be reached through it: the harness drives them.
import { request, type IncomingMessage, type ServerResponse } from "node:http";
import type { Plugin, ProxyOptions } from "vite";

const API_PATHS = ["/ws", "/auth", "/fs", "^/complete$"];

/** The daemon's socket when TETHER_SOCKET names it (socketPath wins over host and port), else loopback TCP. */
function daemonTarget(): { host: string; port: number; socketPath?: string } {
  const socketPath = process.env["TETHER_SOCKET"];
  const tcp = { host: "127.0.0.1", port: Number(process.env["TETHER_PORT"] ?? "7850") };
  return socketPath ? { ...tcp, socketPath } : tcp;
}

function token(): string {
  const value = process.env["TETHER_DEV_TOKEN"];
  if (!value) throw new Error("Set TETHER_DEV_TOKEN to a device token from `tether device add` (web/README.md).");
  return value;
}

function viaServe(req: IncomingMessage): boolean {
  return typeof req.headers["tailscale-user-login"] === "string";
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
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const proto = req.headers["x-forwarded-proto"] ?? "https";
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ...body, browserOrigin: `${String(proto)}://${req.headers.host ?? "localhost"}`, browserRefused: null }));
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
        const api = path === "/ws" || path.startsWith("/auth") || path.startsWith("/fs") || path === "/complete";
        if (!api) {
          next();
        } else if (!viaServe(req)) {
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
              ws: path === "/ws",
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
