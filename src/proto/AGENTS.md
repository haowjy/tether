# proto

The wire protocol, defined once: serde types for the JSON messages, the binary frame
codec, the version range and close codes. A leaf module: it names no other tether
module, so `http/` and `hub/` both use it.

`web/proto/generated/messages.ts` is rendered from these types (ts-rs) by the test in
`typescript.rs`, which fails while the committed file is stale; after changing a message
type run `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript` and commit the file.
A new type the web uses goes in `declarations()`; the test fails if a message refers to
one that is missing.

Changing a field's meaning, or removing or renaming a field or message, needs a
`PROTOCOL_VERSION` bump; optional fields and new message types don't. The binary frames
are checked against `tests/fixtures/proto/frames.json`, which `web/proto/frames.ts`
can test against too.
