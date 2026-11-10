// Every seed's path through the curriculum on one chart: a bar per run across its generations, coloured by
// stage, pale while the helping hand is on, with the gate outcome from docs/GATE.md at the end.
//   node tools/seeds.mjs runs/Y runs/Z runs/S3 ... [--out docs/seeds.svg] [--title "..."]
import fs from 'node:fs';
import path from 'node:path';
import { readLog, diagnose } from './runlog.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args.splice(i, 2)[1]; };
const out = opt('--out', 'docs/seeds.svg'), title = opt('--title', 'each seed through the curriculum, and its Earth gate result');

// outcomes as recorded in the gate tally: "| 3 | S3 | gen 459 | **pass** | 10/10 | 0.90 |"
const outcome = new Map(), score = new Map();
for (const m of fs.readFileSync('docs/GATE.md', 'utf8').matchAll(/^\| \d+ \| (\w+) \|[^|]*\| \**(pass|fail)[^|]*\| (\d+\/10)/gm)) {
  outcome.set(m[1], m[2]);
  score.set(m[1], m[3]);
}
const SHORT = { 'never balances well enough to leave stand': 'never left stand', 'help trap, leans on the help': 'help trap',
  'stands still without help': 'stands still', 'slow progress': 'slow' };

const BUDGET = 1000, COLORS = { stand: '#f2a65a', shuffle: '#d8d2c6', walk: '#7fb7a4', jog: '#9aa7e0', run: '#c97b9a' };
const runs = args.map((dir) => ({ name: path.basename(dir), logs: readLog(dir)?.logs ?? [] })).filter((r) => r.logs.length);

const W = 760, L = 56, Rm = 190, T = 52, ROW = 24, H = T + runs.length * ROW + 40;
const x = (g) => L + (Math.min(g, BUDGET) / BUDGET) * (W - L - Rm);
const bars = runs.map((r, i) => {
  const y = T + i * ROW, rects = [];
  // one rect per run of generations with the same stage and help on/off
  let start = 0;
  for (let k = 1; k <= r.logs.length; k++) {
    const a = r.logs[start], b = r.logs[k];
    if (b && b.stage === a.stage && (b.assist > 0) === (a.assist > 0) && b.gen < BUDGET) continue;
    if (a.gen < BUDGET) rects.push(`<rect x="${x(a.gen).toFixed(1)}" y="${y}" width="${Math.max(1, x(r.logs[k - 1].gen + 1) - x(a.gen)).toFixed(1)}" height="${ROW - 8}" fill="${COLORS[a.stage] ?? '#888'}" fill-opacity="${a.assist > 0 ? 0.35 : 0.95}"/>`);
    start = k;
  }
  // a run that never graduated walk is named by how it got stuck; one that did, by its graduate's gate score
  const res = outcome.get(r.name), why = SHORT[diagnose(r.logs.filter((l) => l.gen < BUDGET))];
  const label = !res ? 'training' : `${res}: ${why ?? `${score.get(r.name)} gate seeds`}`;
  return `<text x="${L - 8}" y="${y + 12}" fill="#e9e4da" text-anchor="end">${r.name}</text>${rects.join('')}` +
    `<text x="${W - Rm + 10}" y="${y + 12}" fill="${res === 'pass' ? '#7fb7a4' : res === 'fail' ? '#f2a65a' : '#8d877c'}">${label}</text>`;
});

const legend = Object.entries(COLORS).slice(0, 4).map(([s, c], i) => `<rect x="${L + i * 90}" y="${H - 22}" width="12" height="12" fill="${c}"/><text x="${L + i * 90 + 17}" y="${H - 12}" fill="#8d877c">${s}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,Menlo,monospace" font-size="12">
<rect width="${W}" height="${H}" fill="#14130f"/>
<text x="${L}" y="22" fill="#e9e4da" font-size="14">${title}</text>
<text x="${L}" y="40" fill="#8d877c">generations 0 to ${BUDGET} (the budget); pale = helping hand on</text>
${[0, 250, 500, 750, 1000].map((g) => `<line x1="${x(g)}" x2="${x(g)}" y1="${T - 4}" y2="${T + runs.length * ROW - 4}" stroke="#ffffff${g === BUDGET ? '44' : '14'}"/>`).join('')}
${bars.join('\n')}
${[0, 500, 1000].map((g) => `<text x="${x(g)}" y="${T + runs.length * ROW + 10}" fill="#8d877c" text-anchor="middle">${g}</text>`).join('')}
${legend}
<text x="${L + 380}" y="${H - 12}" fill="#8d877c">reproduce: node tools/seeds.mjs</text>
</svg>`;
fs.writeFileSync(out, svg);
console.log(runs.map((r) => `${r.name}: ${outcome.get(r.name) ?? 'training'}`).join(', '), `-> ${out}`);
