// OpenAI-style evolution strategies (Salimans et al. 2017), pure functions, no physics.
import { mulberry32, gaussian } from './mlp.js';

// Shared noise table: a perturbation is an offset into it, so workers exchange integers, not 1.2 MB vectors.
export function makeNoise(size, seed, buffer = new ArrayBuffer(size * 4)) {
  const noise = new Float32Array(buffer);
  const rng = mulberry32(seed);
  for (let i = 0; i < size; i++) noise[i] = gaussian(rng);
  return noise;
}

// Ranks mapped to [-0.5, 0.5]: invariant to reward scale and robust to outliers.
export function centeredRanks(values) {
  const idx = [...values.keys()].sort((a, b) => values[a] - values[b]);
  const out = new Float32Array(values.length);
  const n = values.length;
  idx.forEach((i, r) => { out[i] = n > 1 ? r / (n - 1) - 0.5 : 0; });
  return out;
}

// pairs: [{ off, plus, minus }] with raw fitnesses. Returns the ascent direction estimate.
export function esGradient(dim, noise, pairs, sigma) {
  const ranks = centeredRanks(pairs.flatMap((p) => [p.plus, p.minus]));
  const g = new Float32Array(dim);
  for (let k = 0; k < pairs.length; k++) {
    const w = ranks[2 * k] - ranks[2 * k + 1], off = pairs[k].off;
    if (w === 0) continue;
    for (let i = 0; i < dim; i++) g[i] += w * noise[off + i];
  }
  const scale = 1 / (2 * pairs.length * sigma);
  for (let i = 0; i < dim; i++) g[i] *= scale;
  return g;
}

// Adam ascent with L2 weight decay folded into the gradient.
export function adamStep(theta, grad, st, { lr = 0.01, b1 = 0.9, b2 = 0.999, eps = 1e-8, l2 = 0.005 } = {}) {
  st.m ??= new Float32Array(theta.length);
  st.v ??= new Float32Array(theta.length);
  st.t = (st.t ?? 0) + 1;
  st.b1t = (st.b1t ?? 1) * b1; st.b2t = (st.b2t ?? 1) * b2; // running products: ** isn't bit-exact across engines
  const a = lr * Math.sqrt(1 - st.b2t) / (1 - st.b1t);
  let norm = 0;
  for (let i = 0; i < theta.length; i++) {
    const g = grad[i] - l2 * theta[i];
    st.m[i] = b1 * st.m[i] + (1 - b1) * g;
    st.v[i] = b2 * st.v[i] + (1 - b2) * g * g;
    const step = a * st.m[i] / (Math.sqrt(st.v[i]) + eps);
    theta[i] += step;
    norm += step * step;
  }
  return Math.sqrt(norm);
}

// Running observation statistics -> normalisation (std floored so constant inputs don't explode).
export function newStats(n) {
  return { count: 0, sum: new Float64Array(n), sumsq: new Float64Array(n) };
}
export function mergeStats(into, s) {
  into.count += s.count;
  for (let i = 0; i < into.sum.length; i++) { into.sum[i] += s.sum[i]; into.sumsq[i] += s.sumsq[i]; }
}
export function statsToNorm(s) {
  const n = s.sum.length, mean = new Float32Array(n), std = new Float32Array(n).fill(1);
  if (!s.count) return { mean, std };
  for (let i = 0; i < n; i++) {
    mean[i] = s.sum[i] / s.count;
    std[i] = Math.max(1e-2, Math.sqrt(Math.max(0, s.sumsq[i] / s.count - mean[i] * mean[i])));
  }
  return { mean, std };
}
