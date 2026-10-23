import { httpFsApi, type FsApi } from "../files/api";
import type { HostEntry, Lifecycle, Transport } from "../platform/types";
import { CloseCode } from "../proto/generated/messages";
import { backoffMs } from "../tabs/connection";
import {
  enrolResult,
  fromClose,
  fromInfo,
  fromSession,
  isRetryable,
  TOKEN_REFUSED,
  type Admission,
  type AuthInfo,
  type EnrolResult,
  type SessionReply,
} from "./admission";
import { Host } from "./host";

/** A host's admission state and everything that talks to it. */
export interface HostClient {
  readonly entry: HostEntry;
  /** The daemon's `hostId`; null until `/auth/info`, the saved list or `welcome` says. */
  readonly hostId: string | null;
  /** The host's name for copy ("pop-os"); falls back to the entry's. */
  readonly name: string | null;
  readonly admission: Admission;
  /** The daemon refused the socket for its connection cap (4005): the host banner says so until a socket is welcomed. */
  readonly overCap: boolean;
  /** When the current check began, for "Checking access…" after 10 s. */
  readonly checkingSince: number | null;
  /** The one WebSocket all its tabs share. */
  readonly socket: Host;
  readonly fs: FsApi;
}

export interface HostsOptions {
  transport: Transport;
  onStuck: () => void;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
  random?: () => number;
  now?: () => number;
}

interface Slot {
  client: HostClient;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped by every check, so a slow answer to an older one is dropped. */
  generation: number;
}

/** The text of a JSON error body, if it is one. */
async function readReply(res: Response): Promise<SessionReply> {
  const body = (await res.json().catch(() => null)) as { error?: unknown; reason?: unknown; deviceName?: unknown; node?: { name?: unknown } } | null;
  return {
    status: res.status,
    ...(typeof body?.error === "string" && { error: body.error }),
    ...(typeof body?.reason === "string" && { reason: body.reason }),
    ...(typeof body?.node?.name === "string" && { nodeName: body.node.name }),
    ...(typeof body?.deviceName === "string" && { deviceName: body.deviceName }),
  };
}

/**
 * The hosts the platform knows, each with its admission state and {@link HostClient}.
 * Admission is read from the daemon at every launch (nothing about enrolment is stored in
 * the browser): `/auth/info`, the page origin against `browserOrigin`, then
 * `/auth/node/session`. The sockets run only while the host is admitted, the page is
 * visible and the app unlocked.
 */
export class HostRegistry {
  private readonly slots = new Map<string, Slot>();
  private readonly listeners = new Set<() => void>();
  private lifecycle: Lifecycle = { visible: true, online: true, locked: false };
  private readonly fetchFn: typeof fetch;

  constructor(private readonly opts: HostsOptions) {
    this.fetchFn = opts.fetchFn ?? ((input, init) => fetch(input, init));
  }

  /** In the platform's order. */
  all(): HostClient[] {
    return [...this.slots.values()].map((s) => s.client);
  }

  get(handle: string): HostClient | undefined {
    return this.slots.get(handle)?.client;
  }

  byHostId(hostId: string): HostClient | undefined {
    return this.all().find((c) => c.hostId === hostId);
  }

  /** Calls `listener` after every change to a host's state. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The platform's host list: add new hosts, drop those no longer listed, check admission. */
  set(entries: HostEntry[]): void {
    for (const entry of entries) {
      const slot = this.slots.get(entry.handle);
      if (slot) this.patch(slot, { entry });
      else this.create(entry);
    }
    const handles = new Set(entries.map((e) => e.handle));
    for (const [handle, slot] of this.slots) {
      if (handles.has(handle)) continue;
      clearTimeout(slot.timer);
      slot.client.socket.background();
      this.slots.delete(handle);
    }
    this.emit();
  }

  setLifecycle(lifecycle: Lifecycle): void {
    const before = this.lifecycle;
    this.lifecycle = lifecycle;
    this.applyRunning();
    if ((lifecycle.online && !before.online) || (lifecycle.visible && !before.visible)) this.nudge();
  }

  /** The network came back or the page was shown: retry what waits, now. */
  nudge(): void {
    for (const slot of this.slots.values()) {
      if (isRetryable(slot.client.admission)) {
        slot.attempt = 0;
        void this.check(slot);
      } else {
        slot.client.socket.nudge();
      }
    }
  }

  /** A user retry of a host that failed its check. */
  recheck(handle: string): void {
    const slot = this.slots.get(handle);
    if (!slot) return;
    slot.attempt = 0;
    void this.check(slot);
  }

  /** `POST /auth/node/enroll`, then reads admission again. */
  async enrol(handle: string, code: string, deviceName: string): Promise<EnrolResult> {
    const reply = await this.post(handle, "/auth/node/enroll", { code, deviceName });
    const result = enrolResult(reply);
    if (result.kind === "enrolled") this.recheck(handle);
    else if (result.kind === "nodeRefused") {
      const slot = this.slots.get(handle);
      if (slot) this.patch(slot, { admission: { kind: "nodeRefused", reason: result.reason } });
    }
    return result;
  }

  /** `POST /auth/node/remove`: this node loses access; its sockets close first. */
  async removeDevice(handle: string): Promise<boolean> {
    const slot = this.slots.get(handle);
    if (!slot) return false;
    slot.client.socket.background();
    const reply = await this.post(handle, "/auth/node/remove", {});
    this.recheck(handle);
    return reply.status === 204 || reply.status === 200;
  }

  private create(entry: HostEntry): void {
    const { handle } = entry;
    const socket = new Host({
      open: (handlers) => this.opts.transport.openSocket(handle, handlers),
      onRefused: (code) => { this.onRefused(handle, code); },
      onWelcome: (welcome) => { this.learnHostId(handle, welcome.host.id); },
      onCapped: (capped) => { this.capped(handle, capped); },
      onStuck: this.opts.onStuck,
      ...(this.opts.random && { random: this.opts.random }),
    });
    const slot: Slot = {
      client: {
        entry,
        hostId: entry.hostId,
        name: entry.name,
        // A token-admitted host is admitted until the transport reports a refusal.
        admission: entry.pageOrigin === null ? { kind: "admitted" } : { kind: "deciding" },
        overCap: false,
        checkingSince: entry.pageOrigin === null ? null : this.now(),
        socket,
        fs: httpFsApi(this.opts.transport.httpBase(handle), this.fetchFn),
      },
      attempt: 0,
      timer: undefined,
      generation: 0,
    };
    this.slots.set(handle, slot);
    socket.background(); // closed until admitted
    if (entry.pageOrigin === null) this.applyRunning();
    else void this.check(slot);
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private patch(slot: Slot, change: Partial<Omit<HostClient, "socket" | "fs">>): void {
    slot.client = { ...slot.client, ...change };
    this.applyRunning();
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /** Sockets run while a host is admitted, the page visible and the app unlocked. */
  private applyRunning(): void {
    const { visible, locked } = this.lifecycle;
    for (const { client } of this.slots.values()) {
      if (client.admission.kind === "admitted" && visible && !locked) client.socket.foreground();
      else client.socket.background();
    }
  }

  /** The daemon's id can arrive late (browser) or differ from the saved one (native). */
  private learnHostId(handle: string, hostId: string): void {
    const slot = this.slots.get(handle);
    if (slot && slot.client.hostId !== hostId) this.patch(slot, { hostId });
  }

  private capped(handle: string, overCap: boolean): void {
    const slot = this.slots.get(handle);
    if (slot) this.patch(slot, { overCap });
  }

  private onRefused(handle: string, code: typeof CloseCode.BadToken | typeof CloseCode.AuthUnavailable): void {
    const slot = this.slots.get(handle);
    if (!slot) return;
    if (slot.client.entry.pageOrigin === null) {
      if (code === CloseCode.BadToken) this.patch(slot, { admission: TOKEN_REFUSED });
      return;
    }
    const verdict = fromClose(code);
    if (verdict === "recheck") void this.check(slot);
    else if (verdict) this.settle(slot, verdict);
  }

  /** `/auth/info`, then (if the origin matches) `/auth/node/session`. A retryable answer schedules another. */
  private async check(slot: Slot): Promise<void> {
    const { entry } = slot.client;
    if (entry.pageOrigin === null) return;
    clearTimeout(slot.timer);
    const generation = ++slot.generation;
    const current = (): boolean => slot.generation === generation && this.slots.get(entry.handle) === slot;

    const info = await this.fetchInfo(entry.handle);
    if (!current()) return;
    let admission: Admission;
    if ("status" in info) {
      admission = info.status === 0 ? { kind: "unreachable" } : { kind: "deciding" };
    } else {
      if (info.hostId !== slot.client.hostId || info.name !== slot.client.name) this.patch(slot, { hostId: info.hostId, name: info.name });
      const step = fromInfo(info, entry.pageOrigin);
      if ("admission" in step) {
        admission = step.admission;
      } else {
        const session = await this.send(entry.handle, "/auth/node/session");
        if (!current()) return;
        admission = fromSession(session);
      }
    }
    this.settle(slot, admission);
  }

  /** Records an answer; a retryable one schedules the next check with the host's backoff. */
  private settle(slot: Slot, admission: Admission): void {
    const retry = isRetryable(admission);
    this.patch(slot, { admission, checkingSince: retry ? (slot.client.checkingSince ?? this.now()) : null });
    if (!retry) {
      slot.attempt = 0;
      return;
    }
    const delay = backoffMs(slot.attempt++, (this.opts.random ?? Math.random)());
    slot.timer = setTimeout(() => { void this.check(slot); }, delay);
  }

  private async fetchInfo(handle: string): Promise<AuthInfo | SessionReply> {
    const res = await this.fetchFn(`${this.opts.transport.httpBase(handle)}/auth/info`, { cache: "no-store" }).catch(() => null);
    if (!res) return { status: 0 };
    const body = (await res.json().catch(() => null)) as Partial<AuthInfo> | null;
    if (!res.ok || typeof body?.hostId !== "string" || typeof body.name !== "string" || !body.protocol) return { status: res.ok ? 500 : res.status };
    return {
      hostId: body.hostId,
      name: body.name,
      protocol: body.protocol,
      browserOrigin: body.browserOrigin ?? null,
      browserRefused: body.browserRefused ?? null,
    };
  }

  private async send(handle: string, path: string, init: RequestInit = {}): Promise<SessionReply> {
    const res = await this.fetchFn(`${this.opts.transport.httpBase(handle)}${path}`, { cache: "no-store", ...init }).catch(() => null);
    return res ? readReply(res) : { status: 0 };
  }

  private post(handle: string, path: string, body: object): Promise<SessionReply> {
    return this.send(handle, path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
}
