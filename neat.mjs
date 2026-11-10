// NEAT baseline on the same body, task and fitness as ES, using the engine from my neat-from-scratch repo.
//   node neat.mjs --run runs/neat [--fresh] [--gens N] [--pop 256] [--workers N] [--stage 0] [--until 3] [--assistPeriod 6]
//     [--initWeight 1 --weightStep 0.4 --pWeight 0.8 --pWeightReplace 0.1]  mutation scale; the vendored defaults suit
//     small game nets, not 2370 connections (each mutation moves ~1900 weights), so these are swept (docs/DEVLOG.md)
// Logs episodes used per generation, so compare.mjs can put it on the same x axis as ES.
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Population } from './vendor/neat/neat.js';
import { OBS_SIZE, DOFS } from './src/body.js';
import { STAGES, assistCap } from './src/task.js';

try { os.setPriority(19); } catch { /* lowest priority */ }
const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((s) => s.trim().split(/\s+/)).map(([k, v]) => [k, v ?? true]));
const dir = args.run ?? 'runs/neat', seedsPerGenome = +(args.episodes ?? 2), until = +(args.until ?? 3);
const workersN = +(args.workers ?? Math.max(1, Math.floor(os.cpus().length * 0.7) - 1));
const stateFile = path.join(dir, 'state.json'), logFile = path.join(dir, 'log.jsonl');
fs.mkdirSync(dir, { recursive: true });
if (args.fresh) for (const f of [stateFile, logFile]) fs.rmSync(f, { force: true });

const saved = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : null;
// curriculum as in train.mjs: same stages and graduation tests. The helping hand, if any, is the v2 clock alone
// (docs/PREREG-V2.md): NEAT has no bare evals to drive train.mjs's performance rule.
const cur = saved?.curriculum ?? { stage: +(args.stage ?? 0), stageStart: 0, assistPeriod: +(args.assistPeriod ?? 0) };
const pop = saved
  ? Population.fromJSON(saved)
  : new Population(OBS_SIZE, DOFS.length, { popSize: +(args.pop ?? 256),
    ...Object.fromEntries(['initWeight', 'weightStep', 'pWeight', 'pWeightReplace'].filter((k) => k in args).map((k) => [k, +args[k]])) }, +(args.seed ?? 1));
// As in train.mjs: the log can run ahead of the state (saved every 10 gens) and a crash can leave a torn last
// line. Keep whole lines from before the saved generation; the rest are rerun.
let episodes = 0;
if (fs.existsSync(logFile)) {
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter((l) => l.trim());
  const keep = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m && m.gen < pop.generation);
  if (keep.length < lines.length) {
    fs.writeFileSync(logFile + '.tmp', keep.map((m) => JSON.stringify(m) + '\n').join(''));
    fs.renameSync(logFile + '.tmp', logFile);
  }
  episodes = keep.at(-1)?.episodes ?? 0;
}

const dummy = new SharedArrayBuffer(OBS_SIZE * 8);
const workers = Array.from({ length: workersN }, () => new Worker(new URL('./src/worker.mjs', import.meta.url),
  { workerData: { noiseBuf: dummy, thetaBuf: dummy, normBuf: dummy, layers: [] } }));
const runJobs = (jobs) => new Promise((resolve, reject) => {
  const out = new Array(jobs.length);
  let next = 0, done = 0;
  const feed = (w) => { if (next < jobs.length) w.postMessage({ ...jobs[next], id: next++ }); };
  for (const w of workers) {
    w.removeAllListeners('message').removeAllListeners('error');
    w.on('message', (m) => { out[m.id] = m.res; if (++done === jobs.length) resolve(out); else feed(w); });
    w.on('error', reject);
    feed(w);
  }
});

let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
const end = pop.generation + +(args.gens ?? Infinity);
const save = () => fs.writeFileSync(stateFile, JSON.stringify({ ...pop.toJSON(), curriculum: cur }));
while (!stopping && pop.generation < end && cur.stage < until) {
  const t0 = performance.now();
  // Every genome in a generation faces the same seeds (same pushes), like an ES antithetic pair.
  const seeds = Array.from({ length: seedsPerGenome }, (_, i) => (pop.generation * 7919 + i * 104729 + 1) >>> 0);
  const { stage } = cur, target = STAGES[stage].targets[0][0];
  const assist = (stage === 1 || stage === 2) && cur.assistPeriod ? assistCap(pop.generation - cur.stageStart, cur.assistPeriod) : 0;
  const res = await runJobs(pop.genomes.map((g) => ({ genome: g.toJSON(), seeds, stage, target, assist })));
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const fits = res.map((r) => mean(r.map((e) => e.fitness))), lo = Math.min(...fits);
  fits.forEach((f, i) => { pop.genomes[i].fitness = f - lo + 1; }); // NEAT's fitness sharing wants positive fitness
  episodes += res.length * seedsPerGenome;
  const bestI = res.reduce((b, r, i) => (mean(r.map((e) => e.fitness)) > mean(res[b].map((e) => e.fitness)) ? i : b), 0);
  const best = res[bestI], cx = pop.genomes[bestI].complexity();
  const m = { gen: pop.generation, episodes, best: mean(best.map((e) => e.fitness)), mean: mean(res.flat().map((e) => e.fitness)),
    stage: STAGES[stage].name, assist, upFrac: mean(best.map((e) => e.upFrac)), popUp: mean(res.flat().map((e) => e.upFrac)),
    speed: { [target]: mean(best.map((e) => e.speed)) }, nodes: cx.nodes, conns: cx.conns, secs: (performance.now() - t0) / 1000 };
  fs.appendFileSync(logFile, JSON.stringify(m) + '\n');
  console.log(`neat gen ${String(m.gen).padStart(4)} ${m.stage.padEnd(7)} best ${m.best.toFixed(1).padStart(7)} mean ${m.mean.toFixed(1).padStart(7)} up ${(m.upFrac * 100).toFixed(0)}%/${(m.popUp * 100).toFixed(0)}% speed ${m.speed[target].toFixed(2)}${assist ? ` assist ${assist.toFixed(3)}` : ''} nodes ${cx.nodes} conns ${cx.conns} ${m.secs.toFixed(1)}s`);
  // graduation as in train.mjs, never while helped. A best-of-population score on 2 episodes is optimistic, so a
  // candidate is re-run on 8 fresh seeds (train.mjs's eval count) and judged on those, like ES's evals.
  if (!assist && STAGES[stage].graduate(m)) {
    const evalSeeds = Array.from({ length: 8 }, (_, i) => (pop.generation * 7919 + i * 104729 + 1e6 + 1) >>> 0);
    const ev = (await runJobs([{ genome: pop.genomes[bestI].toJSON(), seeds: evalSeeds, stage, target }]))[0];
    const e = { ...m, upFrac: mean(ev.map((x) => x.upFrac)), speed: { [target]: mean(ev.map((x) => x.speed)) } };
    episodes += evalSeeds.length;
    if (STAGES[stage].graduate(e)) {
      console.log(`*** graduated from ${STAGES[stage].name} (8 eval seeds: up ${(e.upFrac * 100).toFixed(0)}%, ${e.speed[target].toFixed(2)} m/s) ***`);
      fs.writeFileSync(path.join(dir, `${STAGES[stage].name}-graduate.json`), JSON.stringify({ gen: m.gen, episodes, genome: pop.genomes[bestI].toJSON() }));
      cur.stage++; cur.stageStart = pop.generation + 1;
    } else console.log(`    candidate failed its 8 eval seeds: up ${(e.upFrac * 100).toFixed(0)}%, ${e.speed[target].toFixed(2)} m/s`);
  }
  pop.evolve();
  if (pop.generation % 10 === 0) save();
}
save();
await Promise.all(workers.map((w) => w.terminate()));
