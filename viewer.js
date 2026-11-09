// Browser viewer: same sim code as training, rendered with three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import R from '@dimforge/rapier3d-compat';
import { PARTS, fallen, OBS_SIZE } from './src/body.js';
import { makeEnv, observe, stepEnv, stateHash, think, zeroBrain, randomBrain, brainFreq, DT, ACT_EVERY } from './src/sim.js';
import { deserialize } from './src/mlp.js';
import { siblings, ghostEnvs } from './src/ghosts.js';

await R.init();
const $ = (id) => document.getElementById(id);

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14130f);
scene.fog = new THREE.Fog(0x14130f, 8, 30);

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
camera.position.set(2.6, 1.6, 3.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xfff3e0, 0x2a2620, 1.1));
const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
sun.position.set(3, 6, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 20 });
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x23211b, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(200, 200, 0x3a362d, 0x2b2822);
grid.position.y = 0.001;
scene.add(grid);

const skin = new THREE.MeshStandardMaterial({ color: 0xd9cfbf, roughness: 0.55 });
const accent = new THREE.MeshStandardMaterial({ color: 0xf2a65a, roughness: 0.5 });
const meshes = {};
for (const [name, [shape, s]] of Object.entries(PARTS)) {
  const geo = shape === 'box' ? new THREE.BoxGeometry(s[0] * 2, s[1] * 2, s[2] * 2)
    : shape === 'capsule' ? new THREE.CapsuleGeometry(s[1], s[0] * 2, 6, 16)
    : new THREE.SphereGeometry(s[0], 24, 16);
  const m = new THREE.Mesh(geo, /torso|head|foot/.test(name) ? accent : skin);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  meshes[name] = m;
}

// ---------- footprints ----------
const printGeo = new THREE.PlaneGeometry(0.1, 0.24).rotateX(-Math.PI / 2);
const prints = [];
function footprint(body) {
  const p = body.translation(), q = body.rotation();
  const m = new THREE.Mesh(printGeo, new THREE.MeshBasicMaterial({ color: 0xf2a65a, transparent: true, opacity: 0.55, depthWrite: false }));
  m.position.set(p.x, 0.002, p.z);
  m.quaternion.set(0, q.y, 0, q.w).normalize();
  scene.add(m);
  prints.push(m);
  if (prints.length > 300) scene.remove(prints.shift());
}

// ---------- brains ----------
let index = [];
try { index = await (await fetch('brains/index.json')).json(); } catch { /* no trained brains yet */ }
const select = $('brain');
const options = [['zero', 'zero: holds the rest pose'], ...[1, 2, 3, 4, 5].map((s) => [`random:${s}`, `random init, seed ${s}`])];
if (index.length) options.unshift(['trained', 'trained (pick generation)']);
const STAGE_SPEED = { stand: 0, shuffle: 0.4, walk: 1, jog: 2, run: 3 };
for (const [v, t] of options) select.add(new Option(t, v));
// one run at a time on the generation slider; the default is the run that got furthest (latest on ties)
const STAGE_ORDER = Object.keys(STAGE_SPEED), runSel = $('run'), gen = $('gen');
const runs = [...new Set(index.map((e) => e.run))];
const reach = (r) => Math.max(...index.filter((e) => e.run === r).map((e) => STAGE_ORDER.indexOf(e.stage)));
for (const r of runs) runSel.add(new Option(`${r} · reached ${STAGE_ORDER[reach(r)] ?? '?'}`, r));
runSel.value = runs.reduce((best, r) => (reach(r) >= reach(best) ? r : best), runs[0]);
let entries = [];
function pickRun() {
  entries = index.filter((e) => e.run === runSel.value);
  gen.max = Math.max(0, entries.length - 1);
  gen.value = gen.max;
}
if (runs.length) pickRun();
const current = () => entries[+gen.value];
const cache = new Map();
async function loadIndexed() {
  const e = current();
  if (!cache.has(e.file)) cache.set(e.file, deserialize(await (await fetch('brains/' + e.file)).text()));
  return cache.get(e.file);
}

// ---------- ES siblings ("ghosts") ----------
// The 16 perturbed brains ES sampled around this generation (8 antithetic pairs), walking alongside it.
let ghostsOn = false, ghostSibs = null, ghosts = [];
const ghostMats = Array.from({ length: 16 }, () => new THREE.MeshStandardMaterial({ color: 0x8d877c, transparent: true, opacity: 0.22, depthWrite: false }));
function clearGhosts() {
  for (const g of ghosts) { g.env.world.free(); for (const m of Object.values(g.meshes)) scene.remove(m); }
  ghosts = [];
}
function buildGhosts() {
  clearGhosts();
  if (!ghostsOn || !ghostSibs) return;
  ghosts = ghostEnvs(R, ghostSibs, targetSpeed, +$('grav').value).map((g, i) => {
    const gm = {};
    for (const name of Object.keys(PARTS)) { gm[name] = new THREE.Mesh(meshes[name].geometry, ghostMats[i]); scene.add(gm[name]); }
    return { ...g, meshes: gm };
  });
}
function prepareGhosts() {
  const e = select.value === 'trained' ? current() : null;
  $('ghosts').disabled = !e?.es;
  ghostSibs = null;
  if (ghostsOn && e?.es) ghostSibs = siblings(brain, e.gen, e.es, 8);
}

// ---------- sim ----------
let env, brain, brainName, hash, upTime, wasDown, contacts, acc = 0, paused = false, follow = true, tampered = false, kicks = 0;
let targetSpeed = 0;

function reset() {
  env?.world.free();
  env = makeEnv(R, { targetSpeed, gravity: +$('grav').value });
  env.freq = brainFreq(brain);
  hash = 0x811c9dc5; upTime = 0; wasDown = false; contacts = [0, 0]; acc = 0; tampered = false; kicks = 0;
  for (const m of prints.splice(0)) scene.remove(m);
  $('fall').style.opacity = 0;
  buildGhosts();
}

async function pickBrain() {
  const v = select.value;
  gen.disabled = runSel.disabled = v !== 'trained';
  if (v === 'zero') { brain = zeroBrain(); brainName = 'zero'; }
  else if (v.startsWith('random')) { brain = randomBrain(+v.split(':')[1]); brainName = v; }
  else if (v === 'trained') {
    brain = await loadIndexed();
    const e = current();
    brainName = `gen ${e.gen}`;
    $('genLabel').textContent = `${e.gen}${e.stage ? ' · ' + e.stage : ''}`;
    setTarget(e.proof?.target ?? STAGE_SPEED[e.stage] ?? 0);
    await loadLog(e.run);
    drawChart(e.gen);
  }
  prepareGhosts();
  reset();
}

function tick() {
  for (const g of ghosts) { g.env.targetSpeed = targetSpeed; stepEnv(g.env, think(g.brain, observe(g.env), g.env.step)); }
  stepEnv(env, think(brain, observe(env), env.step));
  hash = stateHash(env, hash);
  if (Math.abs(env.t - 10) < 1e-6) env.hash10 = hash.toString(16);
  const down = fallen(env.rd);
  if (!down && !wasDown) upTime = env.t;
  if (down && !wasDown) $('fall').style.opacity = 1;
  wasDown ||= down;
  const o = env.obs;
  for (const [k, foot] of [[OBS_SIZE - 3, 'lfoot'], [OBS_SIZE - 2, 'rfoot']]) {
    const c = o[k], i = foot === 'lfoot' ? 0 : 1;
    if (c && !contacts[i] && env.t > 0.2) footprint(env.rd.bodies[foot]);
    contacts[i] = c;
  }
}

// ---------- kick ----------
// Click (not drag) a body part to kick it along the view direction; counts as tampering for the replay check.
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const names = Object.keys(meshes), hit = ray.intersectObjects(names.map((n) => meshes[n]))[0];
  if (!hit) return;
  const name = names.find((n) => meshes[n] === hit.object), d = ray.ray.direction;
  const h = Math.hypot(d.x, d.z) || 1;
  env.rd.bodies[name].applyImpulseAtPoint({ x: (d.x / h) * 25, y: 0, z: (d.z / h) * 25 }, hit.point, true);
  tampered = true;
  kicks++;
});

// ---------- ui ----------
function setTarget(v) {
  targetSpeed = v;
  $('ts').value = v;
  $('tsLabel').textContent = v.toFixed(1) + ' m/s';
  if (env) { env.targetSpeed = v; if (env.step > 0) tampered = true; }
}
$('ts').oninput = () => setTarget(+$('ts').value);

// Training curve from the run's log (one JSON line per generation).
let log = [];
const logs = new Map();
async function loadLog(run) {
  if (!logs.has(run)) {
    try { logs.set(run, (await (await fetch(`runs/${run}/log.jsonl`)).text()).trim().split('\n').map((l) => JSON.parse(l))); }
    catch { logs.set(run, []); }
  }
  log = logs.get(run);
}
function drawChart(markGen) {
  if (!log.length) return;
  $('chartBox').style.display = 'block';
  const c = $('chart'), g = c.getContext('2d'), W = c.width, H = c.height, pad = 6;
  g.clearRect(0, 0, W, H);
  const n = log.length, fx = (i) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const fits = log.map((l) => l.fitness), lo = Math.min(...fits), hi = Math.max(...fits);
  const fy = (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const colors = { stand: '#f2a65a22', walk: '#7fb7a422', run: '#c97b9a22' };
  log.forEach((l, i) => { g.fillStyle = colors[l.stage] ?? '#ffffff11'; const h = l.upFrac * (H - 2 * pad); g.fillRect(fx(i) - 1, H - pad - h, Math.max(2, W / n), h); });
  g.strokeStyle = '#f2a65a'; g.lineWidth = 2; g.beginPath();
  log.forEach((l, i) => (i ? g.lineTo(fx(i), fy(l.fitness)) : g.moveTo(fx(i), fy(l.fitness))));
  g.stroke();
  if (markGen !== undefined) {
    const i = log.findIndex((l) => l.gen === markGen);
    if (i >= 0) { g.strokeStyle = '#e9e4da'; g.lineWidth = 1; g.beginPath(); g.moveTo(fx(i), 0); g.lineTo(fx(i), H); g.stroke(); }
  }
  g.fillStyle = '#8d877c'; g.font = '20px ui-monospace, monospace';
  g.fillText(`gen ${log.at(-1).gen}`, W - 130, 24);
}

const speed = () => 10 ** +$('speed').value;
$('speed').oninput = () => { $('speedLabel').textContent = speed().toFixed(2) + '×'; };
select.onchange = pickBrain;
gen.oninput = pickBrain;
runSel.onchange = () => { pickRun(); pickBrain(); };
$('reset').onclick = reset;
$('grav').onchange = reset;
$('ghosts').onclick = () => {
  ghostsOn = !ghostsOn;
  $('ghosts').textContent = ghostsOn ? 'ghosts: computing…' : 'ghosts: off';
  setTimeout(() => { prepareGhosts(); reset(); $('ghosts').textContent = `ghosts: ${ghostsOn ? 'on' : 'off'}`; }, 30);
};
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'play' : 'pause'; };
$('follow').onclick = () => { follow = !follow; $('follow').textContent = `follow: ${follow ? 'on' : 'off'}`; };
$('push').onclick = () => {
  const a = Math.random() * Math.PI * 2;
  tampered = true;
  env.rd.bodies.torso.applyImpulse({ x: Math.cos(a) * 40, y: 0, z: Math.sin(a) * 40 }, true);
};
$('load').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  brain = deserialize(await f.text());
  brainName = f.name;
  reset();
};
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); $('pause').click(); }
  if (e.key === 'r') reset();
  if (e.key === 'p') $('push').click();
  if (e.key === 'g' && !$('ghosts').disabled) $('ghosts').click();
});
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Proof of walk: a trained brain carries the hash of its 10 s replay from training; compare with ours.
function proofStatus() {
  const p = brain?.meta?.proof;
  if (!p) return '—';
  if (tampered || targetSpeed !== p.target || +$('grav').value !== (p.gravity ?? 9.81)) return 'n/a (pushed, or speed/gravity changed)';
  if (!env.hash10) return 'checking…';
  return env.hash10 === p.hash10 ? '✓ matches training' : '✗ differs from training';
}

function stats() {
  const p = env.rd.bodies.pelvis.translation();
  const rows = [
    ['brain', brainName], ['time', env.t.toFixed(2) + ' s'], ['upright', upTime.toFixed(2) + ' s'],
    ['pelvis height', p.y.toFixed(2) + ' m'], ['speed', env.rd.bodies.pelvis.linvel().z.toFixed(2) + ' m/s'], ['distance', Math.hypot(p.x, p.z).toFixed(2) + ' m'],
    ['feet', `${contacts[0] ? 'L' : '·'} ${contacts[1] ? 'R' : '·'}`], ['hash @ 10 s', env.hash10 ?? '…'], ['replay', proofStatus()], ['kicks', kicks],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
}

// ---------- loop ----------
function draw() {
  if (ghosts.length) {
    // fallen siblings go dark and faint; the upright ones are ranked by distance: top 4 orange, the rest sand
    ghosts.forEach((g) => { g.down ||= fallen(g.env.rd); });
    const up = ghosts.map((g, i) => [g.env.rd.bodies.pelvis.translation().z, i]).filter(([, i]) => !ghosts[i].down).sort((a, b) => b[0] - a[0]);
    ghosts.forEach((g, i) => { ghostMats[i].color.setHex(0x3a3732); ghostMats[i].opacity = 0.12; });
    up.forEach(([, i], r) => { ghostMats[i].color.setHex(r < 4 ? 0xf2a65a : 0xb9ad98); ghostMats[i].opacity = 0.24; });
    for (const g of ghosts) for (const [name, b] of Object.entries(g.env.rd.bodies)) {
      const p = b.translation(), q = b.rotation();
      g.meshes[name].position.set(p.x, p.y, p.z);
      g.meshes[name].quaternion.set(q.x, q.y, q.z, q.w);
    }
  }
  for (const [name, b] of Object.entries(env.rd.bodies)) {
    const p = b.translation(), q = b.rotation();
    meshes[name].position.set(p.x, p.y, p.z);
    meshes[name].quaternion.set(q.x, q.y, q.z, q.w);
  }
  const pel = env.rd.bodies.pelvis.translation();
  if (follow) {
    const d = new THREE.Vector3(pel.x, Math.max(0.5, pel.y), pel.z).sub(controls.target).multiplyScalar(0.08);
    controls.target.add(d);
    camera.position.add(d);
  }
  sun.position.set(pel.x + 3, 6, pel.z + 2);
  sun.target.position.set(pel.x, 0, pel.z);
  controls.update();
  renderer.render(scene, camera);
  stats();
}

const CTRL = DT * ACT_EVERY;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt * speed();
    while (acc >= CTRL) { tick(); acc -= CTRL; }
  }
  draw();
  requestAnimationFrame(frame);
}

if (index.length) { select.value = 'trained'; }
await pickBrain();
requestAnimationFrame(frame);
// Deterministic frame capture for README clips: one brain step per frame (30 fps = real time).
async function record({ seconds = 8, every = 1, quality = 0.85 } = {}) {
  paused = true;
  const frames = [];
  for (let f = 0; f < seconds * 30; f++) {
    tick();
    if (f % every) continue;
    draw();
    frames.push(renderer.domElement.toDataURL('image/jpeg', quality));
  }
  return frames;
}
// Same capture, but streamed to tools/framesink.mjs so frames never pass through anything else.
async function recordTo(url, { seconds = 8, quality = 0.9 } = {}) {
  paused = true;
  for (let f = 0; f < seconds * 30; f++) {
    tick();
    draw();
    const blob = await new Promise((r) => renderer.domElement.toBlob(r, 'image/jpeg', quality));
    await fetch(`${url}/frame/${f}`, { method: 'POST', body: blob });
  }
  return seconds * 30;
}
window.upright = { get env() { return env; }, reset, record, recordTo, setTarget, pickBrain, scene, camera, controls, renderer, $ };
