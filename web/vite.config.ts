import { execFileSync } from "node:child_process";
import preact from "@preact/preset-vite";
import type { ProxyOptions } from "vite";
import { defineConfig } from "vitest/config";

/** The dev box owner's Tailscale login, which `tailscale serve` would add in production. */
function devLogin(): string {
  const fromEnv = process.env["TETHER_DEV_LOGIN"];
  if (fromEnv) return fromEnv;
  try {
    const status = JSON.parse(execFileSync("tailscale", ["status", "--json"], { encoding: "utf8" })) as {
      Self?: { UserID?: number };
      User?: Record<string, { LoginName?: string }>;
    };
    const login = status.User?.[String(status.Self?.UserID)]?.LoginName;
    if (login) return login;
  } catch {
    // fall through to the explanation
  }
  throw new Error("Can't find the Tailscale login: set TETHER_DEV_LOGIN (web/README.md).");
}

export default defineConfig(({ command, mode }) => ({
  plugins: [preact()],
  // The iOS app loads the build from a custom scheme, so asset URLs are relative.
  base: "./",
  // The bundle ships inside the iOS app and never crosses a network, so xterm.js's size
  // isn't worth splitting for.
  build: { target: "es2022", chunkSizeWarningLimit: 1024 },
  // Dev server only: the daemon wants a loopback peer carrying the owner's login, which
  // `tailscale serve` adds in production. Nothing here reaches a build.
  server:
    command === "serve" && mode !== "test"
      ? {
          proxy: Object.fromEntries(
            // Keys are path prefixes, or a regex when they start with `^`: `/complete` alone
            // would also catch the modules under web/complete/.
            ["/ws", "/auth", "/fs", "^/complete$"].map((path): [string, ProxyOptions] => [
              path,
              {
                target: `http://127.0.0.1:${process.env["TETHER_PORT"] ?? "7850"}`,
                ws: path === "/ws",
                headers: { "Tailscale-User-Login": devLogin() },
                // `/fs/*` and `/complete` carry the device token as native's scheme handler
                // would: the dev shim keeps it in a cookie (dev/shim.ts), sent here as a
                // Bearer token.
                configure: (proxy) => {
                  proxy.on("proxyReq", (req, incoming) => {
                    const token = /(?:^|;\s*)tether_dev_token=([^;]+)/.exec(incoming.headers.cookie ?? "")?.[1];
                    req.removeHeader("cookie");
                    if (token) req.setHeader("Authorization", `Bearer ${decodeURIComponent(token)}`);
                  });
                },
              },
            ]),
          ),
        }
      : {},
  test: { include: ["**/*.test.ts"], exclude: ["node_modules", "dist"] },
}));
