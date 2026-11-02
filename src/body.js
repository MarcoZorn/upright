// Humanoid ragdoll: 15 rigid parts, 14 joints, 30 motorised degrees of freedom.
// Y is up, the body faces +Z, X is lateral (+X = the body's left).
// Every part spawns unrotated, so each joint frame is the world frame:
// AngX = flexion about the lateral axis, AngY = twist about vertical, AngZ = roll/abduction.
// Rapier is passed in so the same file runs in Node and in the browser.

const X = 3, Y = 4, Z = 5; // Rapier JointAxis.AngX/AngY/AngZ

// name: [shape, size, centre, mass]. box size = half extents, capsule = [halfHeight, radius], ball = [radius]
const PARTS = {
  pelvis:  ['box', [0.15, 0.07, 0.10], [0, 0.97, 0], 10],
  torso:   ['box', [0.17, 0.22, 0.10], [0, 1.27, 0], 20],
  head:    ['ball', [0.10], [0, 1.64, 0], 5],
};
for (const [s, x] of [['l', 1], ['r', -1]]) {
  Object.assign(PARTS, {
    [s + 'thigh']: ['capsule', [0.14, 0.07], [0.10 * x, 0.71, 0], 8],
    [s + 'shin']:  ['capsule', [0.16, 0.05], [0.10 * x, 0.29, 0], 4],
    [s + 'foot']:  ['box', [0.05, 0.03, 0.12], [0.10 * x, 0.03, 0.04], 2.5],
    [s + 'uarm']:  ['capsule', [0.095, 0.045], [0.22 * x, 1.31, 0], 2.5],
    [s + 'larm']:  ['capsule', [0.085, 0.04], [0.22 * x, 1.045, 0], 1.5],
    [s + 'hand']:  ['box', [0.025, 0.06, 0.04], [0.22 * x, 0.86, 0], 0.5],
  });
}

// [parent, child, anchor, {axis: [min, max]}, stiffness N·m/rad, max torque N·m]
// Limits are in radians of relative rotation child-vs-parent; sign conventions follow the right-hand rule.
const JOINTS = [
  ['pelvis', 'torso', [0, 1.05, 0], { [X]: [-0.4, 1.0], [Y]: [-0.6, 0.6], [Z]: [-0.4, 0.4] }, 600, 300],
  ['torso', 'head', [0, 1.52, 0], { [X]: [-0.6, 0.8], [Y]: [-1.0, 1.0], [Z]: [-0.5, 0.5] }, 60, 30],
];
for (const [s, x] of [['l', 1], ['r', -1]]) {
  const side = (lo, hi) => (x > 0 ? [lo, hi] : [-hi, -lo]); // mirror abduction/twist limits
  JOINTS.push(
    ['pelvis', s + 'thigh', [0.10 * x, 0.92, 0], { [X]: [-2.0, 0.5], [Y]: side(-0.6, 0.6), [Z]: side(-0.3, 0.8) }, 600, 300],
    [s + 'thigh', s + 'shin', [0.10 * x, 0.50, 0], { [X]: [0.0, 2.4] }, 500, 250],
    [s + 'shin', s + 'foot', [0.10 * x, 0.08, 0], { [X]: [-0.8, 0.5], [Z]: side(-0.4, 0.4) }, 1000, 300],
    ['torso', s + 'uarm', [0.22 * x, 1.45, 0], { [X]: [-2.8, 0.8], [Y]: side(-1.2, 1.2), [Z]: side(-0.2, 2.8) }, 100, 60],
    [s + 'uarm', s + 'larm', [0.22 * x, 1.17, 0], { [X]: [-2.5, 0.0] }, 60, 40],
    [s + 'larm', s + 'hand', [0.22 * x, 0.92, 0], { [X]: [-1.0, 1.0], [Z]: side(-0.4, 0.4) }, 10, 8],
  );
}

export const PART_NAMES = Object.keys(PARTS);
export const DOFS = JOINTS.flatMap(([p, c, , lim, kp, maxT]) =>
  Object.entries(lim).map(([axis, [lo, hi]]) => ({ joint: `${p}-${c}`, axis: +axis, lo, hi, kp, maxT })));
export { PARTS, JOINTS };

export function buildRagdoll(R, world, offset = [0, 0, 0]) {
  const bodies = {};
  for (const [name, [shape, size, c, mass]] of Object.entries(PARTS)) {
    const rb = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(c[0] + offset[0], c[1] + offset[1], c[2] + offset[2])
      .setLinearDamping(0.05).setAngularDamping(0.05));
    const cd = shape === 'box' ? R.ColliderDesc.cuboid(...size)
      : shape === 'capsule' ? R.ColliderDesc.capsule(...size)
      : R.ColliderDesc.ball(...size);
    world.createCollider(cd.setMass(mass).setFriction(0.9).setRestitution(0), rb);
    bodies[name] = rb;
  }

  const raw = world.impulseJoints.raw;
  const joints = [];
  for (const [p, c, a, lim] of JOINTS) {
    const free = Object.keys(lim).map(Number);
    let locked = 1 | 2 | 4; // LinX | LinY | LinZ
    for (const ax of [X, Y, Z]) if (!free.includes(ax)) locked |= 1 << ax;
    const pc = PARTS[p][2], cc = PARTS[c][2];
    const data = R.JointData.generic(
      { x: a[0] - pc[0], y: a[1] - pc[1], z: a[2] - pc[2] },
      { x: a[0] - cc[0], y: a[1] - cc[1], z: a[2] - cc[2] },
      { x: 1, y: 0, z: 0 }, locked);
    const j = world.createImpulseJoint(data, bodies[p], bodies[c], true);
    j.setContactsEnabled(false);
    joints.push({ handle: j.handle, parent: bodies[p], child: bodies[c] });
  }

  const dofs = DOFS.map((d) => {
    const j = joints[JOINTS.findIndex(([p, c]) => `${p}-${c}` === d.joint)];
    raw.jointSetLimits(j.handle, d.axis, d.lo, d.hi);
    raw.jointConfigureMotorModel(j.handle, d.axis, R.MotorModel.ForceBased);
    raw.jointSetMotorMaxForce(j.handle, d.axis, d.maxT);
    return { ...d, j };
  });

  return { bodies, joints, dofs, raw, offset };
}

// Brain output in [-1, 1] -> target angle; 0 maps to the rest (standing) pose.
export function act(rd, out) {
  for (let i = 0; i < rd.dofs.length; i++) {
    const d = rd.dofs[i];
    const o = Math.max(-1, Math.min(1, out[i]));
    const target = o < 0 ? -o * d.lo : o * d.hi;
    rd.raw.jointConfigureMotorPosition(d.j.handle, d.axis, target, d.kp, d.kp * 0.05);
  }
}

// q1^-1 * q2 for {x,y,z,w}
function relQuat(a, b) {
  const ax = -a.x, ay = -a.y, az = -a.z, aw = a.w;
  return {
    x: aw * b.x + ax * b.w + ay * b.z - az * b.y,
    y: aw * b.y - ax * b.z + ay * b.w + az * b.x,
    z: aw * b.z + ax * b.y - ay * b.x + az * b.w,
    w: aw * b.w - ax * b.x - ay * b.y - az * b.z,
  };
}
// v rotated by the inverse of q
function invRotate(q, v) {
  const x = -q.x, y = -q.y, z = -q.z, w = q.w;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + y * tz - z * ty, y: v.y + w * ty + z * tx - x * tz, z: v.z + w * tz + x * ty - y * tx };
}

export const OBS_SIZE = DOFS.length * 2 + 6 + 3 + 3 + 2 + 1 + 2 + 1;
export const CLOCK_PERIOD = 1.0; // s; a gait clock lets a memoryless MLP step rhythmically
// sin/cos of the 30 brain steps in one period, as literals: Math.sin/cos are left to each JS engine, a table is not.
const CLOCK = [[0,1],[0.20791169081775931,0.9781476007338057],[0.40673664307580015,0.9135454576426009],[0.5877852522924731,0.8090169943749475],[0.7431448254773942,0.6691306063588582],[0.8660254037844386,0.5000000000000001],[0.9510565162951535,0.30901699437494745],[0.9945218953682733,0.10452846326765346],[0.9945218953682734,-0.10452846326765333],[0.9510565162951536,-0.30901699437494734],[0.8660254037844387,-0.4999999999999998],[0.7431448254773945,-0.6691306063588579],[0.5877852522924732,-0.8090169943749473],[0.40673664307580004,-0.913545457642601],[0.20791169081775931,-0.9781476007338057],[5.66553889764798e-16,-1],[-0.20791169081775907,-0.9781476007338057],[-0.4067366430758002,-0.9135454576426009],[-0.587785252292473,-0.8090169943749475],[-0.743144825477394,-0.6691306063588585],[-0.8660254037844385,-0.5000000000000004],[-0.9510565162951535,-0.30901699437494756],[-0.9945218953682733,-0.10452846326765423],[-0.9945218953682734,0.10452846326765299],[-0.9510565162951536,0.30901699437494723],[-0.8660254037844386,0.5000000000000001],[-0.743144825477394,0.6691306063588585],[-0.5877852522924734,0.8090169943749473],[-0.40673664307580015,0.913545457642601],[-0.20791169081775898,0.9781476007338057]];

// Senses: joint angles + velocities, torso orientation (world up and forward seen from the torso),
// torso angular and linear velocity (torso frame, i.e. vestibular), a gait clock, pelvis height, foot contacts, target speed. No global position.
export function sense(rd, world, ground, targetSpeed, t, obs = new Float32Array(OBS_SIZE)) {
  let k = 0;
  for (const d of rd.dofs) {
    const q = relQuat(d.j.parent.rotation(), d.j.child.rotation());
    const s = q.w < 0 ? -1 : 1;
    const c = d.axis === X ? q.x : d.axis === Y ? q.y : q.z;
    obs[k++] = 2 * s * c; // ≈ angle (sin of the half angle ×2); asin would differ between JS engines
  }
  for (const d of rd.dofs) {
    const pw = d.j.parent.angvel(), cw = d.j.child.angvel();
    const rel = invRotate(d.j.parent.rotation(), { x: cw.x - pw.x, y: cw.y - pw.y, z: cw.z - pw.z });
    obs[k++] = 0.1 * (d.axis === X ? rel.x : d.axis === Y ? rel.y : rel.z);
  }
  const tq = rd.bodies.torso.rotation();
  const up = invRotate(tq, { x: 0, y: 1, z: 0 }), fw = invRotate(tq, { x: 0, y: 0, z: 1 });
  obs[k++] = up.x; obs[k++] = up.y; obs[k++] = up.z;
  obs[k++] = fw.x; obs[k++] = fw.y; obs[k++] = fw.z;
  const w = invRotate(tq, rd.bodies.torso.angvel());
  obs[k++] = 0.1 * w.x; obs[k++] = 0.1 * w.y; obs[k++] = 0.1 * w.z;
  const v = invRotate(tq, rd.bodies.torso.linvel());
  obs[k++] = v.x; obs[k++] = v.y; obs[k++] = v.z;
  const [cs, cc] = CLOCK[Math.round(t * 30 / CLOCK_PERIOD) % 30];
  obs[k++] = cs; obs[k++] = cc;
  obs[k++] = rd.bodies.pelvis.translation().y;
  obs[k++] = footContact(rd.bodies.lfoot, world, ground);
  obs[k++] = footContact(rd.bodies.rfoot, world, ground);
  obs[k++] = targetSpeed;
  return obs;
}

function footContact(foot, world, ground) {
  let touching = 0;
  world.contactPair(foot.collider(0), ground, (m) => { if (m.numContacts() > 0) touching = 1; });
  return touching;
}

// Fallen = pelvis low or head below pelvis height-ish.
export function fallen(rd) {
  return rd.bodies.pelvis.translation().y < 0.55 || rd.bodies.head.translation().y < 1.0;
}
