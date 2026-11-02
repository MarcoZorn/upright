// Plain MLP, tanh everywhere, all parameters in one Float32Array so ES can perturb it as a flat vector.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

export function paramCount(layers) {
  let n = 0;
  for (let i = 1; i < layers.length; i++) n += layers[i - 1] * layers[i] + layers[i];
  return n;
}

// zeroLast: output layer starts at 0, so a fresh brain outputs the rest pose (it stands) instead of flailing.
export function createMLP(layers, seed = 1, { zeroLast = false } = {}) {
  const params = new Float32Array(paramCount(layers));
  const rng = mulberry32(seed);
  let k = 0;
  for (let i = 1; i < layers.length; i++) {
    const std = 1 / Math.sqrt(layers[i - 1]);
    const last = zeroLast && i === layers.length - 1;
    for (let j = 0; j < layers[i - 1] * layers[i]; j++) params[k++] = last ? 0 : gaussian(rng) * std;
    k += layers[i]; // biases start at 0
  }
  return { layers, params };
}

// Scratch buffers are cached per layer shape so forward() allocates nothing after the first call.
export function forward(mlp, input) {
  const { layers, params } = mlp;
  mlp._buf ??= layers.map((n) => new Float32Array(n));
  let x = input, k = 0;
  for (let i = 1; i < layers.length; i++) {
    const nIn = layers[i - 1], nOut = layers[i], y = mlp._buf[i];
    const bias = k + nIn * nOut;
    for (let o = 0; o < nOut; o++) {
      let s = params[bias + o];
      const row = k + o * nIn;
      for (let j = 0; j < nIn; j++) s += params[row + j] * x[j];
      y[o] = Math.tanh(s);
    }
    k = bias + nOut;
    x = y;
  }
  return x;
}

export function toB64(f32) {
  const bytes = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

// Brain file: JSON with layer sizes, metadata, optional input normalisation, parameters as base64 float32.
export function serialize(mlp, meta = {}) {
  const norm = mlp.norm && { mean: toB64(mlp.norm.mean), std: toB64(mlp.norm.std) };
  return JSON.stringify({ layers: mlp.layers, meta, norm, params: toB64(mlp.params) });
}

export function deserialize(text) {
  const { layers, meta, norm, params } = JSON.parse(text);
  return { layers, meta, params: fromB64(params), norm: norm && { mean: fromB64(norm.mean), std: fromB64(norm.std) } };
}
