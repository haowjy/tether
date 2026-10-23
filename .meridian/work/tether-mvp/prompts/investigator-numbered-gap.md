# Lost numbered lines on tmux 3.8

On tmux 3.8 (/opt/homebrew/bin/tmux), the real-tmux test that floods numbered lines and checks
each arrives exactly once (`check_numbered_once`, tests/tmux_real.rs near 496) fails often: 4 of 5
uninstrumented runs showed a missing line (L1742→L1744, L1755→L1757, L3204→L3206, L1087→L1089).
With instrumentation of raw control stdout and Event::Output, 9 of 9 runs passed with every line
present and no %pause/%continue or Event::Gap. 3.4 and 3.7b pass. Evidence so far:
.meridian/work/tether-mvp/evidence/tui-snapshot-diagnosis.md ("Separate numbered-line gap"); you have p65's transcript.

Find where the line is lost and whether a user would lose terminal output: tmux itself, tether's
pump/parser/session/hub, or the test's own collection (note the test imports
`mpsc::error::TrySendError`: check whether its collector can drop). A heisenbug that vanishes under
instrumentation suggests timing; use low-overhead capture (e.g. a ring buffer dumped only on
failure, or tee the control-mode byte stream to a file) at each layer boundary. Fix what the
evidence supports and say whether behaviour broke or the test is wrong.

Work in a clean export of HEAD (`git archive HEAD | tar -x -C /tmp/<your-spawn-id>`); the primary
checkout has other agents mid-edit and must not be touched. Real tmux only through the tests'
private -L sockets; never the default server or Jimmy's sessions. TMPDIR=/tmp/tether-meridian-501.
Deliver a fix as .meridian/work/tether-mvp/evidence/numbered-gap-fix.patch against HEAD (tests/ and src/tmux|hub|session
paths only), verified by repeated runs on 3.8 (and a regression pass on 3.4/3.7b if you can build
them; p65 built them from release tarballs, see its transcript). Findings go in
.meridian/work/tether-mvp/evidence/numbered-gap-diagnosis.md. Delete your /tmp exports when done.
