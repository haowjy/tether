# tether setup: design evidence (2026-10-24)

Spec: `docs/design/setup.md`; decisions: `docs/design/decisions.md` "## tether setup".

- **Unix local-admin guard version.** `grep -c IsServingUnixAny ipn/localapi/serve.go` at tags:
  v1.96.0 0, v1.98.0 0, v1.100.0 1, v1.102.0 1, v1.104.0 1. So 1.100.0 is the first release
  where an operator writing a `unix:` target must pass `sudo --other-user=<u> --list tailscale` (401 otherwise).
- **Prefs readable without write.** v1.94.0 `servePrefs` GET checks only `PermitRead`, so setup can read
  `OperatorUser` before any grant.
- **Status fields on the Mac (1.104.2):** `Version` "1.104.2-tc3430f0d2-g598b63867", `BackendState` "Running",
  `CertDomains` ["jimmys-macbook-air.tail852a76.ts.net"].
- **QR crate cost.** `qrcode` 0.14.1, `default-features = false`, zero transitive deps, MSRV 1.67.1,
  MIT/Apache-2.0. Stripped release, macOS arm64: 387,456 B with a Dense1x2 render vs 336,768 B baseline (+~50 KB).
  A 35-char ts.net URL renders 37x19 cells.
- **Not probed:** pop-os (`ssh pop-os` fails host-key verification; Jimmy must accept it once). All Linux
  behaviour is from source and docs; gates S1–S8 in setup.md are the real-system checks.
