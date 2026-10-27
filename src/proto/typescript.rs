//! Renders the protocol's TypeScript types into `web/proto/generated/messages.ts`
//! (daemon-core.md §5.5): the WebSocket messages, the `/fs/*` and `/complete` bodies,
//! and the error body every route shares. The test fails while the committed file is stale;
//! `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript` rewrites it.

use std::any::TypeId;
use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::Path;

use ts_rs::{Config, TS, TypeVisitor};

use super::complete::{Chip, ChipSource, CompleteRequest, Completion};
use super::fs::{Entry, EntryKind, Listing, PathBody, RootStatus, Roots, Uploaded};
use super::*;

const PATH: &str = "web/proto/generated/messages.ts";

/// Every type the web reads or writes, dependencies included, in file order.
fn declarations(config: &Config) -> Vec<(TypeId, String)> {
    fn declare<T: TS + 'static>(config: &Config) -> (TypeId, String) {
        let docs = T::docs().unwrap_or_default();
        // One message type per line.
        let decl = T::decl(config).replace(" | { \"type\": ", "\n  | { \"type\": ");
        (TypeId::of::<T>(), format!("{docs}export {decl}\n"))
    }
    vec![
        declare::<ClientMsg>(config),
        declare::<ServerMsg>(config),
        declare::<WindowRef>(config),
        declare::<SessionRef>(config),
        declare::<ShownWindow>(config),
        declare::<Size>(config),
        declare::<Base64>(config),
        declare::<ClientInfo>(config),
        declare::<ClientKind>(config),
        declare::<InputItem>(config),
        declare::<DaemonInfo>(config),
        declare::<HostInfo>(config),
        declare::<WatchEndReason>(config),
        declare::<TmuxListing>(config),
        declare::<SessionListing>(config),
        declare::<BellState>(config),
        declare::<BellChange>(config),
        declare::<WindowListing>(config),
        declare::<ErrorCode>(config),
        declare::<ErrorNode>(config),
        declare::<ErrorBody>(config),
        declare::<HttpError>(config),
        declare::<Roots>(config),
        declare::<RootStatus>(config),
        declare::<PathBody>(config),
        declare::<Listing>(config),
        declare::<Entry>(config),
        declare::<EntryKind>(config),
        declare::<Uploaded>(config),
        declare::<CompleteRequest>(config),
        declare::<Completion>(config),
        declare::<Chip>(config),
        declare::<ChipSource>(config),
    ]
}

fn render() -> (String, BTreeSet<TypeId>) {
    // Every integer on the wire fits a JavaScript number.
    let config = Config::new().with_large_int("number");
    let mut out = String::from(
        "// Generated from src/proto by `UPDATE_PROTO_TYPES=1 cargo test --lib \
         proto::typescript`. Do not edit.\n\n",
    );
    let _ = writeln!(
        out,
        "/** The protocol this build speaks (daemon-core.md §5.2). */\nexport const \
         PROTOCOL_VERSION = {PROTOCOL_VERSION};\n"
    );
    out.push_str(
        "/** WebSocket close codes (daemon-core.md §5.2). */\nexport const CloseCode = {\n",
    );
    for code in CloseCode::ALL {
        let _ = writeln!(out, "  {code:?}: {},", code.code());
    }
    out.push_str("} as const;\n");
    let mut declared = BTreeSet::new();
    for (id, declaration) in declarations(&config) {
        declared.insert(id);
        out.push('\n');
        out.push_str(&declaration);
    }
    // ts-rs leaves a space before each field's doc comment.
    let out = out
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    (out, declared)
}

/// The types `T` refers to, transitively.
fn dependencies<T: TS + 'static>(found: &mut BTreeSet<TypeId>) {
    struct Visit<'a>(&'a mut BTreeSet<TypeId>);
    impl TypeVisitor for Visit<'_> {
        fn visit<U: TS + 'static + ?Sized>(&mut self) {
            if U::output_path().is_some() && self.0.insert(TypeId::of::<U>()) {
                U::visit_dependencies(self);
            }
        }
    }
    T::visit_dependencies(&mut Visit(found));
}

#[test]
fn generated_typescript_is_current() {
    let (rendered, declared) = render();
    let mut needed = BTreeSet::new();
    dependencies::<ClientMsg>(&mut needed);
    dependencies::<ServerMsg>(&mut needed);
    dependencies::<Roots>(&mut needed);
    dependencies::<Listing>(&mut needed);
    dependencies::<CompleteRequest>(&mut needed);
    dependencies::<Completion>(&mut needed);
    dependencies::<ErrorBody>(&mut needed);
    let missing = needed.difference(&declared).count();
    assert_eq!(missing, 0, "a protocol type is missing from declarations()");

    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(PATH);
    if std::env::var_os("UPDATE_PROTO_TYPES").is_some_and(|value| value == "1") {
        std::fs::create_dir_all(path.parent().expect("a parent directory"))
            .expect("create the generated directory");
        std::fs::write(&path, &rendered).expect("write the generated types");
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == rendered,
        "{PATH} is stale: run `UPDATE_PROTO_TYPES=1 cargo test --lib proto::typescript`"
    );
}
