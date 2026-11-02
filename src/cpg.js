// Central pattern generator: a rhythmic backbone the brain's MLP corrects.
// action_j = offset_j + A_j * sin(phase + phi_j); the right leg mirrors the left with an extra phase dphi.
// Stride frequency f and inter-leg phase dphi are *learned* (init 1 Hz and pi = alternating walk), so a skip
// (dphi far from pi) or a faster cadence on the Moon is not ruled out by construction.
import { DOFS } from './body.js';

import { sinP, TWO_PI } from './trig.js';
export { sinP };

// Joint groups: centre joints get their own (A, phi, offset); each left joint has a right twin.
const centre = [], left = [], twin = new Map();
DOFS.forEach((d, i) => {
  if (d.joint.startsWith('pelvis-torso') || d.joint.startsWith('torso-head')) centre.push(i);
  else if (d.joint.includes('-l') || d.joint.startsWith('l')) left.push(i);
});
for (const i of left) {
  const name = DOFS[i].joint.replace(/(^|-)l/g, '$1r');
  twin.set(i, DOFS.findIndex((d) => d.joint === name && d.axis === DOFS[i].axis));
}
const AXIS_X = 3;
export const CPG_SIZE = 3 * (centre.length + left.length) + 2; // + frequency + inter-leg phase
const F = CPG_SIZE - 2, DPHI = CPG_SIZE - 1;

export const cpgFreq = (c) => Math.min(4, Math.max(0.3, 1 + c[F])); // Hz
export const cpgDphi = (c) => Math.PI * (1 + c[DPHI]); // rad

// Adds the CPG output for brain step `step` (30 Hz) into out.
export function cpgAct(c, step, out) {
  const phase = TWO_PI * cpgFreq(c) * step / 30, dphi = cpgDphi(c);
  let k = 0;
  for (const i of centre) { out[i] += c[k + 2] + c[k] * sinP(phase + c[k + 1]); k += 3; }
  for (const i of left) {
    const A = c[k], ph = c[k + 1], off = c[k + 2], j = twin.get(i);
    out[i] += off + A * sinP(phase + ph);
    // mirrored axes (twist/roll) flip sign on the right side, like the joint limits do
    const s = DOFS[i].axis === AXIS_X ? 1 : -1;
    out[j] += s * (off + A * sinP(phase + ph + dphi));
    k += 3;
  }
  return out;
}
