// The pre-registered Earth gate (docs/PREREG.md): a brain passes if, at a 1 m/s target with no pushes and
// no assistance, it stays upright for the whole 10 s and averages >= 0.8 m/s, on at least 8 of 10 fresh seeds.
// The experiment needs 8 of 10 *training seeds* to have such a brain.
//   node gate.mjs runs/Y runs/Z2 runs/S3 ...   (also NEAT run dirs, judged on their walk-graduate.json)
// Per run it judges the walk-stage graduate: the brain that passed the walk stage on *training* evals
// (docs/PREREG-AMENDMENT-2.md). The latest saved brain is reported too, for information only.
import R from '@dimforge/rapier3d-compat';
import fs from 'node:fs';
import path from 'node:path';
import { deserialize } from './src/mlp.js';
import { episode } from './src/task.js';
import { Genome } from './vendor/neat/genome.js';

await R.init();
const SEEDS = Array.from({ length: 10 }, (_, i) => 900001 + i); // never used in training (those come from seedHash)

export function gate(brain) {
  const eps = SEEDS.map((seed) => episode(R, brain, { stage: 2, seed, target: 1, pushScale: 0, gait: true }));
  const ok = eps.filter((e) => e.upFrac >= 0.999 && e.speed >= 0.8).length;
  const mean = (f) => eps.reduce((s, e) => s + f(e), 0) / eps.length;
  return { pass: ok >= 8, ok, speed: mean((e) => e.speed), upFrac: mean((e) => e.upFrac), duty: mean((e) => e.gait?.duty ?? 0) };
}

// The brain a run is judged on (amendment 2): its walk graduate, from brains/ (ES) or the run dir (NEAT).
// null if it has none yet.
export function graduate(dir) {
  const run = path.basename(dir), neat = path.join(dir, 'walk-graduate.json');
  if (fs.existsSync(neat)) { const n = JSON.parse(fs.readFileSync(neat, 'utf8')); return { name: `neat gen ${n.gen}`, gen: n.gen, brain: Genome.fromJSON(n.genome) }; }
  const index = JSON.parse(fs.readFileSync('brains/index.json', 'utf8'));
  const e = index.find((x) => x.run === run && x.stage === 'walk' && x.graduated);
  return e ? { name: e.file, gen: e.gen, brain: deserialize(fs.readFileSync(path.join('brains', e.file), 'utf8')) } : null;
}
export const lastGen = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).gen; } catch { return 0; } };

if (import.meta.main) {
const rows = [];
const fmt = (name, g) => `${name.padEnd(16)} ${g.pass ? 'PASS' : 'fail'}  ${g.ok}/10 seeds  speed ${g.speed.toFixed(2)}  upright ${(g.upFrac * 100).toFixed(0)}%  duty ${g.duty.toFixed(2)}`;
for (const dir of process.argv.slice(2)) {
  const run = path.basename(dir), grad = graduate(dir);
  rows.push(grad ? `${run.padEnd(4)} graduate ${fmt(grad.name, gate(grad.brain))}`
    : `${run.padEnd(4)} graduate (has not passed the walk stage yet${lastGen(dir) >= 1000 ? ': FAIL, budget of 1000 gens used (amendment 4)' : ''})`);
  const gens = fs.existsSync(path.join(dir, 'gens')) ? fs.readdirSync(path.join(dir, 'gens')).sort() : [];
  if (gens.length) rows.push(`${''.padEnd(4)} latest   ${fmt(gens.at(-1), gate(deserialize(fs.readFileSync(path.join(dir, 'gens', gens.at(-1)), 'utf8'))))}`);
}
console.log(rows.join('\n'));
}
