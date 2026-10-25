# MAC-R: fold in the reviews (p179, p180) before the Mac front lands; uncommitted

Read `meridian spawn show p179` and `meridian spawn show p180`. Both approve R1/R2 (behaviour byte-identical). Fix these now so M1–M3 only add variants:
- p180 #1 / p179 #1: request extensions carry only a `Copy` lane view, not `Front`; `gate` is `match self`; `connection` gets `&Front`/`Arc<Front>`. Name the lane type in `auth` (e.g. `auth::NodeLane { Allowed, Refused }`) and pass it to `Auth::check` instead of a bool; delete `front::Lanes` (p180 #5, p179 #2).
- p180 #2: break the `localapi` ↔ `identity` import cycle: `localapi` is transport, pool and whois and returns parsed answers; `TailnetState` assembly moves next to the cell in `identity.rs`.
- p179 #4: `Client::request` takes method, extra headers and an optional body and returns status, headers and body; the 404→`NoPeer` mapping moves into `whois`.
- p180 #3: delete the unreachable `SocketIdentity::default()` check, the `Default` derive and `SocketIdentity::of`; one `origin(target: Option<&ServeTarget>, serve)` used at all four sites, refusal text coming from the target (or its absence).
- p180 #4: `canonical_origin`/`collect_*` take `&ServeTarget`; matching is `ServeTarget::names(&self, proxy)`.
- p180 #6: `gate(&self, &mut Request<B>) -> Option<Response>`, no clippy allow.
- p180 #7: make `connection`/`AcceptedStream` generic over the stream and match once at spawn, deleting the hand-written delegation, if it comes out smaller; otherwise leave it and say why.
- Docs: p179 #3 (daemon-core.md: front inserted only after the gate), p180 #8.
- Note for M2 (write into `.meridian/work/tether-mvp/mac-front-design.md` M2): the Loopback gate compares the raw request target (absolute-form URIs) and decides on duplicate `Host`/`X-Forwarded-Host` (refuse).
Behaviour stays byte-identical (the reviewers' probes are in /tmp/rev-r12 and /tmp/rv-{base,cur}: reuse them to diff old vs new). Verify: `cargo test`, real-tmux 3.4/3.7b, `cargo check --target x86_64-unknown-linux-gnu --all-targets`, `cargo +1.85 check --locked --all-targets`, `scripts/preflight.sh full`. No Docker. **Do not commit.** Short report per item.
Spawn env TMPDIR=/tmp/tether-meridian-501.
