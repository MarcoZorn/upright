// Gait instruments from foot-contact sequences (one 0/1 sample per brain step for each foot).
//   duty     fraction of time a foot is on the ground (walk > 0.5, run < 0.5)
//   flight   fraction of time both feet are in the air (0 for a walk, > 0 for a run or skip)
//   cadence  touchdowns per second, both feet together
//   dphi     phase of right touchdowns within the left stride, in radians (pi = alternating, 0 = hopping together)
//   skip     fraction of touchdowns that repeat the previous foot (L L R R ... instead of L R L R)
//   froude   v^2 / (g * L) with leg length L = hip height 0.92 m
export const LEG = 0.92;

export function analyzeGait(left, right, dt, speed = 0, gravity = 9.81) {
  const n = Math.min(left.length, right.length);
  if (n < 2) return null;
  let onL = 0, onR = 0, flight = 0;
  const td = []; // [time, foot]
  for (let i = 0; i < n; i++) {
    onL += left[i]; onR += right[i];
    if (!left[i] && !right[i]) flight++;
    if (i > 0 && left[i] && !left[i - 1]) td.push([i * dt, 0]);
    if (i > 0 && right[i] && !right[i - 1]) td.push([i * dt, 1]);
  }
  td.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let repeats = 0;
  for (let k = 1; k < td.length; k++) if (td[k][1] === td[k - 1][1]) repeats++;
  // inter-leg phase: for each right touchdown, where it falls between the surrounding left touchdowns
  const lt = td.filter((t) => t[1] === 0).map((t) => t[0]), rt = td.filter((t) => t[1] === 1).map((t) => t[0]);
  const phases = [];
  for (const t of rt) {
    const k = lt.findIndex((x) => x > t);
    if (k > 0) phases.push(((t - lt[k - 1]) / (lt[k] - lt[k - 1])) * 2 * Math.PI);
  }
  const T = n * dt;
  return {
    duty: (onL + onR) / (2 * n),
    flight: flight / n,
    cadence: td.length / T,
    dphi: phases.length ? phases.reduce((s, x) => s + x, 0) / phases.length : null,
    skip: td.length > 1 ? repeats / (td.length - 1) : 0,
    steps: td.length,
    froude: (speed * speed) / (gravity * LEG),
  };
}
