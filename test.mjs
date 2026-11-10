// node test.mjs — real checks, no framework.
import R from '@dimforge/rapier3d-compat';
import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { rollout, zeroBrain, randomBrain, LAYERS } from './src/sim.js';
import { serialize, deserialize, paramCount, createMLP, mulberry32 } from './src/mlp.js';
import { makeNoise, centeredRanks, esGradient, adamStep } from './src/es.js';
import { episode, assistCap } from './src/task.js';
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

  await check('ES improves the ragdoll on a short task (move forward at 0.4 m/s, 3 s, no alive bonus)', () => {
    const brain = createMLP([LAYERS[0], 16, LAYERS[3]], 5, { zeroLast: true });
    const opts = (seed) => ({ stage: 1, seed, target: 0.4, seconds: 3, alive: 0 });
    const evalFit = () => [1, 2, 3, 4].reduce((s, seed) => s + episode(R, brain, opts(seed)).fitness, 0);
    const before = evalFit();
    es(brain.params, (p, seed) => episode(R, { ...brain, params: p }, opts(seed)).fitness, { gens: 8, pairs: 8, sigma: 0.05, lr: 0.03 });
    const after = evalFit();
    assert.ok(after > before + 15, `${before.toFixed(1)} -> ${after.toFixed(1)}`);
  });

  await check('training checkpoint -> resume matches an uninterrupted run, even after a crash mid-log', () => {
    const run = (dir, ...a) => execFileSync('node', ['train.mjs', '--run', dir, '--quiet', '--workers', '2', '--pairs', '3',
      '--evalSeeds', '1', '--noise', '1000000', '--saveEvery', '1000', '--publishEvery', '100000', '--brains', 'tmp/test-brains', ...a]);
    const tmp = 'tmp/test-runs';
    fs.rmSync(tmp, { recursive: true, force: true });
    run(`${tmp}/straight`, '--fresh', '--gens', '4');
    run(`${tmp}/resumed`, '--fresh', '--gens', '2');
    // what a hard crash leaves: a log line past the checkpoint, then a zero-filled tail
    const log = `${tmp}/resumed/log.jsonl`;
    fs.appendFileSync(log, JSON.stringify({ gen: 2, fitness: -1 }) + '\n\0\0\0\0');
    run(`${tmp}/resumed`, '--gens', '2');
    const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines(log).map((l) => l.gen), [0, 1, 2, 3]);
    assert.deepEqual(lines(log).map((l) => l.fitness), lines(`${tmp}/straight/log.jsonl`).map((l) => l.fitness));
    const a = JSON.parse(fs.readFileSync(`${tmp}/straight/state.json`)), b = JSON.parse(fs.readFileSync(`${tmp}/resumed/state.json`));
    assert.equal(a.gen, 4);
    assert.equal(b.gen, 4);
    assert.equal(a.theta, b.theta);
    assert.equal(a.adam.m, b.adam.m);
  });

  await check('the v2 help clock fades on schedule and switches off at k = 29 periods', async () => {
    assert.equal(assistCap(0, 6), 1);
    assert.equal(assistCap(5, 6), 1);
    assert.ok(Math.abs(assistCap(36, 6) - 0.531441) < 1e-9); // the level seeds 6 and 10 froze at, reached by k = 36
    assert.ok(assistCap(173, 6) > 0.05);
    assert.equal(assistCap(174, 6), 0);
    assert.equal(assistCap(5000, 0), 1); // no clock: v1 behaviour
  });

  await check('gait instruments classify hand-written footfalls', async () => {
    const { analyzeGait } = await import('./src/gait.js');
    const seq = (pattern, reps) => pattern.repeat(reps).split('').map(Number);
    // walk: 30-step stride, each foot down 20 steps, overlapping (double support), right half a stride behind
    const walkL = seq('1'.repeat(20) + '0'.repeat(10), 8), walkR = [...walkL.slice(15), ...walkL.slice(0, 15)];
    const w = analyzeGait(walkL, walkR, 1 / 30, 1);
    assert.ok(w.duty > 0.6 && w.flight === 0 && Math.abs(w.dphi - Math.PI) < 0.3 && w.skip === 0, JSON.stringify(w));
    // run: each foot down 10 of 30 steps, alternating, with flight phases between
    const runL = seq('1'.repeat(10) + '0'.repeat(20), 8), runR = [...runL.slice(15), ...runL.slice(0, 15)];
    const r = analyzeGait(runL, runR, 1 / 30, 3);
    assert.ok(r.duty < 0.5 && r.flight > 0.2 && Math.abs(r.dphi - Math.PI) < 0.3, JSON.stringify(r));
    // skip: L L R R ... (each foot lands twice in a row)
    const skipL = seq('1100000000' + '1100000000' + '0'.repeat(20), 6), skipR = [...skipL.slice(20), ...skipL.slice(0, 20)];
    assert.ok(analyzeGait(skipL, skipR, 1 / 30).skip > 0.4);
    assert.ok(Math.abs(analyzeGait(walkL, walkR, 1 / 30, Math.sqrt(9.81 * 0.92 * 0.5)).froude - 0.5) < 1e-9);
  });

  await check('polynomial sin matches Math.sin to 1e-6; CPG starts at rest and mirrors the legs', async () => {
    const { sinP } = await import('./src/trig.js');
    for (let x = -20; x < 20; x += 0.01) assert.ok(Math.abs(sinP(x) - Math.sin(x)) < 1e-6, `${x}`);
    const { cpgAct, CPG_SIZE } = await import('./src/cpg.js');
    const { DOFS } = await import('./src/body.js');
    const c = new Float32Array(CPG_SIZE);
    assert.ok(cpgAct(c, 7, new Float32Array(DOFS.length)).every((v) => v === 0));
    const li = DOFS.findIndex((d) => d.joint === 'pelvis-lthigh' && d.axis === 3), ri = DOFS.findIndex((d) => d.joint === 'pelvis-rthigh' && d.axis === 3);
    c.fill(0.3); c[CPG_SIZE - 2] = 0; c[CPG_SIZE - 1] = 0; // 1 Hz, half-cycle offset: right = left half a period later
    for (let step = 0; step < 30; step++) {
      const a = cpgAct(c, step, new Float32Array(DOFS.length)), b = cpgAct(c, step + 15, new Float32Array(DOFS.length));
      assert.ok(Math.abs(a[ri] - b[li]) < 1e-6);
    }
  });

  await check('the viewer rebuilds exactly the siblings a training worker evaluated', async () => {
    const { siblings } = await import('./src/ghosts.js');
    const { seedHash } = await import('./src/es.js');
    const { cpgBrain } = await import('./src/sim.js');
    const { CPG_SIZE } = await import('./src/cpg.js');
    const layers = [LAYERS[0], 8, LAYERS[3]];
    const b = cpgBrain(layers);
    for (let i = 0; i < b.full.length; i++) b.full[i] = Math.sin(i) * 0.1;
    const run = { seed: 3, noise: 200_000, sigma: 0.02, cpgSigma: 0.07 };
    const [first] = siblings(b, 5, run, 1);
    // what train.mjs + worker.mjs do for pair 0 of generation 5
    const noise = makeNoise(run.noise, 12345), off = Math.floor(mulberry32(seedHash(run.seed, 5))() * (run.noise - b.full.length));
    const scale = new Float32Array(b.full.length).fill(run.cpgSigma / run.sigma, 0, CPG_SIZE).fill(1, CPG_SIZE);
    const w = new Float32Array(b.full.length);
    for (let i = 0; i < w.length; i++) w[i] = b.full[i] + 1 * run.sigma * scale[i] * noise[off + i];
    assert.deepEqual(first.brain.full, w);
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

  await check('trajectories match the pinned hashes: zero brain, and every published walk graduate replays its proof', () => {
    // pinned: a change here means physics or senses changed, and every published brain's proof breaks with it
    assert.equal(rollout(R, zeroBrain(), { seconds: 10, stopOnFall: false }).hash.toString(16), 'b3c4fa14');
    const index = JSON.parse(fs.readFileSync('brains/index.json', 'utf8'));
    const grads = index.filter((e) => e.stage === 'walk' && e.graduated && e.proof);
    assert.ok(grads.length >= 5);
    for (const e of grads) {
      const b = deserialize(fs.readFileSync(`brains/${e.file}`, 'utf8'));
      const h = rollout(R, b, { seconds: 10, targetSpeed: e.proof.target, stopOnFall: false, gravity: e.proof.gravity }).hash.toString(16);
      assert.equal(h, e.proof.hash10, `${e.file} no longer replays its proof`);
    }
  });

  console.log(`zero-brain 10 s trajectory hash ${rollout(R, zeroBrain(), { seconds: 10, stopOnFall: false }).hash.toString(16)} (the viewer shows the same number)`);
}
