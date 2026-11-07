# Earth gate tally

The gate ([PREREG.md](PREREG.md), amendments [2](PREREG-AMENDMENT-2.md) and [3](PREREG-AMENDMENT-3.md)): each training seed is judged by its walk-stage graduate. That brain must walk at a 1 m/s target, with no pushes and no help, upright for all 10 s and averaging ≥ 0.8 m/s, on ≥ 8 of 10 fresh seeds. The Moon and Mars experiment runs only if ≥ 8 of 10 training seeds pass. A run that hasn't passed the walk stage by generation 1000 fails ([amendment 4](PREREG-AMENDMENT-4.md)). Reproduce with `node gate.mjs runs/<run>`.

| seed | run | walk graduate | result | gate seeds | mean speed |
|---|---|---|---|---|---|
| 1 | Y | gen 714 | fail | 5/10 | 0.80 |
| 2 | Z | gen 559 | fail | 5/10 | 0.80 |
| 3 | S3 | gen 459 | **pass** | 10/10 | 0.90 |
| 4 | S4 | gen 335 | **pass** | 10/10 | 0.90 |
| 5 | S5 | gen 746 | **pass** | 10/10 | 0.89 |
| 6 | S6 | none: help trap, still in shuffle at gen 1000 (see devlog) | fail (budget) | 0/10 | 0.00 |
| 7 | S7 | none: still in the stand stage at gen 1000 | fail (budget) | 0/10 | -0.01 |
| 8 | S8 | (training) | | | |
| 9 | S9 | (training) | | | |
| 10 | S10 | (training) | | | |

**Status (2026-11-07): 3 pass, 4 fail. The gate cannot be met: at most 7 of 10 seeds can pass. Under the pre-registered kill criterion, the Moon/Mars experiment does not run with this training recipe.** The remaining seeds are being finished anyway, to measure how often the recipe produces a walker.
Seeds 1 and 2 graduated under the old 0.8 m/s walk threshold (see amendment 3); seeds 3 and 4 under 0.9.
