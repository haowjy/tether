#!/usr/bin/env bash
set -euo pipefail

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DERIVED_DATA="${TETHER_IOS_DERIVED_DATA:-${TMPDIR:-/tmp}/tether-ios-derived-data}"
DESTINATION="${TETHER_IOS_DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro,OS=26.3.1}"

cd "$IOS_DIR"
xcodegen generate --spec project.yml

cd "$IOS_DIR/TetherKit"
swift test

cd "$IOS_DIR"
xcodebuild \
  -project Tether.xcodeproj \
  -scheme Tether \
  -destination "$DESTINATION" \
  -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO \
  build
