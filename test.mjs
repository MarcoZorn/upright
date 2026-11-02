// node test.mjs — real checks, no framework.
import R from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { rollout, zeroBrain, randomBrain, LAYERS } from './src/sim.js';
import { serialize, deserialize, paramCount, createMLP, mulberry32 } from './src/mlp.js';
import { makeNoise, centeredRanks, esGradient, adamStep } from './src/es.js';
import { episode } from './src/task.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

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

  await check('centered ranks', () => {
    assert.deepEqual([...centeredRanks([10, -3, 7, 100])], [1 / 6, -0.5, -1 / 6, 0.5].map(Math.fround));
  });

  // Small ES loop used by the next two checks: antithetic pairs, rank shaping, Adam.
  const es = (theta, f, { gens, pairs, sigma, lr, seed = 1 }) => {
    const noise = makeNoise(theta.length + 50_000, seed), rng = mulberry32(seed), adam = {};
    for (let g = 0; g < gens; g++) {
      const ps = [];
      for (let k = 0; k < pairs; k++) {
        const off = Math.floor(rng() * 50_000), plus = theta.slice(), minus = theta.slice();
        for (let i = 0; i < theta.length; i++) { plus[i] += sigma * noise[off + i]; minus[i] -= sigma * noise[off + i]; }
        ps.push({ off, plus: f(plus, g * 1000 + k), minus: f(minus, g * 1000 + k) });
      }
      adamStep(theta, esGradient(theta.length, noise, ps, sigma), adam, { lr, l2: 0 });
    }
  };

  await check('ES solves a toy problem (500-dim quadratic)', () => {
    const target = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i));
    const f = (x) => -x.reduce((s, v, i) => s + (v - target[i]) ** 2, 0);
    const theta = new Float32Array(500);
    const before = f(theta);
    es(theta, f, { gens: 300, pairs: 20, sigma: 0.05, lr: 0.02 });
    assert.ok(f(theta) > 0.05 * before, `${before} -> ${f(theta)}`); // >95% of the error gone
  });

  await check('ES improves the ragdoll on a short walk task', () => {
    const brain = createMLP([LAYERS[0], 16, LAYERS[3]], 5, { zeroLast: true });
    const evalFit = () => [1, 2, 3, 4].reduce((s, seed) => s + episode(R, brain, { stage: 1, seed, target: 1, seconds: 2 }).fitness, 0);
    const before = evalFit();
    es(brain.params, (p, seed) => episode(R, { ...brain, params: p }, { stage: 1, seed, target: 1, seconds: 2 }).fitness,
      { gens: 8, pairs: 8, sigma: 0.05, lr: 0.03 });
    const after = evalFit();
    assert.ok(after > before + 5, `${before.toFixed(1)} -> ${after.toFixed(1)}`);
  });

  await check('training checkpoint -> resume matches an uninterrupted run', () => {
    const run = (dir, ...a) => execFileSync('node', ['train.mjs', '--run', dir, '--quiet', '--workers', '2', '--pairs', '3',
      '--evalSeeds', '1', '--noise', '1000000', '--saveEvery', '1000', '--publishEvery', '100000', ...a]);
    const tmp = 'tmp/test-runs';
    fs.rmSync(tmp, { recursive: true, force: true });
    run(`${tmp}/straight`, '--fresh', '--gens', '4');
    run(`${tmp}/resumed`, '--fresh', '--gens', '2');
    run(`${tmp}/resumed`, '--gens', '2');
    const a = JSON.parse(fs.readFileSync(`${tmp}/straight/state.json`)), b = JSON.parse(fs.readFileSync(`${tmp}/resumed/state.json`));
    assert.equal(a.gen, 4);
    assert.equal(b.gen, 4);
    assert.equal(a.theta, b.theta);
    assert.equal(a.adam.m, b.adam.m);
  });

  await check('a second JS engine (Bun / JavaScriptCore) reproduces the same trajectory and fitness', () => {
    let bun;
    try { bun = execFileSync('which', ['bun']).toString().trim(); } catch { console.log('    (bun not installed, skipped)'); return; }
    const code = `const {default:R}=await import('@dimforge/rapier3d-compat');await R.init();
      const s=await import('./src/sim.js');const t=await import('./src/task.js');const b=s.randomBrain(3);
      console.log(s.rollout(R,b,{seconds:5,stopOnFall:false}).hash, t.episode(R,b,{stage:2,seed:9}).fitness)`;
    const other = execFileSync(bun, ['-e', code]).toString().trim();
    const b = randomBrain(3);
    assert.equal(other, `${rollout(R, b, { seconds: 5, stopOnFall: false }).hash} ${episode(R, b, { stage: 2, seed: 9 }).fitness}`);
  });

  console.log(`zero-brain 10 s trajectory hash ${rollout(R, zeroBrain(), { seconds: 10, stopOnFall: false }).hash.toString(16)} (the viewer shows the same number)`);
}
