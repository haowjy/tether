# Rust or Go for the daemon

The language comparison behind the daemon's stack, written 2026-10-21. The decision
(Rust) is logged in [decisions.md](../decisions.md#rust-for-the-daemon); the library picks are in
[plan.md](../plan.md#stack).

- Rust: idle memory about 2–5 MB with no garbage collector, versus roughly 10–20 MB for
  Go, and memory use stays predictable under bursts. That matters on an already
  overloaded box. Bounded channels make backpressure explicit. One static musl binary
  with no runtime dependencies.
- Go: faster to write, with excellent `creack/pty` and `coder/websocket`, and embedding
  `tsnet` would allow in-process identity checks. It loses on idle memory and GC
  behaviour under load; pick it only if shipping speed matters more than resources.
