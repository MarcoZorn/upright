// Reward + curriculum. One episode = one brain, one target speed, one seeded set of pushes.
import { fallen, DOFS, OBS_SIZE } from './body.js';
import { makeEnv, observe, stepEnv, think, brainFreq, DT, ACT_EVERY } from './sim.js';
import { analyzeGait } from './gait.js';
import { mulberry32 } from './mlp.js';

// targets: [speed m/s, probability]. Later stages keep sampling earlier targets so nothing is forgotten.
// Graduation also needs the perturbed population to survive (m.popUp): exploring around a brain that only
// just balances makes every sibling fall, and then ES ranks fallers and learns to dive.
export const STAGES = [
  { name: 'stand', targets: [[0, 1]], push: 20, graduate: (m) => m.upFrac >= 0.95 && m.popUp >= 0.8 },
  { name: 'shuffle', targets: [[0.4, 0.8], [0, 0.2]], push: 0, graduate: (m) => m.upFrac >= 0.9 && m.popUp >= 0.7 && m.speed[0.4] > 0.3 },
  { name: 'walk', targets: [[1, 0.6], [0.4, 0.2], [0, 0.2]], push: 0, graduate: (m) => m.upFrac >= 0.9 && m.popUp >= 0.7 && m.speed[1] > 0.9 }, // 0.9: a margin over the gate's 0.8 (amendment 3)
  { name: 'jog', targets: [[2, 0.6], [1, 0.2], [0, 0.2]], push: 8, graduate: (m) => m.upFrac >= 0.9 && m.popUp >= 0.7 && m.speed[2] > 1.6 },
  { name: 'run', targets: [[3, 0.6], [2, 0.1], [1, 0.1], [0, 0.2]], push: 8, graduate: () => false },
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

// "Hand of God" assist (Yu, Turk & Liu 2018): a virtual spring keeps the torso upright and a force pulls the
// pelvis towards the target speed, so stepping is safe to discover. Training anneals `assist` to 0, and a
// stage only graduates without it. Recomputed every physics substep: held for a whole brain step, the
// damping term goes numerically unstable and the body launches itself.
function helpingHand(env, target, a) {
  const torso = env.rd.bodies.torso, pelvis = env.rd.bodies.pelvis;
  const K = 300 * a, D = 15 * a;
  for (const body of [torso, pelvis]) { // upright springs: torque ~ (body up) x (world up)
    body.resetTorques(false);
    const q = body.rotation(), w = body.angvel();
    const ux = 2 * (q.x * q.y - q.w * q.z), uz = 2 * (q.y * q.z + q.w * q.x);
    body.addTorque({ x: -K * uz - D * w.x, y: -D * w.y, z: K * ux - D * w.z }, true);
  }
  // body-weight support (up to 40% of ~71 kg) plus a gentle pull towards the target speed
  const v = pelvis.linvel();
  pelvis.resetForces(false);
  pelvis.addForce({ x: -100 * a * v.x, y: 0.4 * a * 71 * 9.81, z: 100 * a * (target - v.z) }, true);
}

// v2 (docs/PREREG-V2.md): k generations into a helped stage, the help can be at most 0.9^floor(k/period),
// and is off below 0.05 (k = 29·period). period 0: no clock (v1), never binds.
export const assistCap = (k, period) => {
  if (!period) return 1;
  const a = 0.9 ** Math.floor(k / period);
  return a < 0.05 ? 0 : a;
};

// Per brain step: alive bonus + uprightness + speed tracking - energy. Falling ends the episode with a penalty.
// alive / pushScale: reward and difficulty knobs, set from train.mjs flags for sweeps.
export function episode(R, brain, { stage = 0, seed = 1, target = sampleTarget(stage, seed), seconds = SECONDS, stats, alive = 1, pushScale = 1, gravity = 9.81, gait = false, rewind = 1, fallPenalty = 10, assist = 0 } = {}) {
  const REWIND = Math.max(1, Math.round(rewind / CTRL_DT));
  const env = makeEnv(R, { targetSpeed: target, gravity });
  env.freq = brainFreq(brain);
  if (assist > 0) env.preStep = () => helpingHand(env, target, assist);
  const contacts = gait ? [[], []] : null;
  const rng = mulberry32(seed);
  const pushMax = STAGES[stage].push * pushScale;
  const torso = env.rd.bodies.torso, pelvis = env.rd.bodies.pelvis;
  const kick = (mag) => {
    let x, z, r; // random direction by rejection sampling: no sin/cos, same bits in every engine
    do { x = 2 * rng() - 1; z = 2 * rng() - 1; r = x * x + z * z; } while (r > 1 || r < 1e-6);
    const m = mag * (0.5 + 0.5 * rng()) / Math.sqrt(r);
    torso.applyImpulse({ x: x * m, y: 0, z: z * m }, true);
  };
  kick(5);
  let nextPush = 2 + 2 * rng();
  let fitness = 0, upTime = 0, energy = 0, done = false;
  const steps = Math.round(seconds / CTRL_DT);
  // Ring buffers of the last `rewind` seconds: on a fall, the forward-speed credit and distance of that
  // window are taken back, so diving forward pays nothing; only progress that was survived counts.
  const trackHist = new Float64Array(REWIND), zHist = new Float64Array(REWIND);
  for (let s = 0; s < steps && !done; s++) {
    const obs = observe(env);
    if (stats) for (let i = 0; i < OBS_SIZE; i++) { stats.sum[i] += obs[i]; stats.sumsq[i] += obs[i] * obs[i]; }
    if (stats) stats.count++;
    const out = think(brain, obs, env.step);
    if (contacts) { contacts[0].push(obs[OBS_SIZE - 3]); contacts[1].push(obs[OBS_SIZE - 2]); }
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
    if (fallen(env.rd)) {
      for (const t of trackHist) if (t > 0) fitness -= t;
      fitness -= fallPenalty;
      done = true;
      break;
    }
    upTime = env.t;
    const v = pelvis.linvel();
    const track = target === 0
      ? -(Math.abs(v.z) + Math.abs(v.x))
      : (3 * Math.min(v.z, target) - 1.5 * Math.max(0, v.z - target) - Math.abs(v.x)) / target;
    trackHist[s % REWIND] = track;
    zHist[s % REWIND] = pelvis.translation().z;
    fitness += alive * (1 + 0.5 * obs[UP_Y]) + track - 0.0005 * power;
    energy += power * CTRL_DT;
  }
  // Honest distance: where the pelvis was a second before the fall (or at the end, if it never fell).
  const lastUp = Math.round(upTime / CTRL_DT) - 1;
  const dist = !done ? pelvis.translation().z : lastUp >= REWIND ? zHist[(lastUp - REWIND + 1) % REWIND] : 0;
  const creditTime = done ? Math.max(0, upTime - REWIND * CTRL_DT) : upTime;
  env.world.free();
  const speed = creditTime > 0 ? dist / creditTime : 0;
  const res = { fitness, upTime, upFrac: upTime / seconds, dist, speed, energy, target };
  // gait over the upright part only, skipping the first second (getting going)
  if (contacts) res.gait = analyzeGait(contacts[0].slice(30, lastUp + 1), contacts[1].slice(30, lastUp + 1), CTRL_DT, speed, gravity);
  return res;
}
