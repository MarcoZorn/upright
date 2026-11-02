# upright

A 3D human ragdoll that learns to stand, walk and run by neuroevolution, with no motion capture and no hand-written gait. You can watch it live in the browser.

**[Open the viewer](https://marcozorn.github.io/upright/)** · [Devlog](docs/DEVLOG.md) · [Training plan](docs/PLAN.md)

![The ragdoll holding its rest pose](docs/standing.png)

Real rigid-body physics ([Rapier](https://rapier.rs), WASM). The exact same simulation code runs headless in Node for training and in the page for viewing. It is bit-for-bit deterministic: the browser reproduces Node's trajectory hash exactly.

## The body

15 rigid parts, about 71 kg and 1.74 m tall. There are 14 joints with 30 motorised degrees of freedom, each with a human-ish angle limit:

| joint | DOF |
|---|---|
| ankles, wrists | 2 each |
| knees, elbows | 1 each |
| hips, shoulders, waist, neck | 3 each |

**Senses (73 numbers):** joint angles and velocities, torso orientation and spin, pelvis height, foot contacts, and target speed. It has no idea where it is in the world.

**Brain:** an MLP, 73 → 512 → 512 → 30, about 316k parameters. It outputs a target angle per joint, which the joint motors chase.

| random brain, 0.9 s in | random brain, 3.4 s in |
|---|---|
| ![random brain](docs/random.png) | ![fallen](docs/fallen.png) |

## Status

- [x] Ragdoll stands in Rapier, in Node and in the browser
- [x] Deterministic physics, brain save/load gives identical rollouts
- [x] Viewer: orbit camera, slow motion, footprints, push button, generation picker
- [ ] Evolution strategies (antithetic sampling, rank shaping, Adam, 32 worker threads)
- [ ] Curriculum: stand 10 s → walk 1 m/s → run
- [ ] NEAT baseline for comparison

## Run it

```bash
npm install
node test.mjs           # determinism, save/load, stands, random brain falls
node stand.mjs          # headless smoke run
python3 -m http.server  # then open http://localhost:8000
```

The viewer needs no build step: three.js and Rapier come from a CDN via an import map.

## Layout

```
src/body.js   ragdoll: parts, joints, limits, motors, senses
src/mlp.js    flat-parameter MLP, save/load
src/sim.js    environment, rollout, trajectory hash
viewer.js     three.js viewer
test.mjs      checks
```

MIT.
