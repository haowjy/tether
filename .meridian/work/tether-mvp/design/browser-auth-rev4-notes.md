# browser-auth revision 4: edits other drafts need

browser-auth.md revision 4 admits browsers as enrolled tailnet nodes and moves the
daemon onto a Unix socket (its D1). These lines in sibling drafts in this directory
then go stale. They were left unedited, because each draft has its own owner. The
build that lands them should carry these changes.

## resource-limits.md

| Line | Now | Becomes |
|---|---|---|
| 167, limits table, connection permits | "the kernel's backlog of 32 holds newcomers" | "the listen backlog (`somaxconn`; Unix socket) holds newcomers" |
| 203, limits table, shell | "shell stall; response deadline† — 30 s; 60 s" | "shell stall† — 30 s" (no whole-response deadline: review 3 M3) |
| 253 and 655 (R3), pass rule | `anon + kernel + sock − slab_reclaimable` | `anon + shmem + file_dirty + file_writeback + kernel + sock − slab_reclaimable` (review 3 M2: paste files on tmpfs and upload dirty pages can't be dropped) |
| §6.3 ceiling table | no whois row | add "whois: 2 in flight × (64 KiB answer + parse)", about 0.2 MB, unreclaimable, every tier |
| §6.3 and §1, units | ceiling in MB against a budget in MiB | state both in MiB, or convert the budget once (72 MiB = 75.5 MB) |
| §6.2 route caps | no whois | "whois: 2 in flight, 16 waiting, the 17th `503 busy` at once" |
| §3.6, "The accept loop" moved into daemon-core | `TcpListener`, `ConnectInfo<SocketAddr>`, hyper-util `GracefulShutdown` | the Unix-socket listener with `SO_PEERCRED` peer class; a per-connection `select!` calling `UpgradeableConnection::graceful_shutdown()` (review 3 M1); "waiters bounded by count" excepts the auth lane |
| R3 | "the shell's two-profile cold load" | "two browsers' cold load" (one enrolment per machine now) |

## Elsewhere in the work item

- `checkpoint.md`: the open auth question moves from "cookie draft ready for decision"
  to "node-identity draft (rev 4) awaiting Jimmy's D1–D3 and a review round".
- Any implementation plan step that builds `__Host-tether`, sibling detection, or the
  `/auth/browser/*` routes is replaced by `/auth/node/*` and the steps in
  browser-auth.md §3.
