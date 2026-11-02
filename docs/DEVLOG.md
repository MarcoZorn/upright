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
