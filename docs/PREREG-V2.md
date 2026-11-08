# Pre-registration v2: the Earth gate with a clocked helping hand (2026-11-08)

Written after the v1 gate failed (5 of 10 seeds, [GATE.md](GATE.md)) and before any v2 training. The commit that adds this file is the timestamp.

## Why a v2
Two of the five v1 failures (seeds 6 and 10) were the **help trap**: the helping hand only fades when the helped brain copes or the bare brain does as well, so a brain that learns to lean on it and stand still freezes it forever (0.387 and 0.531 at gen 1000). Seeds 1 and 2 failed on the threshold flaw that amendment 3 already fixed. Seed 7 never passed the stand stage; v2 doesn't address that.

## The one change
On top of the v1 rule, the help also fades on a clock: `k` generations into a helped stage (shuffle, walk), the assist is capped at `0.9^floor(k / 6)`, and switched off once it drops below 0.05, which happens at k = 174. (`train.mjs --assistPeriod 6`.)

The period was picked from the v1 runs that passed: all of them had reached assist 0 within 140 generations of entering a stage, so the clock should rarely bind on a run that is learning normally and only forces the trapped ones.

Everything else is exactly the v1 recipe as run on seeds 3–10: 64×64 MLP, no CPG, 256 antithetic pairs, σ 0.03 survival-targeted within [0.003, 0.03], lr 0.01, L2 0.005, 16M noise table, pushes on, walk graduation at 0.9 m/s (amendment 3).

## Seeds, budget, gate
- Training seeds **11–20**, runs `V11`…`V20`. None has been run before.
- Budget: 1000 generations per run (amendment 4). A run stops when it graduates walk; its walk graduate is the brain judged.
- The gate is unchanged: `node gate.mjs runs/V11 …`. A brain passes if it stays upright for all 10 s and averages ≥ 0.8 m/s at a 1 m/s target, no pushes, no help, on ≥ 8 of the 10 fixed gate seeds.

## Predictions and what follows
- **Primary:** ≥ 8 of 10 seeds pass. If so, the Moon/Mars experiment in [PREREG.md](PREREG.md) runs with this recipe, unchanged.
- If fewer than 8 pass, it doesn't run, and the repo says so.
- **Secondary:** no v2 run ends its budget in the shuffle or walk stage with assist > 0 (the help trap is gone by construction; this checks the code does what it says).
- Every seed is reported, pass or fail, with its failure mode.
