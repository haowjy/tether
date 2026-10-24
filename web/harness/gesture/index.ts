// No fixtures: a gesture needs real touch input and a daemon that answers `watch`, history and
// mouse modes, which the harness's fake does not. `e2e/gesture/` drives them against a real
// daemon on a private tmux instead.
import type { Fixtures } from "../fixture";

export const fixtures: Fixtures = {};
