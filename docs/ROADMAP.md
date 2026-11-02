# Roadmap

**The question:** does a humanoid that learned to walk and run by itself switch gaits at the same Froude number as people, and does it start *skipping* in lunar gravity, like the Apollo astronauts did and as optimal-control models predict (Ackermann & van den Bogert)?

Every result ships with a brain you can replay in your browser, bit-identical to the training run.

## Tonight
1. ~~Deterministic physics and math across JS engines~~ (done: Rapier deterministic build, no engine-dependent `Math` on the hot path, V8 = JavaScriptCore checked in `test.mjs`).
2. Metric hygiene: a stricter fall test, no pushes until a gait exists, σ adjusted to keep 30–70% of the perturbed population alive.
3. Gait instruments: duty factor, stride frequency, flight fraction, Froude number, inter-leg phase, skip flag.
4. CPG backbone + residual MLP. Leg phase offset and stride frequency are *learned*, so skipping isn't ruled out by construction. A no-CPG 64×64 control arm trains alongside it.
5. Walk at 1 m/s on Earth, then roll the best brain on Mars and the Moon as a smoke test (not a result).
6. `docs/PREREG.md`: hypotheses and kill criteria, committed before any off-Earth training.

## After
1. **Earn the run:** a speed-conditioned walk→run policy, 5 seeds, confidence intervals. Proof-of-walk badge and kick-the-robot in the viewer.
2. **The experiment:** Mars and Moon trained from scratch per the pre-registration. Duty factor vs Froude plot, Muybridge strips, cost-of-transport curves. Controls: friction and leg-length sensitivity.
3. **Fair fight:** ES-316k vs ES-11k vs linear vs CPG vs NEAT at equal budget, plus a time-to-walk vs parameter-count curve.
4. **Ghost siblings:** every ES perturbation of a generation, walking as translucent ghosts in the browser, coloured by rank.
5. **Proof of training:** replay the whole training history in three browser engines in CI.
6. **Writeup:** positive or negative; the pre-registration makes a null result publishable.
