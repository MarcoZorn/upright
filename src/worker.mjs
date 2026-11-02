// ES worker: owns one Rapier instance, evaluates antithetic pairs against the shared theta + noise table.
import { parentPort, workerData } from 'node:worker_threads';
import R from '@dimforge/rapier3d-compat';
import { episode } from './task.js';
import { newStats } from './es.js';
import { OBS_SIZE } from './body.js';
import { Genome } from '../vendor/neat/genome.js';

await R.init();
const { noiseBuf, thetaBuf, normBuf, layers } = workerData;
const noise = new Float32Array(noiseBuf), theta = new Float32Array(thetaBuf), norm = new Float32Array(normBuf);
const brain = {
  layers, params: new Float32Array(theta.length),
  norm: { mean: new Float32Array(OBS_SIZE), std: new Float32Array(OBS_SIZE) },
};

function run(job, sign, stats) {
  const p = brain.params;
  if (sign === 0) p.set(theta);
  else for (let i = 0; i < p.length; i++) p[i] = theta[i] + sign * job.sigma * noise[job.off + i];
  return episode(R, brain, { stage: job.stage, seed: job.seed, target: job.target, stats, alive: job.alive, pushScale: job.pushScale });
}

parentPort.on('message', (job) => {
  brain.norm.mean.set(norm.subarray(0, OBS_SIZE));
  brain.norm.std.set(norm.subarray(OBS_SIZE));
  if (job.genome) { // NEAT baseline: score one genome on the given seeds
    const g = Genome.fromJSON(job.genome);
    const res = job.seeds.map((seed) => episode(R, g, { stage: job.stage, seed, target: job.target }));
    parentPort.postMessage({ id: job.id, res });
    return;
  }
  if (job.eval) {
    parentPort.postMessage({ id: job.id, res: run(job, 0) });
    return;
  }
  const stats = newStats(OBS_SIZE);
  const plus = run(job, 1, stats), minus = run(job, -1, stats);
  parentPort.postMessage({ id: job.id, plus, minus, stats });
});
