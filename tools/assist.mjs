// How the helping hand faded in the shuffle stage, per run, against generations spent in that stage.
// Shows the help trap (docs/DEVLOG.md): runs whose assist stops falling. Writes docs/assist.svg.
//   node tools/assist.mjs runs/S3 runs/S4 ... [--clock 6]   (--clock draws the v2 ceiling, docs/PREREG-V2.md)
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const ci = args.indexOf('--clock');
const clock = ci >= 0 ? +args.splice(ci, 2)[1] : 0;

const runs = args.map((dir) => {
  const logs = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const shuffle = logs.filter((l) => l.stage === 'shuffle');
  const after = logs.some((l) => l.stage === 'walk' || l.stage === 'jog');
  return { name: path.basename(dir), pts: shuffle.map((l, k) => [k, l.assist ?? 0]), graduated: after };
}).filter((r) => r.pts.length);

const W = 760, H = 380, L = 56, B = 46, T = 56, Rm = 64;
const xMax = Math.max(200, ...runs.map((r) => r.pts.length - 1));
const x = (k) => L + (k / xMax) * (W - L - Rm), y = (a) => H - B - a * (H - B - T);
const poly = (pts, attrs) => `<polyline fill="none" ${attrs} points="${pts.map(([k, a]) => `${x(k).toFixed(1)},${y(a).toFixed(1)}`).join(' ')}"/>`;
const clockPts = clock ? Array.from({ length: xMax + 1 }, (_, k) => { const a = 0.9 ** Math.floor(k / clock); return [k, a < 0.05 ? 0 : a]; }) : [];

// trapped runs in the accent colour and labelled at the line's end (nudged apart); runs that left shuffle in grey
const labels = runs.filter((r) => !r.graduated).map((r) => ({ r, ly: y(r.pts.at(-1)[1]) })).sort((a, b) => a.ly - b.ly);
for (let i = 1; i < labels.length; i++) labels[i].ly = Math.max(labels[i].ly, labels[i - 1].ly + 13);
const step = xMax > 400 ? 200 : 50;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,Menlo,monospace" font-size="12">
<rect width="${W}" height="${H}" fill="#14130f"/>
<text x="${L}" y="24" fill="#e9e4da" font-size="14">helping-hand strength in the shuffle stage</text>
<text x="${L}" y="42" fill="#8d877c">grey: ${runs.filter((r) => r.graduated).map((r) => r.name).join(' ')} (left shuffle) · orange: still helped at the budget${clock ? ` · dashed: v2 clock` : ''}</text>
${[0, 0.25, 0.5, 0.75, 1].map((a) => `<line x1="${L}" x2="${W - Rm}" y1="${y(a)}" y2="${y(a)}" stroke="#ffffff${a ? '14' : '33'}"/><text x="${L - 8}" y="${y(a) + 4}" fill="#8d877c" text-anchor="end">${a}</text>`).join('')}
${Array.from({ length: Math.floor(xMax / step) + 1 }, (_, i) => `<text x="${x(i * step)}" y="${H - B + 18}" fill="#8d877c" text-anchor="middle">${i * step}</text>`).join('')}
<text x="${(L + W - Rm) / 2}" y="${H - 8}" fill="#8d877c" text-anchor="middle">generations since entering the shuffle stage</text>
${clock ? poly(clockPts, 'stroke="#e9e4da" stroke-opacity="0.5" stroke-dasharray="4 4" stroke-width="1.5"') : ''}
${runs.map((r) => poly(r.pts, `stroke="${r.graduated ? '#8d877c' : '#f2a65a'}" stroke-width="2"`)).join('\n')}
${labels.map(({ r, ly }) => `<text x="${x(r.pts.length - 1) + 6}" y="${ly + 4}" fill="${r.graduated ? '#8d877c' : '#f2a65a'}">${r.name}</text>`).join('')}
</svg>`;
fs.writeFileSync('docs/assist.svg', svg);
console.log(runs.map((r) => `${r.name}: ${r.pts.length} gens in shuffle, last assist ${r.pts.at(-1)[1].toFixed(3)}`).join('\n'), '\n-> docs/assist.svg');
