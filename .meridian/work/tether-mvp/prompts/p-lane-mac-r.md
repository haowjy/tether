# Lane MAC-R: the two behaviour-preserving refactors (R1, R2) for the Mac front

Build steps **R1 and R2 only** of `.meridian/work/tether-mvp/mac-front-design.md`. The rules are in `docs/design/auth.md` ("Reaching LocalAPI", "The Mac front", "Canonical origin"); reasons in `docs/design/decisions.md`. Read `src/auth/AGENTS.md` and `src/http/` first.
- R1: `src/auth/localapi.rs` (LocalAPI client moved out of `identity.rs`), `Transport` enum with only today's Unix variant, `Endpoint { sender, authorization }`, `Full<Bytes>` bodies.
- R2: `src/http/front.rs` (`Front` with its lanes and its gate, run in `server.rs` before the router), `ServeTarget` in `identity.rs`, `server.rs` accepting from several listeners (Unix and TCP stream enum). One name per concept: fold `auth::Front` into this or make it its lane view.
These change no behaviour on Linux or macOS: answers, bodies, headers, error text and logs stay identical; no new per-request allocation on the hot path. Delete what the move replaces; no compatibility shims.
Verify: `cargo test` (existing integration tests pass unchanged apart from constructor signatures), the real-tmux tests on 3.4 and 3.7b, the real-daemon web terminal e2e on 3.4 (smoke), `cargo +1.85 check --locked --all-targets`, `scripts/preflight.sh full`. Keep CPU moderate: no Docker. **Do not commit** — the lead commits; this repo's lanes leave changes in the working tree even if your profile says to commit. Report files, what moved where, verification.
Spawn env TMPDIR=/tmp/tether-meridian-501.
