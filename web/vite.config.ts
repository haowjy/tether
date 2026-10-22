import { execFileSync } from "node:child_process";
import preact from "@preact/preset-vite";
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

export default defineConfig(({ command }) => ({
  plugins: [preact()],
  // The iOS app loads the build from a custom scheme, so asset URLs are relative.
  base: "./",
  build: { target: "es2022" },
  // Dev server only: the daemon wants a loopback peer carrying the owner's login, which
  // `tailscale serve` adds in production. Nothing here reaches a build.
  server:
    command === "serve"
      ? {
          proxy: Object.fromEntries(
            ["/ws", "/auth"].map((path) => [
              path,
              {
                target: `http://127.0.0.1:${process.env["TETHER_PORT"] ?? "7850"}`,
                ws: true,
                headers: { "Tailscale-User-Login": devLogin() },
              },
            ]),
          ),
        }
      : {},
  test: { include: ["**/*.test.ts"], exclude: ["node_modules", "dist"] },
}));
