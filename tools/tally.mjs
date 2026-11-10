// Fills in docs/GATE.md rows for finished runs, straight from the gate, so no number is copied by hand.
// A run is finished when it has a walk graduate (judged by gate.mjs) or has used its 1000-gen budget (fail).
// Runs still training keep their row as it is.
//   node tools/tally.mjs runs/V1* runs/V20 [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { gate, graduate, lastGen } from '../gate.mjs';
import { readLog, diagnose } from './runlog.mjs';

const args = process.argv.slice(2), dry = args.includes('--dry-run');
let doc = fs.readFileSync('docs/GATE.md', 'utf8');
for (const dir of args.filter((a) => !a.startsWith('--'))) {
  const run = path.basename(dir), grad = graduate(dir);
  let cells;
  if (grad) {
    const g = gate(grad.brain);
    cells = [`gen ${grad.gen}`, g.pass ? '**pass**' : 'fail', `${g.ok}/10`, g.speed.toFixed(2)];
  } else if (lastGen(dir) >= 1000) {
    const why = diagnose(readLog(dir)?.logs ?? []) || 'no walk graduate';
    cells = [`none: ${why} at gen 1000`, 'fail (budget)', '0/10', '–'];
  } else continue;
  const row = new RegExp(`^\\| (\\d+) \\| ${run} \\|.*$`, 'm');
  if (!row.test(doc)) { console.log(`${run}: no row in GATE.md`); continue; }
  doc = doc.replace(row, (_, seed) => `| ${seed} | ${run} | ${cells.join(' | ')} |`);
  console.log(`${run}: ${cells.join(' | ')}`);
}
if (!dry) fs.writeFileSync('docs/GATE.md', doc);
