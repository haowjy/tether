# Review the resource-limits implementation

Code: the working tree / latest local commits on `main` (not pushed): `src/budget.rs`,
`src/http/server.rs` (bounded accept loop), caps in `src/hub/`, `src/config.rs`,
`src/main.rs` (exit 78), `src/fs/upload.rs` (tmpfs refusal), `src/complete`,
`src/proto` (`welcome.daemon.completion`, `limit`), `contrib/tether.service`, docs.
Spec: `.meridian/work/tether-mvp/design/resource-limits.md` rev 2 and its review
`resource-limits-review-1.md`. Implementer's report: `meridian spawn show p47`.

Check correctness and regressions against the spec: cgroup read on v2/hybrid/missing,
tier selection, every cap actually enforced where the ceiling assumes it, the accept
loop (backpressure, shutdown, upgrade handling, no unbounded task growth), the `limit`
message naming sessions, exit codes, the unit file, and efficiency on the hot paths.
What could only be checked on Linux, say so. Note the web client is being rebuilt; its
display of `limit` is out of scope. Severity per finding, file:line. No edits.
