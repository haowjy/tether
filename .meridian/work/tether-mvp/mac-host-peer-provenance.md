# Mac host: peer-process provenance is infeasible without root (p170)

**Result:** on this Mac (macOS 27.0.1, build 26A434; Tailscale 1.104.2 macsys), a daemon
running as Jimmy cannot tell which process owns the other end of a loopback TCP
connection when that process is root. Every unprivileged route the kernel offers
hides the Tailscale extension's sockets. So the trust rule Jimmy chose for the Mac
front ("every TCP connection verified to come from Tailscale's root-owned, signed
extension") cannot be built in an unprivileged tether. Per the brief, the auth.md,
running.md, plan.md and decisions.md revisions were **not written**; this note is the
stop report and the input to Jimmy's next call.

## What was tried

The extension is pid 23448, uid 0:
`/Library/SystemExtensions/…/io.tailscale.ipn.macsys.network-extension`, Team ID
`W5364U7YZB`, app-sandboxed. The test was a Serve entry `http://127.0.0.1:<port>`
in front of a throwaway listener, with a request through
`https://jimmys-macbook-air.tail852a76.ts.net/` held open on Serve's pooled
backend connection.

| Route (run as uid 501, outside the agent sandbox) | Result |
|---|---|
| `getsockopt(LOCAL_PEERPID / LOCAL_PEERCRED)` | Unix-domain sockets only; no TCP equivalent on macOS |
| libproc: `proc_pidinfo(23448, PROC_PIDLISTFDS)`, then `PROC_PIDFDSOCKETINFO` | `EPERM`. `proc_pidpath` and `PROC_PIDT_SHORTBSDINFO` do work (path, uid 0), but they need a pid, and the pid is the unknown |
| sysctl `net.inet.tcp.pcblist_n` (the `xsocket_n` record carries `so_uid`, `so_last_pid`, `so_e_pid`) | Header says 113–115 PCBs, but no records are returned for other processes. A process sees only its own sockets: the listener's own accepted socket appears, while the curl client running as the same uid does not. Public xnu source has no such filter, so this is newer than the open source |
| NetworkStatistics kernel control `com.apple.network.statistics` (nettop's source; `net.statistics_privcheck=0`, so connect and `ADD_ALL_SRCS` succeed) | Returns about 90 TCP flows, all from Jimmy's own processes (Chrome, ssh, the Tailscale GUI pid 23394). The extension's side of the live pooled connection (`127.0.0.1:49444 → :18436`) is absent; only the listener's side appears. No flow from pid 23448 is listed |
| LocalAPI `whois?addr=127.0.0.1:<peer port>` (Tailscale's `proxymap`) | `404 no match for IP:port` after 368 ms. Serve's HTTP proxy doesn't register its loopback ports (`ipn/ipnlocal/serve.go` v1.104.2 line 726 is a TODO saying so; only netstack's forwarder registers) |
| `lsof -iTCP` as Jimmy | Lists only Jimmy's processes (it is built on libproc) |

`lsof` and `sudo` as root were not tried (`sudo` needs a password). Root very
likely sees every flow, so a root helper is the only way to get peer provenance on
this OS. That is unverified.

## Also settled while here

- **Why Unix targets 502 (root cause, previously only inferred).** The extension
  logs `http: proxy error: dial unix …/serve.sock: connect: operation not permitted`.
  This happens even for a socket under `/private/var/db/mds/`, a world-writable
  (sticky) directory that the extension's sandbox lists in
  `temporary-exception.files.absolute-path.read-write`. File exceptions do not grant
  unix-socket connects. The extension's other writable paths (`/Library/Tailscale/`,
  `/private/var/root/Library/Group Containers/`) are root-only. So the macsys app
  can't reach a Unix front at all.
- **A Serve path prefix survives every request.** With the target
  `http://127.0.0.1:P/s3cr3t`: `/` arrives as `/s3cr3t/`, `/ws` as `/s3cr3t/ws`,
  a WebSocket upgrade (`101`) as `/s3cr3t/ws?x=1`, a POST as
  `/s3cr3t/auth/node/enroll`, and `%2F` stays encoded. A client-sent `/s3cr3t/x` becomes
  `/s3cr3t/s3cr3t/x`, so a client can't strip the prefix.
- **The secret is not private to Serve.** It is in the serve config (readable
  through LocalAPI by anyone holding the proof token, which is `root:admin 0640`),
  in `tailscale serve status`, and in the extension's unified-log line
  `serve: creating a new proxy handler for http://127.0.0.1:P/<secret>`. Logtail
  upload of that line is unverified.
- **TCP targets get the browser's `Host`, not `localhost`.** A request sent with
  `Host: evil` arrived with `Host: evil` and `X-Forwarded-Host: evil`. Serve
  replaced forged `Tailscale-User-Login` and `X-Forwarded-For` (the login became the
  real one; XFF became `100.69.69.122`), as it does for `unix:`. So the HTTP
  proxy's identity headers are as trustworthy over TCP as over Unix. The open
  question is only who else can open the TCP connection.
- **Serve pools backend connections.** One backend connection (port 49444) carried
  six requests; an upgrade got its own. A per-connection check would run once per
  pooled connection.

## Options for Jimmy

| Option | What the Mac front trusts | Cost | Notes |
|---|---|---|---|
| **A. Root peer helper**: a tiny root launchd daemon, installed once with sudo, that answers "which pid, uid and signing identity owns this loopback 4-tuple" over a Unix socket that tether verifies with `LOCAL_PEERCRED` | Kernel-attested peer identity. Matches Jimmy's chosen rule | A second binary running as root, a launchd plist and a sudo install step; the helper itself becomes attack surface. Unverified that root sees the flows on macOS 27 (one sudo probe settles it) | Conflicts with "light" and "never the owner", and a root component is a new class of thing for tether |
| **B. Secret path prefix + Host/origin rules, no peer check** | Confidentiality of the serve config: root, admin-group users (who can sudo, so effectively root), Jimmy's processes (already trusted), and unified-log readers | Small: prefix routing, a generated secret, rotation by re-publishing | Stops web pages (CSRF and rebinding can't learn the path) and non-admin local users (can't read the proof file). Weaker than Linux: there the kernel enforces the boundary (a `0700` directory); here it rests on Tailscale's file modes and logging. Unverified: whether a non-admin user's Tailscale GUI or a sandboxed app as Jimmy can read the serve config |
| **C. Standalone `tailscaled` (Homebrew/open-source)** | Linux model unchanged (Unix socket, `0700` directory) | Operator setup; conflicts with the app | Rejected earlier by Jimmy; still the only option with Linux-equal guarantees and no root helper |
| **D. Mac stays Linux-only for hosting** | n/a | none | Status quo |

**Variant note.** The Mac App Store variant runs `IPNExtension` as the user, not
root (upstream `safesocket_darwin.go` finds it with `lsof -u<uid>`). In that
variant the extension's flows should be visible in Jimmy's own NetworkStatistics
view, so per-connection pid plus a `SecCode` signature check may be feasible
unprivileged there. On that variant, though, "peer is the extension" only proves
"a process running as Jimmy that is Tailscale-signed". Unverified: no MAS install
here.

My recommendation, if Jimmy still wants a Mac host on the Tailscale app: **B**,
stated honestly as a weaker local boundary than Linux, acceptable only on a Mac
whose only admin account is Jimmy's. Pick **A** only if he accepts a root component
in exchange for Linux-equivalent local isolation. Probe the root visibility first
(`sudo ./nst <port>` from the POC) before designing it.

## Artifacts

POC sources: `/tmp/tether-meridian-501/macdesign-p170/` (`peer.c`: pcblist_n and
SecCode; `dump.c`: pcblist_n dump; `fds.c`: libproc; `nst.c`: NetworkStatistics;
`pfx.py`: prefix probe; `userver.py`: Unix target with `LOCAL_PEERCRED`).
`tailscale serve reset` was run (status: `No serve config`); every listener was
killed; `/private/var/db/mds/tether-probe-501` was removed. No repository files
were edited and no Funnel was used.
