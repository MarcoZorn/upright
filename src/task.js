// Reward + curriculum. One episode = one brain, one target speed, one seeded set of pushes.
import { fallen, DOFS, OBS_SIZE } from './body.js';
import { makeEnv, observe, stepEnv, think, DT, ACT_EVERY } from './sim.js';
import { mulberry32 } from './mlp.js';

// targets: [speed m/s, probability]. Later stages keep sampling earlier targets so nothing is forgotten.
export const STAGES = [
  { name: 'stand', targets: [[0, 1]], push: 20, graduate: (m) => m.upFrac >= 0.9 },
  { name: 'walk', targets: [[1, 0.8], [0, 0.2]], push: 15, graduate: (m) => m.upFrac >= 0.95 && m.speed[1] > 0.85 && m.speed[1] < 1.2 },
  { name: 'run', targets: [[3, 0.6], [1, 0.2], [0, 0.2]], push: 10, graduate: () => false },
];
export const SECONDS = 10;
const CTRL_DT = DT * ACT_EVERY;
const VEL = DOFS.length; // obs offset of joint velocities (scaled 0.1)
const UP_Y = DOFS.length * 2 + 1; // world-up seen from the torso, y component = uprightness

export function sampleTarget(stage, seed) {
  const r = mulberry32(seed ^ 0x9e3779b9)();
  let acc = 0;
  for (const [v, p] of STAGES[stage].targets) if (r < (acc += p)) return v;
  return STAGES[stage].targets[0][0];
}

// Per brain step: alive bonus + uprightness + speed tracking - energy. Falling ends the episode with a penalty.
// alive / pushScale: reward and difficulty knobs, set from train.mjs flags for sweeps.
export function episode(R, brain, { stage = 0, seed = 1, target = sampleTarget(stage, seed), seconds = SECONDS, stats, alive = 1, pushScale = 1 } = {}) {
  const env = makeEnv(R, { targetSpeed: target });
  const rng = mulberry32(seed);
  const pushMax = STAGES[stage].push * pushScale;
  const torso = env.rd.bodies.torso, pelvis = env.rd.bodies.pelvis;
  const kick = (mag) => {
    const a = rng() * Math.PI * 2, m = mag * (0.5 + 0.5 * rng());
    torso.applyImpulse({ x: Math.cos(a) * m, y: 0, z: Math.sin(a) * m }, true);
  };
  kick(5);
  let nextPush = 2 + 2 * rng();
  let fitness = 0, upTime = 0, energy = 0, done = false;
  const steps = Math.round(seconds / CTRL_DT);
  for (let s = 0; s < steps && !done; s++) {
    const obs = observe(env);
    if (stats) for (let i = 0; i < OBS_SIZE; i++) { stats.sum[i] += obs[i]; stats.sumsq[i] += obs[i] * obs[i]; }
    if (stats) stats.count++;
    const out = think(brain, obs);
    // mechanical power estimate from the PD law the motors run: |tau * omega|
    let power = 0;
    for (let i = 0; i < DOFS.length; i++) {
      const d = DOFS[i], o = Math.max(-1, Math.min(1, out[i]));
      const tgt = o < 0 ? -o * d.lo : o * d.hi, w = obs[VEL + i] * 10;
      const tau = Math.max(-d.maxT, Math.min(d.maxT, d.kp * (tgt - obs[i]) - d.kp * 0.05 * w));
      power += Math.abs(tau * w);
    }
    stepEnv(env, out);
    if (env.t >= nextPush) { kick(pushMax); nextPush += 2 + 2 * rng(); }
    if (fallen(env.rd)) { fitness -= 10; done = true; break; }
    upTime = env.t;
    const v = pelvis.linvel();
    const track = target === 0
      ? -(Math.abs(v.z) + Math.abs(v.x))
      : (3 * Math.min(v.z, target) - 1.5 * Math.max(0, v.z - target) - Math.abs(v.x)) / target;
    fitness += alive * (1 + 0.5 * obs[UP_Y]) + track - 0.0005 * power;
    energy += power * CTRL_DT;
  }
  const p = pelvis.translation();
  env.world.free();
  return { fitness, upTime, upFrac: upTime / seconds, dist: p.z, speed: upTime > 0 ? p.z / upTime : 0, energy, target };
}
