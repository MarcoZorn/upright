// Reading a run's log.jsonl and naming how it got stuck, shared by tools/status.mjs and tools/seeds.mjs.
import fs from 'node:fs';
import path from 'node:path';

// One parsed line per generation. Torn or zero-filled lines (a crash mid-write) are skipped, not fatal.
// age: seconds since the log was last written. null if the run has no log.
export function readLog(dir) {
  const f = path.join(dir, 'log.jsonl');
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { return null; }
  const logs = text.split('\n').flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
  return logs.length ? { logs, age: (Date.now() - fs.statSync(f).mtimeMs) / 1000 } : null;
}

// The stage's main target speed, and the brain's speed there on its own (bare evals while the help is on).
export const mainTarget = (l) => Object.keys(l.speed).map(Number).sort((a, b) => b - a)[0];
export const bareSpeed = (l) => (l.bare ? l.bare.speed : l.speed[mainTarget(l)]);

// The v1 failure modes (docs/GATE.md), named once a run has spent 200+ gens in one stage without leaving it.
// Returns '' for a run that is moving along.
export function diagnose(logs) {
  const last = logs.at(-1), since = logs.length - logs.findIndex((l) => l.stage === last.stage);
  if (since < 200 || last.stage === 'jog') return '';
  const recent = logs.slice(-50);
  if (last.stage === 'stand') return 'never balances well enough to leave stand';
  if (recent.every((l) => (l.assist ?? 0) > 0)) return 'help trap, leans on the help';
  if (recent.every((l) => bareSpeed(l) < 0.1)) return 'stands still without help';
  return 'slow progress';
}
