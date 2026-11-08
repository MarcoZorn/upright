// One line per run: where it is in the curriculum, how much help it still gets, how it does on its own.
//   node tools/status.mjs runs/V1*
import fs from 'node:fs';
import path from 'node:path';

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const rows = [];
for (const dir of process.argv.slice(2)) {
  let lines;
  try { lines = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').trim().split('\n'); } catch { continue; }
  if (!lines[0]) continue;
  const logs = lines.map((l) => JSON.parse(l)), last = logs.at(-1);
  const since = logs.length - logs.findIndex((l) => l.stage === last.stage); // gens in the current stage
  const target = Object.keys(last.speed).map(Number).sort((a, b) => b - a)[0];
  const bare = last.bare ?? { upFrac: last.upFrac, speed: last.speed[target] };
  const grads = logs.flatMap((l, i) => (i && l.stage !== logs[i - 1].stage ? [`${logs[i - 1].stage}@${logs[i - 1].gen}`] : []));
  rows.push(`${path.basename(dir).padEnd(5)} gen ${String(last.gen).padStart(4)}  ${last.stage.padEnd(7)} ${String(since).padStart(4)} in stage  ` +
    `assist ${(last.assist ?? 0).toFixed(3)}  bare up ${pct(bare.upFrac)} ${bare.speed.toFixed(2)} m/s  σ ${last.sigma.toFixed(4)}  ${grads.join(' ')}`);
}
console.log(rows.join('\n') || 'no runs with logs');
