# Client implementation execution

## Goal and constraints

Implement the approved desktop browser, phone browser/PWA, and native iPhone client. Tailscale only; no release, public exposure, or input to personal tmux sessions. Work directly on main, with reviewed coherent commits. Preserve current authentication until its replacement is specified and security-reviewed.

## Dependency plan

1. In parallel, audit the existing implementation/spec gaps and build/run the existing keyboard spike on this Mac and connected physical iPhone. Read approved mockups and contracts before design changes.
2. Combine evidence into settled authentication/static-serving and browser/native platform contracts. Review design/security before dependent source edits. Native keyboard decisions require real-device evidence.
3. Implement enabling protocol/copy changes, browser platform and bounded serving/auth, then approved browser/PWA layouts and native shell against the settled interfaces. Shared source has one writer; no worktrees per repository policy.
4. Independently review each subsystem and probe isolated tmux 3.4/3.7b and real device keyboard, selection, clipboard, local drafts, lifecycle/reconnect. Fix findings before dependent phases.
5. Full preflight, documentation/changelog and knowledge capture, coherent main commits; no release.

## Current evidence

Initial checkout is clean. Xcode selected at /Applications/Xcode.app/Contents/Developer; xcodegen installed. devicectl reports a physical iPhone 17 Pro connected. No spike build or device behavior verified yet.

## Current phase

Phase 1: implementation audit and keyboard-spike baseline. Authentication and platform decisions remain open. Hardware gesture checks must be observed, not inferred from compilation or simulator results.

Pre-dev: primary checkout is clean apart from this work's notes; repository policy requires main, no PR/worktree. No parallel source writers. First unsigned iphoneos build using Xcode 27.1 fails at TerminalInputView.swift:163: paste(itemProviders:) requires override. Narrow SDK conformance correction; no architecture/auth changes. Signing identity exists. Raw build log: /tmp/tether-keyboard-build.log. Explorer launch p3 failed before work due to macOS Unix-socket path length; TMPDIR=/tmp/tether-meridian-501 cleared the cause for p4, whose audit completed.
