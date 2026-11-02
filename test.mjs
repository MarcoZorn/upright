// node test.mjs — real checks, no framework.
import R from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { rollout, zeroBrain, randomBrain, LAYERS } from './src/sim.js';
import { serialize, deserialize, paramCount } from './src/mlp.js';

await R.init();

if (!isMainThread) {
  parentPort.postMessage(rollout(R, randomBrain(workerData.seed), { seconds: 5, stopOnFall: false }).hash);
} else {
  const inWorker = (seed) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { seed } });
    w.once('message', res).once('error', rej);
  });
  const check = async (name, fn) => {
    const t0 = performance.now();
    await fn();
    console.log(`ok  ${name} (${(performance.now() - t0).toFixed(0)} ms)`);
  };

  await check('brain is ~300k params', () => {
    const n = paramCount(LAYERS);
    assert.ok(n > 250_000 && n < 350_000, `${n}`);
  });

  await check('zero brain holds the rest pose and stands 10 s', () => {
    const r = rollout(R, zeroBrain(), { seconds: 10 });
    assert.equal(r.upTime.toFixed(2), '10.00');
    assert.ok(r.pelvisY > 0.9 && Math.hypot(r.x, r.z) < 0.05, JSON.stringify(r));
  });

  await check('random brain falls (the task is not trivial)', () => {
    assert.ok(rollout(R, randomBrain(1), { seconds: 10 }).upTime < 5);
  });

  await check('physics is deterministic: same brain, same trajectory, also in a worker thread', async () => {
    const a = rollout(R, randomBrain(7), { seconds: 5, stopOnFall: false }).hash;
    const b = rollout(R, randomBrain(7), { seconds: 5, stopOnFall: false }).hash;
    const c = await inWorker(7);
    assert.equal(a, b);
    assert.equal(a, c);
    assert.notEqual(a, rollout(R, randomBrain(8), { seconds: 5, stopOnFall: false }).hash);
  });

  await check('save + load gives a bit-identical rollout', () => {
    const brain = randomBrain(3);
    const loaded = deserialize(serialize(brain, { note: 'test' }));
    assert.deepEqual(loaded.layers, brain.layers);
    assert.equal(loaded.meta.note, 'test');
    assert.deepEqual(loaded.params, brain.params);
    const opts = { seconds: 5, stopOnFall: false };
    assert.equal(rollout(R, loaded, opts).hash, rollout(R, brain, opts).hash);
  });

  console.log(`zero-brain 10 s trajectory hash ${rollout(R, zeroBrain(), { seconds: 10, stopOnFall: false }).hash.toString(16)} (the viewer shows the same number)`);
}
