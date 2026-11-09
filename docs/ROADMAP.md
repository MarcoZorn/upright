# Roadmap

**The question:** does a humanoid that learned to walk and run by itself switch gaits at the same Froude number as people, and does it start *skipping* in lunar gravity, like the Apollo astronauts did and as optimal-control models predict (Ackermann & van den Bogert)?

Every result ships with a brain you can replay in your browser, bit-identical to the training run.

## Done
- Deterministic physics and math across JS engines: Rapier's deterministic build, no engine-dependent `Math` on the hot path, V8 = JavaScriptCore checked in `test.mjs`.
- Metric hygiene: a strict fall test, credit for the fall itself taken back, no pushes until a gait exists, σ targeted at keeping 40–80% of the perturbed population upright.
- Gait instruments: duty factor, cadence, flight fraction, Froude number, inter-leg phase, skip rate.
- A CPG arm with learned stride frequency and inter-leg phase, plus the no-CPG 64×64 arm.
- Walking without help, via a helping hand annealed to zero (Yu, Turk & Liu 2018).
- Proof of walk (replay hash checked in the browser), kick-the-robot, ghost siblings.
- [PREREG.md](PREREG.md) and amendments, committed before any off-Earth training.
- **The v1 Earth gate: failed, 5 of 10 seeds** ([GATE.md](GATE.md)). The Moon/Mars experiment was not run.

## Now
1. **v2 Earth gate** ([PREREG-V2.md](PREREG-V2.md)): the same recipe, but the help also fades on a clock. Seeds 11–20 are training. ≥ 8 of 10 pass → the experiment runs; otherwise it doesn't.
2. **Fair fight, part 1:** NEAT on the same curriculum and budget. It needed fixing first (its defaults made it a strawman, see the devlog). A mutation-scale sweep is queued behind v2.

## After (only if v2 passes)
1. **The experiment:** Mars and Moon trained from scratch per the pre-registration. Duty factor vs Froude plot, Muybridge strips, cost-of-transport curves. Controls: friction and leg-length sensitivity.
2. **Fair fight, part 2:** ES-316k vs ES-11k vs linear vs CPG at equal budget, plus a time-to-walk vs parameter-count curve.
3. **Proof of training:** replay the whole training history in three browser engines in CI.

## Either way
- **Writeup.** v1's failure modes (threshold flaw, help trap, stand-still optimum) are a result in themselves, and the pre-registration makes a null result publishable.
