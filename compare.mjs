// Training progress of several runs on one chart: unassisted forward speed at the stage's main target
// against episodes simulated. Writes docs/progress.svg.
//   node compare.mjs runs/W:no-assist runs/Y:assist runs/X:assist+cpg
import fs from 'node:fs';

const COLORS = ['#8d877c', '#f2a65a', '#7fb7a4', '#c97b9a', '#9aa7e0'];
const series = process.argv.slice(2).map((arg, i) => {
  const [dir, label = dir] = arg.split(':');
  let episodes = 0;
  const pts = [], marks = [];
  let prevStage;
  for (const l of fs.readFileSync(`${dir}/log.jsonl`, 'utf8').trim().split('\n').map((x) => JSON.parse(x))) {
    const targets = Object.keys(l.speed);
    episodes += 2 * 256 + 8 * targets.length + (l.bare ? 4 : 0);
    const main = targets.map(Number).sort((a, b) => b - a)[0];
    // with the helping hand on, plot the bare (unassisted) evals; otherwise the normal evals are bare
    const speed = l.bare ? l.bare.speed : l.speed[String(main)];
    pts.push([episodes, speed, main]);
    if (l.stage !== prevStage) { marks.push([episodes, l.stage]); prevStage = l.stage; }
  }
  return { label, pts, marks, color: COLORS[i % COLORS.length] };
});

const W = 760, H = 380, L = 56, B = 46, T = 44, Rm = 24;
const xMax = Math.max(...series.flatMap((s) => s.pts.map((p) => p[0])));
const yMax = 1.1, yMin = -0.1;
const x = (v) => L + (v / xMax) * (W - L - Rm), y = (v) => H - B - ((v - yMin) / (yMax - yMin)) * (H - B - T);
// light smoothing (10-gen running mean) so the trend is readable; raw values are in the logs
const smooth = (pts) => pts.map((p, i) => {
  const w = pts.slice(Math.max(0, i - 9), i + 1);
  return [p[0], w.reduce((s, q) => s + q[1], 0) / w.length];
});
const line = (s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${smooth(s.pts).map(([a, b]) => `${x(a).toFixed(1)},${y(b).toFixed(1)}`).join(' ')}"/>`;
const fmt = (t) => (t >= 1e6 ? (t / 1e6).toFixed(1) + 'M' : Math.round(t / 1e3) + 'k');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="ui-monospace,Menlo,monospace" font-size="12">
<rect width="${W}" height="${H}" fill="#14130f"/>
<text x="${L}" y="24" fill="#e9e4da" font-size="14">unassisted forward speed vs episodes simulated (10-gen mean)</text>
${[0, 0.4, 1].map((v) => `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="#ffffff${v ? '22' : '33'}" stroke-dasharray="${v ? '4 4' : ''}"/><text x="${L - 8}" y="${y(v) + 4}" fill="#8d877c" text-anchor="end">${v}</text>`).join('')}
${[0, 0.25, 0.5, 0.75, 1].map((f) => `<text x="${x(f * xMax)}" y="${H - B + 18}" fill="#8d877c" text-anchor="middle">${fmt(f * xMax)}</text>`).join('')}
<text x="${(L + W) / 2}" y="${H - 8}" fill="#8d877c" text-anchor="middle">episodes (10 s each) · dashed: shuffle 0.4 m/s and walk 1 m/s targets</text>
${series.map(line).join('')}
${series.map((s, i) => `<text x="${L + 10}" y="${T + 14 + 16 * i}" fill="${s.color}">${s.label}</text>`).join('')}
</svg>`;
fs.writeFileSync('docs/progress.svg', svg);
console.log(series.map((s) => `${s.label}: ${s.pts.length} gens`).join(', '), '-> docs/progress.svg');
