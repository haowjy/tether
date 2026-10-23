#!/usr/bin/env bash
# Shared gate for CI, the pre-push hook, and release workflows.
#
#   preflight.sh [fast|full] [--commit <sha>]
#
# With --commit, the gate runs on a clean export of exactly that commit (`git archive`), so
# another lane's uncommitted file can neither rescue a commit that depends on it nor block
# one that doesn't. The export installs the web dependencies from its lockfile and builds in
# its own target directory (target/preflight/), so it
# neither rebuilds nor blocks the checkout's builds. Set TETHER_PREFLIGHT_E2E=1 to add
# the Playwright suite to `full`.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE=full
COMMIT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    fast|full) MODE="$1" ;;
    --commit)
      COMMIT="${2:?--commit needs a sha}"
      shift
      ;;
    *)
      printf 'Usage: preflight.sh [fast|full] [--commit <sha>]\n' >&2
      exit 1
      ;;
  esac
  shift
done

run_step() {
  printf 'preflight: %s\n' "$*" >&2
  "$@"
}

if [[ -n "$COMMIT" ]]; then
  SHA="$(git -C "$ROOT_DIR" rev-parse --verify "${COMMIT}^{commit}")"
  # One fixed export path with its own Cargo target directory. Tests read fixtures through
  # env!("CARGO_MANIFEST_DIR"), baked in at compile time, so a stable path keeps the build
  # incremental (dependencies build once, only the tether crate rebuilds for a new export)
  # without cleaning or disturbing the checkout's own target directory. Cargo judges
  # freshness by mtime, so the export is extracted with fresh mtimes (tar -m): archive
  # mtimes are commit times, older than the last build, and would pass off the previous
  # export's build (and build.rs output) as this commit's.
  PREFLIGHT_DIR="${TETHER_PREFLIGHT_DIR:-$ROOT_DIR/target/preflight}"
  EXPORT_DIR="$PREFLIGHT_DIR/export"
  LOCK_DIR="$PREFLIGHT_DIR/lock"
  mkdir -p "$PREFLIGHT_DIR"
  # The fixed path is shared, so one preflight runs at a time; a lock left by a dead one is stale.
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    holder="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ -z "$holder" ]] || ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$LOCK_DIR"
    else
      printf 'preflight: another preflight is running (pid %s)\n' "$holder" >&2
      exit 1
    fi
  done
  echo $$ > "$LOCK_DIR/pid"
  trap 'rm -rf "$EXPORT_DIR" "$LOCK_DIR"' EXIT
  rm -rf "$EXPORT_DIR"
  mkdir -p "$EXPORT_DIR"
  printf 'preflight: exporting %s to %s\n' "$SHA" "$EXPORT_DIR" >&2
  git -C "$ROOT_DIR" archive "$SHA" | tar -x -m -C "$EXPORT_DIR"
  export CARGO_TARGET_DIR="$PREFLIGHT_DIR/target"
  TETHER_PREFLIGHT_EXPORT=1 "$EXPORT_DIR/scripts/preflight.sh" "$MODE"
  exit $?
fi

cd "$ROOT_DIR"
case "$MODE" in
  fast)
    run_step cargo fmt --check
    ;;
  full)
    # build.rs builds the web shell during cargo checks and builds.
    if [[ -n "${TETHER_PREFLIGHT_EXPORT:-}" ]]; then
      if ! run_step pnpm --dir web install --frozen-lockfile --offline; then
        run_step pnpm --dir web install --frozen-lockfile
      fi
    elif [[ ! web/node_modules/.pnpm/lock.yaml -nt web/pnpm-lock.yaml ]]; then
      # Install only when the lockfile is newer than the installed pnpm lock snapshot.
      run_step pnpm --dir web install --frozen-lockfile
    fi
    run_step cargo fmt --check
    run_step cargo clippy --all-targets --locked -- -D warnings
    # Also fails while web/proto/generated/ is stale (src/proto/typescript.rs).
    run_step cargo test --locked
    run_step cargo build --release --locked
    run_step pnpm --dir web run check
    if [[ -n "${TETHER_PREFLIGHT_E2E:-}" ]]; then
      run_step pnpm --dir web run e2e
    fi
    ;;
esac
