// One line per run: where it is in the curriculum, how much help it still gets, how it does on its own.
//   node tools/status.mjs runs/V1*
import fs from 'node:fs';
import path from 'node:path';

const pct = (v) => `${Math.round(v * 100)}%`.padStart(4);
const rows = [];
for (const dir of process.argv.slice(2)) {
  let lines, age;
  try {
    const f = path.join(dir, 'log.jsonl');
    lines = fs.readFileSync(f, 'utf8').trim().split('\n');
    age = (Date.now() - fs.statSync(f).mtimeMs) / 1000; // seconds since its last generation
  } catch { continue; }
  if (!lines[0]) continue;
  const logs = lines.map((l) => JSON.parse(l)), last = logs.at(-1);
  const since = logs.length - logs.findIndex((l) => l.stage === last.stage); // gens in the current stage
  const target = Object.keys(last.speed).map(Number).sort((a, b) => b - a)[0];
  const bare = last.bare ?? { upFrac: last.upFrac, speed: last.speed[target] };
  const grads = logs.flatMap((l, i) => (i && l.stage !== logs[i - 1].stage ? [`${logs[i - 1].stage}@${logs[i - 1].gen}`] : []));
  // finished (graduated walk with --until 3, or budget used), still going, or not running at all (a reboot)
  const secs = logs.slice(-10).reduce((t, l) => t + l.secs, 0) / Math.min(10, logs.length);
  const state = last.stage === 'jog' || last.gen >= 999 ? 'done' : age > Math.max(300, 5 * secs) ? 'STALLED' : `≤${((999 - last.gen) * secs / 3600).toFixed(1)}h left`;
  rows.push(`${path.basename(dir).padEnd(5)} ${state.padEnd(11)} gen ${String(last.gen).padStart(4)}  ${last.stage.padEnd(7)} ${String(since).padStart(4)} in stage  ` +
    `assist ${(last.assist ?? 0).toFixed(3)}  bare up ${pct(bare.upFrac)} ${bare.speed.toFixed(2)} m/s  σ ${last.sigma.toFixed(4)}  ${grads.join(' ')}`);
}
console.log(rows.join('\n') || 'no runs with logs');
