// The real-daemon stack the `*.real.ts` specs share: a real tether daemon on a private tmux,
// with the app served by Vite's dev server through the dev proxy (client-architecture.md
// §5.11). Everything is isolated under one directory, `<tmpdir>/e2e-<port>/<name>`: the
// daemon's runtime, state and config, the tmux socket, and the ports. It never touches the
// installed service, Tailscale, or a real tmux server. Run it with `pnpm e2e:real`.
//
// The daemon needs tailscaled's LocalAPI to answer `/auth/info`, which this machine lacks, so
// the front proxy (standing in for Tailscale Serve) answers that one route itself. Every other
// request, `/ws` included, reaches the real daemon through the dev proxy with a native token.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os, { homedir } from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";

// Keyed on the port the e2e run was given, so runs on different ports never share a directory.
const ROOT = path.join(os.tmpdir(), `e2e-${process.env["TETHER_E2E_PORT"] ?? "5199"}`);
const WEB = path.resolve(import.meta.dirname, "../..");
const DAEMON = path.resolve(WEB, "../target/debug/tether");

export type TmuxVersion = "3.4" | "3.7b";

export interface Stack {
  /** The page's origin, as the browser sees it. */
  url: string;
  /** A scratch directory for files a test's shell reads and writes. */
  dir: string;
  /** Runs tmux against the daemon's private server. */
  tmux(...args: string[]): string;
  /** Stops the daemon (tmux keeps running) and starts it again on the same state: a restart under a connected page. */
  stopDaemon(): Promise<void>;
  startDaemon(): Promise<void>;
  /** A terminal client attached to `session`, as someone's own terminal would be; returns the way to detach. */
  attach(session: string): () => void;
  /** Destroys every open `/ws` connection at the front proxy, and says how many: a socket kill. */
  dropSockets(): number;
  stop(): Promise<void>;
}

export function tmuxBinary(version: TmuxVersion): string {
  return process.env["TETHER_TMUX"] ?? path.join(homedir(), ".cache/tether-tmux", version, "bin/tmux");
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => { resolve(port); });
    });
  });
}

async function waitFor(what: string, ready: () => boolean | Promise<boolean>, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await ready()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export interface StackOptions {
  tmux: TmuxVersion;
  /** Unique per running stack: names the directory and the tmux socket. */
  name: string;
  /** `memory_budget_mib` for the daemon; the default 72 allows three tmux sessions. */
  memoryMiB?: number;
}

export async function startStack(options: StackOptions): Promise<Stack> {
  const root = path.join(ROOT, options.name);
  rmSync(root, { recursive: true, force: true });
  for (const dir of ["run", "state", "home", "cfg"]) mkdirSync(path.join(root, dir), { recursive: true });
  // Short on purpose: a Unix socket path holds about 100 bytes, and tmux nests this name under the run directory.
  const socketName = options.name;
  const program = tmuxBinary(options.tmux);
  if (!existsSync(program)) throw new Error(`no tmux ${options.tmux} at ${program}`);
  const config = path.join(root, "cfg/config.toml");
  writeFileSync(
    config,
    [`name = "pop-os"`, ...(options.memoryMiB ? [`memory_budget_mib = ${String(options.memoryMiB)}`] : []), `[tmux]`, `program = "${program}"`, `socket_name = "${socketName}"`].join("\n"),
  );
  // macOS reads the runtime directory from TMPDIR; HOME holds the uploads and roots.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TMPDIR: path.join(root, "run"),
    XDG_RUNTIME_DIR: path.join(root, "run"),
    XDG_STATE_HOME: path.join(root, "state"),
    XDG_CONFIG_HOME: path.join(root, "cfg"),
    HOME: path.join(root, "home"),
    TMUX_TMPDIR: path.join(root, "run"),
  };
  delete env["TMUX"];

  const children: ChildProcess[] = [];
  const signal = (sig: NodeJS.Signals): void => {
    for (const child of children) if (child.pid !== undefined) try { process.kill(-child.pid, sig); } catch { /* already gone */ }
  };
  /** A start that fails must not leave its daemon or dev server running. */
  const guarded = async <T>(step: () => Promise<T>): Promise<T> => {
    try {
      return await step();
    } catch (error) {
      signal("SIGKILL");
      throw error;
    }
  };
  const spawnChild = (command: string, args: string[], extra: NodeJS.ProcessEnv, cwd: string, log: string): ChildProcess => {
    appendFileSync(path.join(root, log), ""); // a restarted daemon appends to its log
    // Its own process group, so stopping the stack takes down everything the command started.
    const child = spawn(command, args, { cwd, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const append = (chunk: Buffer): void => {
      // The directory is gone once the stack stops; late output has nowhere to go.
      if (existsSync(root)) appendFileSync(path.join(root, log), chunk);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    children.push(child);
    return child;
  };

  const local = path.join(root, "run/tether/local.sock");
  let daemon: ChildProcess | undefined;
  const startDaemon = async (): Promise<void> => {
    rmSync(local, { force: true });
    daemon = spawnChild(DAEMON, ["--config", config, "serve", "--allow-login", "e2e"], {}, root, "daemon.log");
    await waitFor("the daemon's local socket", () => existsSync(local));
  };
  const stopDaemon = async (): Promise<void> => {
    const child = daemon;
    daemon = undefined;
    if (child?.pid === undefined) return;
    const gone = new Promise<void>((resolve) => { child.once("exit", () => { resolve(); }); });
    process.kill(-child.pid, "SIGTERM");
    await gone;
  };
  await guarded(startDaemon);
  const token = execFileSync(DAEMON, ["--config", config, "device", "add", "e2e"], { env, encoding: "utf8" }).trim().split("\n").pop() ?? "";
  const hostId = readFileSync(path.join(root, "state/tether/host_id"), "utf8").trim();

  const vitePort = await freePort();
  spawnChild(
    process.execPath,
    [path.join(WEB, "node_modules/vite/bin/vite.js"), "--config", "e2e/shared/vite.config.ts", "--port", String(vitePort), "--strictPort", "--host", "127.0.0.1", "--configLoader", "runner"],
    { TETHER_SOCKET: local, TETHER_DEV_TOKEN: token, TETHER_E2E_VITE_CACHE: path.join(root, "vite-cache") },
    WEB,
    "vite.log",
  );
  await guarded(() => waitFor("vite", async () => await fetch(`http://127.0.0.1:${String(vitePort)}/`).then((r) => r.ok, () => false), 90_000));

  // Stands in for Tailscale Serve: it adds the identity header the dev proxy insists on, and
  // answers `/auth/info` for the daemon, which has no tailscaled to ask.
  const sockets = new Set<Duplex>();
  const front = http.createServer((req, res) => {
    if (req.url?.split("?")[0] === "/auth/info") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ hostId, name: "pop-os", protocol: { min: 1, max: 1 }, browserOrigin: `http://${req.headers.host ?? ""}`, browserRefused: null }));
      return;
    }
    const up = http.request({ host: "127.0.0.1", port: vitePort, path: req.url ?? "/", method: req.method, headers: { ...req.headers, "tailscale-user-login": "e2e", "x-forwarded-proto": "http" } }, (reply) => {
      res.writeHead(reply.statusCode ?? 502, reply.headers);
      reply.pipe(res);
    });
    up.on("error", () => { res.statusCode = 502; res.end(); });
    req.pipe(up);
  });
  front.on("upgrade", (req, socket, head) => {
    const up = net.connect(vitePort, "127.0.0.1", () => {
      const headers: string[] = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) headers.push(`${req.rawHeaders[i] ?? ""}: ${req.rawHeaders[i + 1] ?? ""}`);
      up.write(`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1\r\n${[...headers, "tailscale-user-login: e2e", "x-forwarded-proto: http"].join("\r\n")}\r\n\r\n`);
      up.write(head);
      socket.pipe(up);
      up.pipe(socket);
    });
    // Only the daemon's socket counts: killing Vite's HMR socket makes the page reload.
    if (req.url?.split("?")[0] === "/ws") sockets.add(socket);
    socket.on("close", () => { sockets.delete(socket); up.destroy(); });
    up.on("close", () => { socket.destroy(); });
    up.on("error", () => { socket.destroy(); });
    socket.on("error", () => { up.destroy(); });
  });
  const frontPort = await freePort();
  await new Promise<void>((resolve) => front.listen(frontPort, "127.0.0.1", resolve));

  const tmux = (...args: string[]): string => execFileSync(program, ["-L", socketName, ...args], { env, encoding: "utf8" });

  return {
    url: `http://127.0.0.1:${String(frontPort)}`,
    dir: path.join(root, "home"),
    tmux,
    stopDaemon,
    startDaemon,
    attach: (session) => {
      const child = spawn("script", ["-q", "/dev/null", program, "-L", socketName, "attach", "-t", session], { env, stdio: "ignore" });
      return () => { child.kill(); };
    },
    dropSockets: () => {
      const count = sockets.size;
      for (const s of sockets) s.destroy();
      return count;
    },
    stop: async () => {
      for (const s of sockets) s.destroy();
      front.close();
      try {
        tmux("kill-server");
      } catch {
        // no server was started
      }
      signal("SIGTERM");
      await new Promise((r) => setTimeout(r, 300));
      signal("SIGKILL");
      if (!process.env["TETHER_E2E_KEEP"]) rmSync(root, { recursive: true, force: true });
    },
  };
}
