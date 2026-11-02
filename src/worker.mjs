// ES worker: owns one Rapier instance, evaluates antithetic pairs against the shared theta + noise table.
import { parentPort, workerData } from 'node:worker_threads';
import R from '@dimforge/rapier3d-compat';
import { episode } from './task.js';
import { newStats } from './es.js';
import { OBS_SIZE } from './body.js';

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
  return episode(R, brain, { stage: job.stage, seed: job.seed, target: job.target, stats });
}

parentPort.on('message', (job) => {
  brain.norm.mean.set(norm.subarray(0, OBS_SIZE));
  brain.norm.std.set(norm.subarray(OBS_SIZE));
  if (job.eval) {
    parentPort.postMessage({ id: job.id, res: run(job, 0) });
    return;
  }
  const stats = newStats(OBS_SIZE);
  const plus = run(job, 1, stats), minus = run(job, -1, stats);
  parentPort.postMessage({ id: job.id, plus, minus, stats });
});
