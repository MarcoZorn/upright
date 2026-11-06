# Amendment 2 to the pre-registration (2026-11-06)

Written before seeds 3 and 4 had passed the walk stage, and before any off-Earth training. [PREREG.md](PREREG.md) and [amendment 1](PREREG-AMENDMENT-1.md) are unchanged.

**Which brain represents a training run at the Earth gate.** A run is judged by its *walk-stage graduate*: the brain that passed the walk stage during training, on training evals only (`brains/index.json`, `stage: walk, graduated: true`). Not the latest brain, and not the best brain on the gate seeds.

**Why.**
- *Not the latest:* later stages (jog, with pushes) can make a run slower at 1 m/s. Run Z2 went from 0.79 to 0.45 m/s over 130 jog generations, so the latest brain depends on when you look.
- *Not the best on the gate seeds:* picking it would be selection on the test set.

`gate.mjs` implements this rule. It also prints the latest brain, for information only.

Z2 continues Z (seed 2) from Z's walk graduate, so seed 2 is represented by that brain, Z gen 559. The gate is the same: 1 m/s target, no pushes, no help, upright for all 10 s, average ≥ 0.8 m/s on ≥ 8 of 10 fresh seeds, and ≥ 8 of 10 training runs passing.

**Disclosure.** I ran `gate.mjs` on runs Y and Z after writing this rule and before committing it. Under the rule:

| run | judged brain | gate | latest brain (information only) |
|---|---|---|---|
| Y | gen 714 walk graduate | **fail**, 5/10 seeds, 0.80 m/s | gen 1969: passes 10/10 at 1.12 m/s |
| Z (seed 2) | gen 559 walk graduate | **fail**, 5/10 seeds, 0.80 m/s | Z2 gen 699: 0/10, 0.49 m/s |

Y's latest brain passes and its graduate doesn't, but I'm keeping the rule as written: changing it after seeing results is the selection it exists to prevent.

The rule has a flaw I didn't anticipate: the walk stage graduates at 0.8 m/s on training evals, the same threshold as the gate, so a graduate sits on the line and passes about half the gate seeds. Under this rule, seeds 1 and 2 currently fail the gate.
