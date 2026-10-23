# Meridian context in this repository

`meridian.toml` resolves these paths relative to the checkout:

- `.meridian/work/`: active work plans, handoffs, review summaries.
- `.meridian/archive/work/`: completed work artifacts.
- `.meridian/kb/`: durable cross-cutting knowledge.

`source = "local"` means use these filesystem directories, not clone another context
repository. Git in this repository carries their committed content to other machines;
it does not automatically commit new notes. Product design stays in
[`docs/design/client/README.md`](../docs/design/client/README.md).

## Another machine

Pull the repository and start Meridian from its root. `meridian context --verbose`
should resolve work and KB inside that checkout. To attach to the existing work notes:

```sh
meridian work start tether-mvp
meridian work current
```

Machine-local work status (`__status.json`, including absolute task paths) is ignored.
Creating/attaching the work item establishes local runtime metadata; Git does not
transfer chat IDs, running spawns, transcripts, process state or credentials.

Already-running sessions can retain launch-bound context environment variables.
Restart Meridian after changing context paths; check live resolution rather than
assuming an existing shell's `$MERIDIAN_ACTIVE_WORK_DIR` has changed.

## Migration scope

The knowledge base and a current implementation checkpoint are carried here. Earlier
Linux scratch, raw probe output and session artifacts were deliberately not bulk
imported: some operational notes contain credentials and absolute machine paths.
The original local context was preserved, including assets used by running previews.
Required design, research and mockups are already tracked under `docs/design/client/`;
the checkpoint links there, so Mac work does not depend on the old scratch directory.
