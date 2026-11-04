// Headless ES training with checkpoints. Ctrl-C (SIGINT/SIGTERM) checkpoints and exits; rerun to resume.
//   node train.mjs --run runs/main [--fresh] [--gens N] [--pairs 256] [--sigma 0.005] [--lr 0.001] [--workers N]
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
try { os.setPriority(19); } catch { /* lowest priority: never get in the way of interactive work */ }
import { DOFS, OBS_SIZE } from './src/body.js';
import { createMLP, mulberry32, serialize, toB64, fromB64 } from './src/mlp.js';
import { makeNoise, esGradient, adamStep, newStats, mergeStats, statsToNorm, seedHash } from './src/es.js';
import { STAGES, sampleTarget } from './src/task.js';
import { CPG_SIZE, cpgFreq, cpgDphi } from './src/cpg.js';
import { rollout } from './src/sim.js';
import R from '@dimforge/rapier3d-compat';
import { deserialize } from './src/mlp.js';
await R.init();

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));
const cfg = {
  run: args.run ?? 'runs/main', seed: +(args.seed ?? 1), pairs: +(args.pairs ?? 256), sigma: +(args.sigma ?? 0.005),
  lr: +(args.lr ?? 0.001), l2: +(args.l2 ?? 0.005), workers: +(args.workers ?? Math.max(1, Math.floor(os.cpus().length * 0.7) - 1)), // leave 30% of the machine free
  gens: +(args.gens ?? Infinity), noise: +(args.noise ?? 32_000_000), evalSeeds: +(args.evalSeeds ?? 8),
  saveEvery: +(args.saveEvery ?? 10), publishEvery: +(args.publishEvery ?? 50), quiet: !!args.quiet,
  stage: args.stage !== undefined ? +args.stage : undefined,
  alive: +(args.alive ?? 1), pushScale: +(args.pushScale ?? 1), hidden: +(args.hidden ?? 512),
  cpg: !!args.cpg, cpgSigma: +(args.cpgSigma ?? 0.1), freezeMlp: !!args.freezeMlp, gravity: +(args.gravity ?? 9.81), rewind: +(args.rewind ?? 1), fallPenalty: +(args.fallPenalty ?? 10), seconds: +(args.seconds ?? 10), assist: +(args.assist ?? 0), assistStart: +(args.assist ?? 0), sigmaMax: +(args.sigmaMax ?? 0.03), brains: args.brains ?? 'brains',
  adaptSigma: args.adaptSigma === undefined ? true : args.adaptSigma !== 'false',
};
const dir = cfg.run, stateFile = path.join(dir, 'state.json'), logFile = path.join(dir, 'log.jsonl');
fs.mkdirSync(path.join(dir, 'gens'), { recursive: true });
if (args.fresh) for (const f of [stateFile, logFile]) fs.rmSync(f, { force: true });

// ---------- state ----------
const saved = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
if (saved && args.hidden === undefined) cfg.hidden = saved.cfg.hidden ?? 512; // older runs had no flag: 512
if (saved && args.cpg === undefined) cfg.cpg = !!saved.cfg.cpg;
const LAYERS = [OBS_SIZE, cfg.hidden, cfg.hidden, DOFS.length];
const mlpDim = createMLP(LAYERS).params.length, cpgDim = cfg.cpg ? CPG_SIZE : 0, dim = cpgDim + mlpDim;
// Per-parameter noise scale: the CPG block explores at cpgSigma, the MLP at sigma (or not at all with --freezeMlp).
const scaleBuf = new SharedArrayBuffer(dim * 4), scale = new Float32Array(scaleBuf);
function setScale() {
  scale.fill(cfg.cpgSigma / cfg.sigma, 0, cpgDim);
  scale.fill(cfg.freezeMlp ? 0 : 1, cpgDim);
}
const thetaBuf = new SharedArrayBuffer(dim * 4), normBuf = new SharedArrayBuffer(OBS_SIZE * 8);
const theta = new Float32Array(thetaBuf), norm = new Float32Array(normBuf);
let st;
if (saved) {
  const s = saved;
  theta.set(fromB64(s.theta));
  st = { gen: s.gen, stage: s.stage, adam: { t: s.adam.t, b1t: s.adam.b1t, b2t: s.adam.b2t, m: fromB64(s.adam.m), v: fromB64(s.adam.v) },
    stats: { count: s.stats.count, sum: Float64Array.from(s.stats.sum), sumsq: Float64Array.from(s.stats.sumsq) } };
  // saved settings win, except flags given on this command line (so a live run can be retuned)
  const explicit = Object.fromEntries(Object.keys(args).filter((k) => k in cfg).map((k) => [k, cfg[k]]));
  Object.assign(cfg, s.cfg, { gens: cfg.gens, workers: cfg.workers, quiet: cfg.quiet }, explicit);
  log(`resumed ${dir} at gen ${st.gen}, stage ${STAGES[st.stage].name}`);
} else {
  theta.set(createMLP(LAYERS, cfg.seed, { zeroLast: true }).params, cpgDim); // CPG block starts at 0: stand still
  st = { gen: 0, stage: 0, adam: {}, stats: newStats(OBS_SIZE) };
}
if (cfg.stage !== undefined) st.stage = cfg.stage;
setScale();

function currentNorm() {
  const n = statsToNorm(st.stats);
  n.mean[OBS_SIZE - 1] = 0; n.std[OBS_SIZE - 1] = 1; // target speed goes in raw: its stats change with the stage
  return n;
}

function checkpoint() {
  const s = {
    gen: st.gen, stage: st.stage, cfg, theta: toB64(theta),
    adam: { t: st.adam.t ?? 0, b1t: st.adam.b1t, b2t: st.adam.b2t, m: toB64(st.adam.m ?? new Float32Array(dim)), v: toB64(st.adam.v ?? new Float32Array(dim)) },
    stats: { count: st.stats.count, sum: [...st.stats.sum], sumsq: [...st.stats.sumsq] },
  };
  fs.writeFileSync(stateFile + '.tmp', JSON.stringify(s));
  fs.renameSync(stateFile + '.tmp', stateFile);
}

function saveBrain(file, meta, params = theta, nrm = currentNorm()) {
  const b = cpgDim ? { layers: LAYERS, full: params, cpg: params.subarray(0, cpgDim), params: params.subarray(cpgDim) } : { layers: LAYERS, params };
  fs.writeFileSync(file, serialize({ ...b, norm: nrm }, { ...meta, gravity: cfg.gravity }));
}

// Milestones go to brains/ (committed, read by the viewer); every saveEvery gens go to runs/<name>/gens/ (ignored).
function publish(meta, params, nrm) {
  fs.mkdirSync(cfg.brains, { recursive: true });
  const file = `${path.basename(dir)}-gen${String(st.gen).padStart(5, '0')}.json`;
  // Proof of walk: the hash of a plain 10 s replay at the stage's target speed. The viewer recomputes it.
  const target = STAGES[st.stage].targets[0][0];
  saveBrain(path.join(cfg.brains, file), meta, params, nrm);
  const b = deserialize(fs.readFileSync(path.join(cfg.brains, file), 'utf8'));
  meta.proof = { target, gravity: cfg.gravity, hash10: rollout(R, b, { seconds: 10, targetSpeed: target, stopOnFall: false, gravity: cfg.gravity }).hash.toString(16) };
  saveBrain(path.join(cfg.brains, file), meta, params, nrm);
  const idxFile = path.join(cfg.brains, 'index.json');
  const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : [];
  idx.push({ run: path.basename(dir), file, ...meta });
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));
}

function log(msg) { if (!cfg.quiet) console.log(msg); }

// ---------- workers ----------
const t0 = performance.now();
const noiseBuf = new SharedArrayBuffer(cfg.noise * 4);
makeNoise(cfg.noise, 12345, noiseBuf);
const noise = new Float32Array(noiseBuf);
log(`noise table ${cfg.noise / 1e6}M ready in ${((performance.now() - t0) / 1000).toFixed(1)} s; ${cfg.workers} workers; ${dim} params`);

const workers = Array.from({ length: cfg.workers }, () =>
  new Worker(new URL('./src/worker.mjs', import.meta.url), { workerData: { noiseBuf, thetaBuf, normBuf, scaleBuf, layers: LAYERS, cpgDim } }));
function runJobs(jobs) {
  return new Promise((resolve, reject) => {
    const out = new Array(jobs.length);
    let next = 0, done = 0;
    const feed = (w) => { if (next < jobs.length) w.postMessage({ ...jobs[next], id: next++ }); };
    for (const w of workers) {
      w.removeAllListeners('message').removeAllListeners('error');
      w.on('message', (m) => { out[m.id] = m; if (++done === jobs.length) resolve(out); else feed(w); });
      w.on('error', reject);
      feed(w);
    }
  });
}

// ---------- loop ----------
let stopping = false;
const stop = () => { if (stopping) process.exit(1); stopping = true; log('stopping after this generation…'); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const hash = seedHash;
const endGen = st.gen + cfg.gens;
while (!stopping && st.gen < endGen) {
  const g0 = performance.now(), stage = STAGES[st.stage];
  const n = currentNorm();
  norm.set(n.mean, 0); norm.set(n.std, OBS_SIZE);
  // No helping hand while learning to stand: standing is exactly what the springs would replace
  // (run Z, first attempt: with help from gen 0 its bare evals were 4-9% upright after 200 gens).
  if (st.stage === 0) cfg.assist = 0;
  const rng = mulberry32(hash(cfg.seed, st.gen));
  const jobs = [];
  for (let k = 0; k < cfg.pairs; k++) {
    const seed = hash(cfg.seed, st.gen, k);
    jobs.push({ off: Math.floor(rng() * (cfg.noise - dim)), seed, stage: st.stage, target: sampleTarget(st.stage, seed), sigma: cfg.sigma, alive: cfg.alive, pushScale: cfg.pushScale, gravity: cfg.gravity, rewind: cfg.rewind, fallPenalty: cfg.fallPenalty, seconds: cfg.seconds, assist: cfg.assist });
  }
  const targets = [...new Set(stage.targets.map(([v]) => v))];
  for (const target of targets) for (let e = 0; e < cfg.evalSeeds; e++)
    jobs.push({ eval: true, seed: hash(cfg.seed, st.gen, 1e6 + e), stage: st.stage, target, alive: cfg.alive, pushScale: cfg.pushScale, gravity: cfg.gravity, gait: true, rewind: cfg.rewind, fallPenalty: cfg.fallPenalty, seconds: cfg.seconds, assist: cfg.assist });
  // with assist on, also measure the brain on its own (honest numbers)
  if (cfg.assist > 0) for (let e = 0; e < 4; e++)
    jobs.push({ eval: true, bare: true, seed: hash(cfg.seed, st.gen, 2e6 + e), stage: st.stage, target: targets[0], alive: cfg.alive, pushScale: cfg.pushScale, gravity: cfg.gravity, gait: true, rewind: cfg.rewind, fallPenalty: cfg.fallPenalty, seconds: cfg.seconds, assist: 0 });

  const res = await runJobs(jobs);
  const pairs = res.filter((r) => r.plus);
  const evals = res.filter((r, i) => r.res && !jobs[i].bare).map((r) => r.res);
  const bare = res.filter((r, i) => r.res && jobs[i].bare).map((r) => r.res);
  for (const p of pairs) mergeStats(st.stats, p.stats);
  const grad = esGradient(dim, noise, pairs.map((p, k) => ({ off: jobs[k].off, plus: p.plus.fitness, minus: p.minus.fitness })), cfg.sigma);
  for (let i = 0; i < dim; i++) grad[i] = scale[i] ? grad[i] / scale[i] : 0; // frozen blocks don't move
  const evaluated = theta.slice(); // the brain the evals measured, before this update
  const stepNorm = adamStep(theta, grad, st.adam, { lr: cfg.lr, l2: cfg.l2 });

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const m = {
    gen: st.gen, stage: stage.name,
    fitness: mean(evals.map((e) => e.fitness)),
    popFitness: mean(pairs.flatMap((p) => [p.plus.fitness, p.minus.fitness])),
    upFrac: mean(evals.map((e) => e.upFrac)),
    popUp: mean(pairs.flatMap((p) => [p.plus.upFrac, p.minus.upFrac])), // do the perturbed siblings survive too?
    speed: Object.fromEntries(targets.map((t) => [t, mean(evals.filter((e) => e.target === t).map((e) => e.speed))])),
    step: stepNorm, secs: (performance.now() - g0) / 1000, sigma: cfg.sigma, cpgSigma: cfg.cpgSigma, assist: cfg.assist,
  };
  if (bare.length) m.bare = { upFrac: +mean(bare.map((e) => e.upFrac)).toFixed(3), speed: +mean(bare.map((e) => e.speed)).toFixed(3) };
  // gait of the centre brain at the stage's main target speed
  const gaits = evals.filter((e) => e.target === targets[0] && e.gait).map((e) => e.gait);
  if (gaits.length) {
    m.gait = {};
    for (const k of ['duty', 'flight', 'cadence', 'skip', 'steps']) m.gait[k] = +mean(gaits.map((g) => g[k])).toFixed(3);
    const dp = gaits.map((g) => g.dphi).filter((x) => x !== null);
    m.gait.dphi = dp.length ? +mean(dp).toFixed(3) : null;
  }
  if (cpgDim) m.cpg = { freq: +cpgFreq(evaluated).toFixed(3), dphi: +cpgDphi(evaluated).toFixed(3) };
  fs.appendFileSync(logFile, JSON.stringify(m) + '\n');
  log(`gen ${String(st.gen).padStart(5)} ${stage.name.padEnd(5)} fit ${m.fitness.toFixed(1).padStart(7)} pop ${m.popFitness.toFixed(1).padStart(7)} up ${(m.upFrac * 100).toFixed(0).padStart(3)}%/${(m.popUp * 100).toFixed(0).padStart(3)}% speed ${targets.map((t) => `${t}:${m.speed[t].toFixed(2)}`).join(' ')} |Δ| ${stepNorm.toFixed(3)} σ ${cfg.sigma.toFixed(4)}${m.gait ? ` steps ${m.gait.steps.toFixed(1)} duty ${m.gait.duty.toFixed(2)}` : ''}${m.cpg ? ` f ${m.cpg.freq} Δφ ${m.cpg.dphi}` : ''}${cfg.assist ? ` assist ${cfg.assist.toFixed(3)} bare ${(m.bare.upFrac * 100).toFixed(0)}%/${m.bare.speed.toFixed(2)}` : ''} ${m.secs.toFixed(1)}s`);
  // anneal the helping hand once the assisted brain copes: upright and at 60% of the target speed
  if (cfg.assist > 0 && m.upFrac >= 0.9 && m.speed[targets[0]] >= 0.6 * targets[0]) {
    cfg.assist *= 0.9;
    if (cfg.assist < 0.05) cfg.assist = 0;
  }
  // Survival-targeted sigma (after stand): keep 40-80% of the perturbed siblings upright, the band where
  // perturbations are risky but informative. Below it ES ranks fallers; above it, it explores too little.
  if (cfg.adaptSigma && st.stage > 0) {
    const k = m.popUp < 0.4 ? 0.85 : m.popUp > 0.8 ? 1.15 : 1;
    const kk = Math.min(k, cfg.sigmaMax / cfg.sigma); // capped: with the helping hand nearly every sibling survives
    cfg.sigma *= kk; cfg.cpgSigma *= kk;
    setScale();
  }

  const meta = { gen: st.gen, stage: stage.name, fitness: +m.fitness.toFixed(1), upFrac: +m.upFrac.toFixed(3), speed: m.speed,
    es: { seed: cfg.seed, noise: cfg.noise, sigma: m.sigma, cpgSigma: m.cpgSigma, pairs: cfg.pairs } };
  const graduated = stage.graduate(m) && !m.assist && st.stage < STAGES.length - 1;
  st.gen++;
  if (graduated) {
    publish({ ...meta, graduated: true }, evaluated, n);
    log(`*** graduated from ${stage.name} ***`);
    st.stage++;
    cfg.assist = cfg.assistStart; // each new stage starts with the helping hand again (stand never has it)
  }
  else if (st.gen % cfg.publishEvery === 1) publish(meta, evaluated, n);
  if (st.gen % cfg.saveEvery === 0) { saveBrain(path.join(dir, 'gens', `gen${String(meta.gen).padStart(5, '0')}.json`), meta, evaluated, n); checkpoint(); }
}
checkpoint();
saveBrain(path.join(dir, 'latest.json'), { gen: st.gen, stage: STAGES[st.stage].name });
log(`checkpointed at gen ${st.gen}`);
await Promise.all(workers.map((w) => w.terminate()));
