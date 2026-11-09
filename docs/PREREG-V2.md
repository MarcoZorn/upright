# Pre-registration v2: the Earth gate with a clocked helping hand (2026-11-08)

Written after the v1 gate failed (5 of 10 seeds, [GATE.md](GATE.md)) and before any v2 training. The commit that adds this file is the timestamp.

## Why a v2
Two of the five v1 failures (seeds 6 and 10) were the **help trap**: the helping hand only fades when the helped brain copes or the bare brain does as well, so a brain that learns to lean on it and stand still freezes it forever (0.387 and 0.531 at gen 1000). Seeds 1 and 2 failed on the threshold flaw that amendment 3 already fixed. Seed 7 never passed the stand stage; v2 doesn't address that.

## The one change
On top of the v1 rule, the help also fades on a clock: `k` generations into a helped stage (shuffle, walk), the assist is capped at `0.9^floor(k / 6)`, and switched off once it drops below 0.05, which happens at k = 174. (`train.mjs --assistPeriod 6`.)

The period was picked from the v1 runs that passed: all of them had reached assist 0 within 140 generations of entering a stage, so the clock should rarely bind on a run that is learning normally and only forces the trapped ones.

Everything else is exactly the v1 recipe as run on seeds 3–10: 64×64 MLP, no CPG, 256 antithetic pairs, σ starting at 0.01 and survival-targeted within [0.003, 0.03] after the stand stage, lr 0.01, L2 0.005, 16M noise table, pushes on, walk graduation at 0.9 m/s (amendment 3).

## Seeds, budget, gate
- Training seeds **11–20**, runs `V11`…`V20`. None has been run before.
- Budget: 1000 generations per run (amendment 4). A run stops when it graduates walk; its walk graduate is the brain judged.
- The gate is unchanged: `node gate.mjs runs/V11 …`. A brain passes if it stays upright for all 10 s and averages ≥ 0.8 m/s at a 1 m/s target, no pushes, no help, on ≥ 8 of the 10 fixed gate seeds.

## Predictions and what follows
- **Primary:** ≥ 8 of 10 seeds pass. If so, the Moon/Mars experiment in [PREREG.md](PREREG.md) runs with this recipe, unchanged.
- If fewer than 8 pass, it doesn't run, and the repo says so.
- **Secondary:** no v2 run ends its budget in the shuffle or walk stage with assist > 0 (the help trap is gone by construction; this checks the code does what it says).
- Every seed is reported, pass or fail, with its failure mode.

## Correction (same day, before any result)
The first launch used a starting σ of 0.03 instead of v1's 0.01 (the line above originally said "σ 0.03"). It was stopped about 10 generations into the stand stage, the runs were deleted, and all ten seeds restarted with 0.01. Nothing beyond those first log lines had been seen.

## Deviation (2026-11-09): two generations with reset settings after a reboot
The machine restarted while V11–V13 were in shuffle/walk (gens ~144–158). `tools/v2.sh` restarted them with the full recipe flags, and command-line flags override a run's saved state, so for **two generations per run** σ went back to its starting 0.01 (it had adapted to 0.03) and the helping hand to 1.0 (capped by the clock: 0.73 for V12, 0.10–0.12 for V11 and V13):
- V11: gens 156–157
- V12: gens 158–159
- V13: gens 144–145

Those generations' updates are kept (there is no way to undo them short of restarting the runs). The saved σ and help were set back to their pre-reboot values, and `v2.sh` now passes recipe flags only on a fresh start. This happened before any of these runs graduated walk. Two generations of extra help are well inside what the clock allows anyway, so I don't expect it to matter, but it is recorded here so it can be checked.
