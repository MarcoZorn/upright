# Training plan (proposal, not written yet)

Status: the body, senses, brain, viewer and determinism checks are in. Nothing below exists yet.

## Budget

Measured: one 10 s episode (1,200 physics steps, 300 brain calls, 316k-param MLP) is about 250 ms on one core.
With 31 worker threads that's about 120 full episodes per second. Early generations are cheaper because episodes end on a fall.
At 512 episodes per generation, that's roughly 4 s per generation, or about 900 generations an hour once episodes run the full 10 s.

## ES (OpenAI-style, Salimans et al. 2017)

- `src/es.js`, pure functions, no Rapier, unit-testable:
  - **Shared noise table**: 32M float32 (128 MB) in a `SharedArrayBuffer`, filled from a seed. A perturbation is just an offset into it, so workers receive `(offset, sign)` and send back `(fitness, steps)`: a few bytes per episode instead of 1.2 MB of parameters.
  - **Antithetic pairs**: θ + σε and θ − σε. Both members of a pair get the same environment seed (common random numbers), so the difference measures the brain and not the luck.
  - **Rank-based fitness shaping**: centered ranks in [−0.5, 0.5].
  - **Adam** on the averaged gradient estimate, plus L2 weight decay (0.005).
  - Starting hyperparameters: σ = 0.02, lr = 0.01, 256 pairs per generation.
- **Observation normalisation** (running mean and std, updated from about 1% of rollouts). Salimans et al. needed it for MuJoCo humanoid; the inputs here range from radians to metres to 0/1 contacts.
- `train.mjs`: a pool of 31 workers. Each initialises Rapier once and gets θ through a `SharedArrayBuffer` each generation.

## Reward and curriculum (`src/fitness.js`)

The same brain is used throughout; `targetSpeed` is an input so one network can stand, walk and run.

| stage | target speed | reward per brain step | graduates when |
|---|---|---|---|
| stand | 0 | alive + torso uprightness − energy | mean upright time ≥ 10 s over 16 seeded evals with random start noise and small pushes |
| walk | 1 m/s | alive + forward progress capped at the target − speed error − energy + uprightness | mean speed in 0.8–1.2 m/s, no falls, over 10 s |
| run | 3 m/s | same, with a target of 3 | mean ≥ 2.5 m/s with a flight phase (both feet off the ground) |

- Energy = Σ|motor torque × joint angular velocity|, scaled small.
- A fall ends the episode with a fixed penalty.
- Later stages also sample earlier targets (about 20% of episodes) so the brain doesn't forget how to stand.
- Episode seed: small random noise on the joint angles at spawn, plus random pushes, so it learns to balance rather than memorising one trajectory.

## Checkpoint and resume

- Every N generations, `runs/<name>/state.json` holds θ, Adam m/v, obs-norm stats, generation, stage and RNG state. It is written to a temp file and then renamed, so a crash never corrupts it (already gitignored).
- `brains/gen-XXXX.json` (the existing brain format plus obs-norm stats and stage) is appended to `brains/index.json`, which the viewer's generation slider reads.
- Resuming from a checkpoint replays the same random stream; this gets a test.

## NEAT baseline

Reuse the engine from my `neat-from-scratch` repo (vendored, no npm dep) on the same environment, fitness and episode budget. It produces one plot: best fitness against episodes used, ES vs NEAT. My expectation is that NEAT stalls at "stands a bit" on a 73-input, 30-output body, but that's the point of measuring it.

## Tests to add

- ES improves fitness on a small task: a pure-JS toy (match a target vector through a small MLP) must improve clearly in 50 generations.
- A 5-generation ragdoll stand run beats generation 0 for a fixed seed.
- Shaping, Adam and noise-table slicing match hand-computed values.
- Checkpoint → resume gives the same θ as running straight through.

## Open questions

1. **Velocity sense.** The current senses have no linear velocity. Walking at a target speed while unable to feel your own speed is hard (it would have to infer it from joint motion). I'd add torso-frame linear velocity (3 numbers): it's vestibular, not global position.
2. **Angles vs torques.** Outputs are currently PD target angles (Rapier's joint motors), which is far easier to evolve than raw torques. I'd keep that and expose stiffness as a per-joint constant.
