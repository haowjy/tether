# Third and final review of tether's browser auth draft

You reviewed `.meridian/work/tether-mvp/design/browser-auth.md` twice (`design/browser-auth-review-1.md`, `design/browser-auth-review-2.md`). Revision 3 claims to fix N1–N10; see its "Review disposition" table. D5 is now settled by the project owner: refreshing the serve config on the 10 s re-check is allowed, because it sends nothing over the network and does no idle work (see the latest `docs/design/decisions.md` entry and the "Principles" section of `AGENTS.md`).

This is the last round before Jimmy decides. Check that:
1. Each N finding is genuinely resolved.
2. The new limits design holds its bounds and is the simplest that does. It has per-route caps that refuse at once, a 64-connection backstop, an owned accept loop with 16 KiB buffers, a 100 s idle timeout, a gzipped embedded shell, and the memory accounting rule with G12's pass rule. Verify the claims against hyper, hyper-util and axum source where they matter.
3. The D2 analysis (sibling definition, per-option residuals and costs, spikes over plain HTTP) is honest and accurate.
4. D6's numbers are right.

Report only blockers and high or medium issues, each with a scenario and a fix, then a verdict: ready for Jimmy's decision, or not. Low items go in one short list at the end. Edit nothing.
