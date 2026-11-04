// The ES population around one generation, rebuilt exactly as train.mjs sampled it: same noise table,
// same offsets, same sigma. Each sibling is the centre brain +/- sigma * noise[offset...]; this is what the
// gradient of that generation was estimated from. (Siblings here walk without pushes and at the viewer's
// target speed, so their episodes are not the training episodes, only their brains are.)
import { makeNoise, seedHash } from './es.js';
import { mulberry32 } from './mlp.js';
import { makeEnv, brainFreq } from './sim.js';

let noiseCache = null;

// run: { seed, noise, sigma, cpgSigma } of the training run at that generation.
export function siblings(brain, gen, run, pairs = 8) {
  const full = brain.full ?? brain.params, dim = full.length, cpgDim = brain.cpg ? brain.cpg.length : 0;
  if (!noiseCache || noiseCache.length !== run.noise) noiseCache = makeNoise(run.noise, 12345);
  const noise = noiseCache, rng = mulberry32(seedHash(run.seed, gen));
  const out = [];
  for (let k = 0; k < pairs; k++) {
    const off = Math.floor(rng() * (run.noise - dim));
    for (const sign of [1, -1]) {
      const p = new Float32Array(dim);
      for (let i = 0; i < dim; i++) {
        const scale = i < cpgDim ? Math.fround(run.cpgSigma / run.sigma) : 1; // float32, as in train.mjs
        p[i] = full[i] + sign * run.sigma * scale * noise[off + i];
      }
      const b = cpgDim
        ? { layers: brain.layers, norm: brain.norm, full: p, cpg: p.subarray(0, cpgDim), params: p.subarray(cpgDim) }
        : { layers: brain.layers, norm: brain.norm, params: p };
      out.push({ brain: b, k, sign });
    }
  }
  return out;
}

export function ghostEnvs(R, sibs, targetSpeed, gravity) {
  return sibs.map((s) => {
    const env = makeEnv(R, { targetSpeed, gravity });
    env.freq = brainFreq(s.brain);
    return { ...s, env, down: false };
  });
}
