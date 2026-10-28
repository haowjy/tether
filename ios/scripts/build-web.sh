#!/usr/bin/env bash
set -euo pipefail

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$IOS_DIR/.." && pwd)"

if [[ -n "${HOME:-}" ]]; then
  nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  nvm_node_bin=""
  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    export NVM_DIR="$nvm_dir"
    # Let nvm resolve default aliases such as `22` and `lts/*`, not only v-prefixed versions.
    . "$NVM_DIR/nvm.sh"
    if nvm use --silent default >/dev/null 2>&1; then nvm_node_bin="$NVM_BIN"; fi
  fi
  fallback_path="$PATH"
  PATH="$HOME/Library/pnpm:$HOME/.local/share/pnpm"
  if [[ -n "$nvm_node_bin" ]]; then PATH="$PATH:$nvm_node_bin"; fi
  PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$fallback_path"
  export PATH
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to build the bundled web UI; install it or add its location to PATH" >&2
  exit 1
fi

pnpm --dir "$REPO_DIR/web" run build

destination="${TARGET_BUILD_DIR:?Xcode must set TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH:?Xcode must set UNLOCALIZED_RESOURCES_FOLDER_PATH}/WebUI"
# ditto merges into what is there: without the rm, every earlier build's hashed assets stay
# in the app.
rm -rf "$destination"
mkdir -p "$destination"
ditto "$REPO_DIR/web/dist" "$destination"
