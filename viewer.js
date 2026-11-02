// Browser viewer: same sim code as training, rendered with three.js.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import R from '@dimforge/rapier3d-compat';
import { PARTS, fallen, OBS_SIZE } from './src/body.js';
import { makeEnv, observe, stepEnv, stateHash, think, zeroBrain, randomBrain, DT, ACT_EVERY } from './src/sim.js';
import { deserialize } from './src/mlp.js';

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
const STAGE_SPEED = { stand: 0, walk: 1, run: 3 };
for (const [v, t] of options) select.add(new Option(t, v));
const gen = $('gen');
gen.max = Math.max(0, index.length - 1);
gen.value = gen.max;
const cache = new Map();
async function loadIndexed(i) {
  const e = index[i];
  if (!cache.has(e.file)) cache.set(e.file, deserialize(await (await fetch('brains/' + e.file)).text()));
  return cache.get(e.file);
}

// ---------- sim ----------
let env, brain, brainName, hash, upTime, wasDown, contacts, acc = 0, paused = false, follow = true;
let targetSpeed = 0;

function reset() {
  env?.world.free();
  env = makeEnv(R, { targetSpeed });
  hash = 0x811c9dc5; upTime = 0; wasDown = false; contacts = [0, 0]; acc = 0;
  for (const m of prints.splice(0)) scene.remove(m);
  $('fall').style.opacity = 0;
}

async function pickBrain() {
  const v = select.value;
  gen.disabled = v !== 'trained';
  if (v === 'zero') { brain = zeroBrain(); brainName = 'zero'; }
  else if (v.startsWith('random')) { brain = randomBrain(+v.split(':')[1]); brainName = v; }
  else if (v === 'trained') {
    brain = await loadIndexed(+gen.value);
    const e = index[+gen.value];
    brainName = `gen ${e.gen}`;
    $('genLabel').textContent = `${e.gen}${e.stage ? ' · ' + e.stage : ''}`;
    setTarget(STAGE_SPEED[e.stage] ?? 0);
    drawChart(e.gen);
  }
  reset();
}

function tick() {
  stepEnv(env, think(brain, observe(env)));
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

// ---------- ui ----------
function setTarget(v) {
  targetSpeed = v;
  $('ts').value = v;
  $('tsLabel').textContent = v.toFixed(1) + ' m/s';
  if (env) env.targetSpeed = v;
}
$('ts').oninput = () => setTarget(+$('ts').value);

// Training curve from the run's log (one JSON line per generation).
let log = [];
try {
  const runName = index.at(-1)?.run ?? 'main';
  log = (await (await fetch(`runs/${runName}/log.jsonl`)).text()).trim().split('\n').map((l) => JSON.parse(l));
} catch { /* no log yet */ }
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
drawChart();

const speed = () => 10 ** +$('speed').value;
$('speed').oninput = () => { $('speedLabel').textContent = speed().toFixed(2) + '×'; };
select.onchange = pickBrain;
gen.oninput = pickBrain;
$('reset').onclick = reset;
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'play' : 'pause'; };
$('follow').onclick = () => { follow = !follow; $('follow').textContent = `follow: ${follow ? 'on' : 'off'}`; };
$('push').onclick = () => {
  const a = Math.random() * Math.PI * 2;
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
});
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

function stats() {
  const p = env.rd.bodies.pelvis.translation();
  const rows = [
    ['brain', brainName], ['time', env.t.toFixed(2) + ' s'], ['upright', upTime.toFixed(2) + ' s'],
    ['pelvis height', p.y.toFixed(2) + ' m'], ['speed', env.rd.bodies.pelvis.linvel().z.toFixed(2) + ' m/s'], ['distance', Math.hypot(p.x, p.z).toFixed(2) + ' m'],
    ['feet', `${contacts[0] ? 'L' : '·'} ${contacts[1] ? 'R' : '·'}`], ['hash @ 10 s', env.hash10 ?? '…'],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
}

// ---------- loop ----------
const CTRL = DT * ACT_EVERY;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) {
    acc += dt * speed();
    while (acc >= CTRL) { tick(); acc -= CTRL; }
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
  requestAnimationFrame(frame);
}

if (index.length) { select.value = 'trained'; }
await pickBrain();
requestAnimationFrame(frame);
window.upright = { get env() { return env; }, reset, scene, camera, controls, renderer };
