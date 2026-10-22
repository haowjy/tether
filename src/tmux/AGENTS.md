# tmux core

Keep this module pure: no process, filesystem, or shared-state access. Parse tmux's
byte stream into events, then correlate reply blocks by FIFO order. Unknown protocol
lines remain non-fatal. Never log raw pane output or reply bodies.
