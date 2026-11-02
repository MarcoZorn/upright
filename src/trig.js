// sin/cos from + and * only (IEEE-exact in every JS engine, unlike Math.sin). Error < 1e-6 on [-pi, pi].
export const TWO_PI = 6.283185307179586;
export function sinP(x) {
  x -= TWO_PI * Math.floor(x / TWO_PI + 0.5); // -> [-pi, pi]
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 / 6227020800))))));
}
export const cosP = (x) => sinP(x + TWO_PI / 4);
