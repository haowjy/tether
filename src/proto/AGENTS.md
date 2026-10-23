# proto

The wire protocol, defined once: serde types for the JSON messages, the binary frame
codec, the version range and close codes. A leaf module: it names no other tether
module, so `http/` and `hub/` both use it.

`web/proto/generated/messages.ts` is rendered from these types (ts-rs) by the test in
`typescript.rs`: the messages, the `/fs/*` (`fs.rs`) and `/complete` (`complete.rs`)
bodies, and the error body every route shares (`error.rs`: `ErrorBody` and its
`HttpError` codes). It fails while the committed file is stale; after changing a wire
type run `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript` and commit the file.
A new type the web uses goes in `declarations()`; the test fails if a message or body
refers to one that is missing. The `/auth/*` bodies (`auth.rs`) have no TypeScript:
Swift mirrors them, and `ErrorBody`, by hand.

`welcome.daemon.completion` reports the startup tier's completion flag,
`watchEnded.reason` includes `limit` for a full control-client cap, and `HttpError`
includes `memory_backed` for tmpfs/ramfs upload refusal. All three are generated to
TypeScript from the Rust protocol types.

Changing a field's meaning, or removing or renaming a field or message, needs a
`PROTOCOL_VERSION` bump; optional fields and new message types don't. The binary frames
are checked against `tests/fixtures/proto/frames.json`, which `web/proto/frames.ts`
can test against too.
