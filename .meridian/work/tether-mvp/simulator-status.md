# Simulator status — 2026-10-22

Device: `tether-keyboard-p6` (58631B31-3F9C-4562-AD4B-5C1404E9EB40, iOS 26.3.1).

- **Launch:** pass. Installed and launched; PID 91561 remained running after 8 seconds (`launchctl procinfo`: running, no exit). Screenshot: `evidence/keyboard-p6-running.png`. It starts hidden (`fr:term`, `mode:hidden`, `kb:hw`).
- **S1–S14, T1–T8, F1–F2, H1–H9, M1–M4, B1–B3:** not run. Simulator.app is not installed with this Xcode, and `simctl io` has no touch/keyboard input operation; could not focus the terminal or show the software keyboard. Accessory rendering and key response remain unchecked.
- **Needs real device:** real keyboard dismissal behavior, Face ID (B1–B3), and haptic/tactile feel (F1).

No physical iPhone was touched.
