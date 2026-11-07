# Amendment 4 to the pre-registration (2026-11-07)

**Training budget per run.** [PREREG.md](PREREG.md) says "the same budget" but never gave a number. It is now **1000 generations** (256 antithetic pairs each, about 520k episodes). A run that hasn't passed the walk stage by generation 1000 fails the Earth gate.

**When.** Written before any of seeds 5–7 had passed or failed. At that point:
- seed 5 was in the walk stage at gen 391
- seed 6 was in the shuffle stage at gen 273
- seed 7 was in the stand stage at gen 184

The passing runs graduated walk at gen 335 (seed 4) and gen 459 (seed 3). Seed 1's (Y) gen 714 includes 310 gens without help, and it fails the gate anyway.

The gate itself and the 8-of-10 requirement are unchanged.
