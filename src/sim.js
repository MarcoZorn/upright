// One dish: flat ground + one ragdoll. Physics at 120 Hz, brain at 30 Hz.
import { buildRagdoll, act, sense, fallen, OBS_SIZE, DOFS } from './body.js';
import { createMLP, forward } from './mlp.js';
import { cpgAct, cpgFreq, CPG_SIZE } from './cpg.js';
import { TWO_PI } from './trig.js';

export const DT = 1 / 120;
export const ACT_EVERY = 4;
export const SOLVER_ITERS = 16; // 4 (default) lets the ankle motors fight the foot contacts and the body topples
export const LAYERS = [OBS_SIZE, 512, 512, DOFS.length];

export function makeEnv(R, { targetSpeed = 0, gravity = 9.81 } = {}) {
  const world = new R.World({ x: 0, y: -gravity, z: 0 });
  world.timestep = DT;
  world.integrationParameters.numSolverIterations = SOLVER_ITERS;
  const ground = world.createCollider(
    R.ColliderDesc.cuboid(100, 0.5, 100).setTranslation(0, -0.5, 0).setFriction(1));
  const rd = buildRagdoll(R, world);
  return { R, world, ground, rd, targetSpeed, t: 0, step: 0, freq: 1, obs: new Float32Array(OBS_SIZE) };
}

export function observe(env) {
  return sense(env.rd, env.world, env.ground, env.targetSpeed, TWO_PI * env.freq * env.step / 30, env.obs);
}

export function stepEnv(env, out) {
  act(env.rd, out);
  for (let i = 0; i < ACT_EVERY; i++) env.world.step();
  env.t += DT * ACT_EVERY;
  env.step++;
}

// FNV-1a over the float32 bits of every part's position and rotation.
export function stateHash(env, h = 0x811c9dc5) {
  const f = new Float32Array(7), u = new Uint32Array(f.buffer);
  for (const b of Object.values(env.rd.bodies)) {
    const p = b.translation(), q = b.rotation();
    f.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w]);
    for (const v of u) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  }
  return h;
}

export const zeroBrain = () => ({ layers: LAYERS, zero: true });
export const randomBrain = (seed = 1) => createMLP(LAYERS, seed);
// A CPG brain keeps one flat parameter vector: [CPG_SIZE oscillator params | MLP params].
export function cpgBrain(layers, full = new Float32Array(CPG_SIZE + createMLP(layers).params.length)) {
  return { layers, full, cpg: full.subarray(0, CPG_SIZE), params: full.subarray(CPG_SIZE) };
}
export const brainFreq = (brain) => (brain.cpg ? cpgFreq(brain.cpg) : 1);

// Inputs are normalised with running stats gathered during training (stored in the brain file), clipped to ±5.
// step: brain step index (30 Hz), drives the CPG.
export function think(brain, obs, step = 0) {
  if (brain.zero) return new Float32Array(DOFS.length);
  if (brain.activate) return brain.activate(obs, (brain._out ??= new Float32Array(DOFS.length))); // NEAT genome
  let x = obs;
  if (brain.norm) {
    x = (brain._x ??= new Float32Array(obs.length));
    const { mean, std } = brain.norm;
    for (let i = 0; i < obs.length; i++) x[i] = Math.max(-5, Math.min(5, (obs[i] - mean[i]) / std[i]));
  }
  const out = forward(brain, x);
  return brain.cpg ? cpgAct(brain.cpg, step, out) : out;
}

// Runs one episode headless. Returns how long it stayed up and a hash of the whole trajectory.
export function rollout(R, brain, { seconds = 10, targetSpeed = 0, stopOnFall = true } = {}) {
  const env = makeEnv(R, { targetSpeed });
  env.freq = brainFreq(brain);
  let hash = 0x811c9dc5, upTime = 0;
  const steps = Math.round(seconds / (DT * ACT_EVERY));
  for (let s = 0; s < steps; s++) {
    stepEnv(env, think(brain, observe(env), env.step));
    hash = stateHash(env, hash);
    if (fallen(env.rd)) { if (stopOnFall) break; } else upTime = env.t;
  }
  const pelvis = env.rd.bodies.pelvis.translation();
  const res = { upTime, hash, pelvisY: pelvis.y, x: pelvis.x, z: pelvis.z };
  env.world.free();
  return res;
}
