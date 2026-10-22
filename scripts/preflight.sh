#!/usr/bin/env bash
# Shared gate for CI, the pre-push hook, and release workflows.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-full}"

run_step() {
  printf 'preflight: %s\n' "$*" >&2
  "$@"
}

cd "$ROOT_DIR"
case "$MODE" in
  fast)
    run_step cargo fmt --check
    ;;
  full)
    run_step cargo fmt --check
    run_step cargo clippy --all-targets --locked -- -D warnings
    run_step cargo test --locked
    run_step cargo build --release --locked
    ;;
  *)
    printf 'Usage: preflight.sh [fast|full]\n' >&2
    exit 1
    ;;
esac
