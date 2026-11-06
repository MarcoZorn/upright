# Earth gate tally

The gate ([PREREG.md](PREREG.md), amendments [2](PREREG-AMENDMENT-2.md) and [3](PREREG-AMENDMENT-3.md)): each training seed is judged by its walk-stage graduate. That brain must walk at a 1 m/s target, with no pushes and no help, upright for all 10 s and averaging ≥ 0.8 m/s, on ≥ 8 of 10 fresh seeds. The Moon and Mars experiment runs only if ≥ 8 of 10 training seeds pass. Reproduce with `node gate.mjs runs/<run>`.

| seed | run | walk graduate | result | gate seeds | mean speed |
|---|---|---|---|---|---|
| 1 | Y | gen 714 | fail | 5/10 | 0.80 |
| 2 | Z | gen 559 | fail | 5/10 | 0.80 |
| 3 | S3 | gen 459 | **pass** | 10/10 | 0.90 |
| 4 | S4 | gen 335 | **pass** | 10/10 | 0.90 |
| 5 | S5 | (training) | | | |
| 6 | S6 | (training) | | | |
| 7 | S7 | (training) | | | |
| 8–10 | | not started | | | |

**Status: 2 pass, 2 fail, 6 to go. The experiment still needs every remaining run to pass.**
Seeds 1 and 2 graduated under the old 0.8 m/s walk threshold (see amendment 3); seeds 3 and 4 under 0.9.
