// ES vs NEAT on the walk task: forward speed at a 1 m/s target against episodes spent. Writes docs/es-vs-neat.svg.
//   node compare.mjs [runs/main/log.jsonl] [runs/neat-walk/log.jsonl]
import fs from 'node:fs';

const [esFile = 'runs/main/log.jsonl', neatFile = 'runs/neat-walk/log.jsonl'] = process.argv.slice(2);
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

// ES: count every episode from the start (stand stage included), plot only walk-stage evals of the centre brain.
let used = 0;
const es = [];
for (const l of read(esFile)) {
  used += 2 * 256 + 8 * Object.keys(l.speed).length;
  if (l.speed['1'] !== undefined) es.push([used, l.speed['1']]);
}
// NEAT: best genome of each generation (an optimistic measure: best of 256 on 2 episodes).
const neat = read(neatFile).map((l) => [l.episodes, l.speed ?? 0]);

const W = 720, H = 360, L = 60, B = 44, T = 40, Rm = 20;
const xMax = Math.max(1, ...es.map((p) => p[0]), ...neat.map((p) => p[0]));
const yMax = Math.max(1.2, ...es.map((p) => p[1]), ...neat.map((p) => p[1]));
const yMin = Math.min(0, ...es.map((p) => p[1]), ...neat.map((p) => p[1]));
const x = (v) => L + (v / xMax) * (W - L - Rm), y = (v) => H - B - ((v - yMin) / (yMax - yMin)) * (H - B - T);
const line = (pts, color) => pts.length ? `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts.map(([a, b]) => `${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(' ')}"/>` : '';
const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * xMax);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,Menlo,monospace" font-size="12">
<rect width="${W}" height="${H}" fill="#14130f"/>
<text x="${L}" y="24" fill="#e9e4da" font-size="14">forward speed with a 1 m/s target, vs episodes simulated</text>
<line x1="${L}" x2="${W - Rm}" y1="${y(1)}" y2="${y(1)}" stroke="#ffffff30" stroke-dasharray="4 4"/>
<text x="${W - Rm - 4}" y="${y(1) - 6}" fill="#8d877c" text-anchor="end">target</text>
<line x1="${L}" x2="${W - Rm}" y1="${y(0)}" y2="${y(0)}" stroke="#ffffff20"/>
${ticks.map((t) => `<text x="${x(t)}" y="${H - B + 18}" fill="#8d877c" text-anchor="middle">${t >= 1e6 ? (t / 1e6).toFixed(1) + 'M' : Math.round(t / 1e3) + 'k'}</text>`).join('')}
${[yMin, 0.5 * (yMin + yMax), yMax].map((v) => `<text x="${L - 8}" y="${y(v) + 4}" fill="#8d877c" text-anchor="end">${v.toFixed(1)}</text>`).join('')}
<text x="${(L + W) / 2}" y="${H - 8}" fill="#8d877c" text-anchor="middle">episodes (10 s each)</text>
${line(es, '#f2a65a')}${line(neat, '#7fb7a4')}
<text x="${L + 10}" y="${T + 14}" fill="#f2a65a">ES, 316k-param MLP (centre brain, 8 eval episodes)</text>
<text x="${L + 10}" y="${T + 30}" fill="#7fb7a4">NEAT (best genome of the generation)</text>
</svg>`;
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/es-vs-neat.svg', svg);
console.log(`ES ${es.length} points, NEAT ${neat.length} points -> docs/es-vs-neat.svg`);
