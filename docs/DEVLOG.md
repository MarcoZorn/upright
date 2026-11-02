# Devlog

## 2026-11-02: a body that stands

**Body.** 15 rigid parts (pelvis, torso, head, thighs, shins, feet, upper and lower arms, hands), about 71 kg and 1.74 m tall. There are 14 joints with 30 motorised degrees of freedom:

- ankles 2 each
- knees 1 each
- hips 3 each
- waist 3
- neck 3
- shoulders 3 each
- elbows 1 each
- wrists 2 each

Every joint is a Rapier generic joint with only its real axes free, and each free axis gets a limit and a force-based position motor. Rapier's JS wrapper only exposes per-axis limits and motors on revolute and spherical joints, so I call the raw joint set (`world.impulseJoints.raw.jointSetLimits(handle, axis, …)`) directly. Self-collision is on except between jointed pairs.

**Brain.** MLP 73 → 512 → 512 → 30, tanh, 315,934 parameters. Output 0 maps to the rest pose and ±1 to the joint limits. The "zero brain" therefore means "hold the standing pose", which is a free sanity check for the physics.

**The bug of the day: the statue that wouldn't stand.** With all motors holding the rest pose, the body toppled after 1.4 s. Stiffer motors made it fall *faster*. Isolating it:

- every joint locked: stands forever
- only the ankles free: falls at 1.4 s whatever the stiffness
- ankle stiffness 0: stands *longer* (2.8 s) than with a stiff ankle
- the same 2-axis joint in isolation: tracks targets exactly, so the motor semantics were fine

The cause is solver convergence. The ankle motor pushes a 1.2 kg foot that is pinned to the ground under 68 kg of body. With Rapier's default 4 PGS iterations, the motor and the foot contacts never agree within a step, so energy leaks in and the ankle swings ±0.3 rad until the body goes over. Raising the iteration count alone fixes the statue (50 iterations: ankle sway < 0.03 rad). The final settings:

- 16 solver iterations
- 2.5 kg feet (heavy for a human, but it tames the mass ratio)
- ankle stiffness 1000 N·m/rad, capped at 300 N·m
- motor damping at 5% of stiffness (10% was worse)

The zero brain now stands 60 s+ with < 1 cm of drift. Cost: about 250 ms per 10 s episode, about 40× real time per core.

**Determinism.** Each run gets a trajectory hash (FNV over the float32 bits of every part's pose at every brain step). The checks:

- same brain twice: identical
- same brain in a worker thread: identical
- a brain saved to JSON and loaded back: identical
- the browser (Rapier WASM via CDN, Chrome) reproduces Node's zero-brain hash `b3c4fa14` exactly

Caveat: brain forward passes use `Math.tanh`, which isn't guaranteed bit-identical across JS engines. Node and Chrome share V8; Firefox might drift on a trained brain. If that matters, a hand-written tanh fixes it.

**Random brains** flail and fall within about 1.5 s. Good: the task isn't trivial.

Next: the training code, after the plan in [PLAN.md](PLAN.md) is agreed.

## 2026-11-02 (evening): training loop in, walking not yet

- **Built:** ES (shared noise table, antithetic pairs, centered ranks, Adam), the stand/walk/run task with seeded pushes, a worker pool with checkpoint/resume, the NEAT baseline (my neat-from-scratch engine, vendored) and the ES-vs-NEAT plot. Training is capped at 70% of the CPUs and runs at nice 19.
- **Senses:** torso-frame linear velocity added (vestibular, not global position).
- **Tanh:** brains now use the Padé tanh from neat-from-scratch, so a trained brain replays bit-identically in every JS engine.
- **Hyperparameters:** a sweep on the stand stage picked σ = 0.005 and lr = 0.001. σ = 0.02 or lr = 0.01 wreck the zero-init brain within a few generations.
- **Stand:** graduated at gen 2. The zero-init output layer means generation 0 already holds the rest pose.
- **Walk, gens 3–24:** stuck at the local optimum of standing still. Speed is 0.00 at targets 0, 1 and 3 alike. Population fitness climbs towards the centre brain's (170 → 385), so ES is making the brain *insensitive to noise* rather than finding a gait.

Next things to try:
1. Larger σ in the walk stage, for more exploration.
2. A phase clock input (sin/cos of time). It's the standard trick for gaits with a memoryless MLP.
3. A reward that pays for forward lean and stepping before it pays for speed.
4. A larger population.

## 2026-11-02 (night): why it dives, determinism for real, a rhythm to explore with

**Why every walk attempt turned into a dive.** Three sweeps (σ 0.005–0.02, alive bonus 0.5–1, push scale 0.3–1, with a 1 s clock input) all ended the same way: lunge forward, fall at about 1.8 s, eval fitness dropping from 440 (standing) to 30–80. The arithmetic behind it:
- The output layer starts at zero, so early on the noise on each joint target is about σ·√(hidden·E[h²]), roughly 11σ for 512 hidden units.
- At σ = 0.02 that's about 23% of every joint's range, on all 30 joints at once. Practically every perturbed sibling falls.
- ES then ranks fallers against fallers, and the one that falls *forward* fastest wins.
- At σ = 0.005 the siblings survive, but random static offsets on 30 joints are never a footstep, so nothing pulls towards walking.

**Metric hygiene.**
- `speed` used to be `pelvis z / upTime`, which counts the topple itself. A brain that just tips forward used to read as 0.4–0.6 m/s; it now reads −0.02.
- On a fall, the last second of speed credit and distance are taken back.
- The fall test is stricter: head below 1.3 m or torso past 45°. It used to be head below 1.0 m.

**Curriculum.**
- The speed ramp is now stand → shuffle 0.4 → walk 1 → jog 2 → run 3 m/s.
- There are no pushes until it walks.
- A stage only graduates when the *perturbed population* also survives (≥ 80% in stand). The old stand stage graduated at gen 2 by luck; the brain didn't really balance, so every exploration around it toppled.
- With the strict gate, a 64×64 net passes stand with 95% of its siblings upright. A 512×512 net still hadn't passed at gen 26.

**Determinism, for real this time.** The "same bits in every JS engine" claim wasn't true. The npm `rapier3d-compat` build only promises determinism on one machine, and `Math.sin`, `asin`, `log` and `**` were on the hot path; Node and Chrome only agreed because both are V8. Now:
- Rapier's deterministic build (aliased in `package.json`, and the browser import map points at it). It is about 7% slower.
- A polynomial sine (only `+` and `*`, error < 1e-6).
- The raw half-angle term instead of `asin`.
- A rejection-sampled push direction.
- An Irwin-Hall noise table instead of Box-Muller.
- Running products for Adam's bias correction.

`test.mjs` now runs the same random 316k-param brain with pushes under Bun (JavaScriptCore). Its trajectory hash and fitness match V8 exactly.

**Structured exploration.** `src/cpg.js` adds a central pattern generator: per joint, offset + A·sin(phase + φ). The right leg mirrors the left. Stride **frequency and inter-leg phase are learned**, starting at 1 Hz and π (an alternating walk), so a skip or a faster cadence isn't ruled out by construction. That matters for the Moon question in [ROADMAP.md](ROADMAP.md). A residual MLP, starting at zero, adds corrections on top. `src/gait.js` measures duty factor, flight fraction, cadence, inter-leg phase, skip rate and Froude number from foot contacts. σ now adapts to keep 40–80% of the perturbed siblings upright.

Running now, side by side, about 11 workers each:
- **A:** the CPG alone, MLP frozen.
- **B:** a plain 64×64 MLP, the no-CPG control arm.

### What didn't work tonight (so I don't repeat it)
All runs used 64×64 nets, 7–11 workers each and honest metrics.

| run | setup | result |
|---|---|---|
| cpgA | CPG only (MLP frozen), alive 1, σ_cpg 0.03, adaptive σ, shuffle stage | 200 gens standing still: amplitudes stayed ≈ 0, 0 footsteps |
| mlpB | plain MLP, same reward | passed stand at ~gen 130 (strict gate); then 60 gens standing still in shuffle |
| cpgA/mlpB + `--alive 0` | resumed without the alive bonus | both dive again within 15 gens (honest speed ~0.2 m/s, 20% upright, 0 steps) |
| P / S | CPG, alive 0.3 or 0, longer rewind (3 s / whole run), fall penalty 30 / 10 | standing still, Adam step shrinking to 0.01 |
| Q | plain MLP, alive 0.3, fall penalty 30, from stand | collapsed: 7% upright after 700 short gens |
| T / U / V | CPG, fixed σ_cpg 0.08 / 0.15 / 0.3, 3 s episodes, no alive bonus | U ran off to the minimum frequency; 3 s episodes are too short for the gait metrics to say anything |

**What I think is going on.** Near zero amplitude, the CPG landscape is flat: a small oscillation just shakes the body in place and earns nothing. The amplitude where a foot actually leaves the ground is a cliff (it falls) rather than a slope. The adaptive σ also shrinks the noise whenever siblings fall, which is the opposite of what an open-loop oscillator needs.

**The bigger mistake.** I kept killing runs after 10–20 minutes. ES needs on the order of 10⁵ episodes for MuJoCo's humanoid; the first main run stopped at gen 24, which is ~12k episodes. So the plain setup has never had a fair budget. For the rest of the night, two long runs (W: plain 64×64; X: 64×64 + learnable CPG), 256 pairs, untouched.
