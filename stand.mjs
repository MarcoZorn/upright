// Headless smoke run: does the ragdoll stand with a zero brain (holds rest pose) and what does a random brain do?
import R from '@dimforge/rapier3d-compat';
import { rollout, zeroBrain, randomBrain, LAYERS } from './src/sim.js';
import { paramCount } from './src/mlp.js';

await R.init();
console.log(`brain ${LAYERS.join('-')} = ${paramCount(LAYERS)} params`);
for (const [name, brain] of [['zero', zeroBrain()], ...[1, 2, 3].map((s) => [`random#${s}`, randomBrain(s)])]) {
  const t0 = performance.now();
  const r = rollout(R, brain, { seconds: 10, stopOnFall: false });
  const ms = performance.now() - t0;
  console.log(`${name.padEnd(9)} up ${r.upTime.toFixed(2)}s  pelvis y ${r.pelvisY.toFixed(2)}  drift (${r.x.toFixed(2)}, ${r.z.toFixed(2)})  hash ${r.hash.toString(16)}  ${ms.toFixed(0)} ms`);
}
