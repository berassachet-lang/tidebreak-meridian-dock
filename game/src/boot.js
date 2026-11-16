// TIDEBREAK — Meridian Dock. Boot: renderer, input, the fixed-step loop and
// the screenshot modes (?shot=menu|play|buy|plant) the maker uses to capture
// real renders of this code. The simulation runs at a fixed 60 Hz, apart
// from rendering; no frame ever allocates in the hot loop.
import * as THREE from 'three';
import { SIM_DT, SITES } from './config.js';
import { buildMap } from './map.js';
import { Player } from './player.js';
import { makeSquad } from './bots.js';
import { WeaponFX, GrenadeSim } from './weapons.js';
import { SoundBank } from './audio.js';
import { HUD } from './hud.js';
import { Game } from './game.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.className = 'webgl';
document.getElementById('app').prepend(renderer.domElement);

const scene = new THREE.Scene();
const map = buildMap(scene);
const player = new Player(scene, map.colliders);
const squad = makeSquad(scene, map.colliders, map.nodes);
const sound = new SoundBank();
const fx = new WeaponFX(scene);
const hud = new HUD(map);
const grenades = new GrenadeSim(scene, map.colliders, fx, (kind, pos, time) => game.detonateGrenade(kind, pos, time));
const game = new Game({
  scene, player, squad, fx, grenades, sound, hud,
  colliders: map.colliders, nodes: map.nodes,
});
window.__game = game;

window.addEventListener('resize', () => {
  player.camera.aspect = window.innerWidth / window.innerHeight;
  player.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------ input
const input = { f: false, b: false, l: false, r: false, crouch: false, use: false };
const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b',
  KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch', KeyE: 'use',
};
let shotMode = null;
try { shotMode = new URLSearchParams(window.location.search).get('shot'); } catch { shotMode = null; }

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const mapped = KEYMAP[e.code];
  if (mapped) { input[mapped] = true; e.preventDefault(); return; }
  if (e.code === 'KeyR') game.startReload(game.time);
  if (e.code === 'KeyB' && game.phase === 'buy') {
    const opening = !hud.buyOpen;
    hud.setBuyOpen(opening);
    // Pointer lock captures every click for the canvas: release it while
    // the buy menu is open so the player can actually click its items.
    if (opening && document.pointerLockElement) document.exitPointerLock();
  }
  if (e.code === 'KeyG') game.throwGrenade(game.time);
  if (e.code === 'Digit4') game.selectGrenade('frag');
  if (e.code === 'Digit5') game.selectGrenade('smoke');
  if (e.code === 'Digit1') game.switchWeapon(primaryOwned() ?? 'pistol');
  if (e.code === 'Digit2') game.switchWeapon('pistol');
  if (e.code === 'Digit3') {
    const primaries = ['carbine', 'scatter', 'smg'].filter((id) => game.owned.has(id));
    if (primaries.length > 1) game.switchWeapon(primaries.find((id) => id !== game.weaponId) ?? primaries[0]);
  }
  if (hud.buyOpen && /^Digit[1-6]$/.test(e.code)) {
    const buyIds = ['carbine', 'smg', 'scatter', 'armor', 'frag', 'smoke'];
    game.buy(buyIds[Number(e.code.slice(5)) - 1]);
  }
  if (e.code === 'Escape' && hud.buyOpen) hud.setBuyOpen(false);
});
window.addEventListener('keyup', (e) => {
  const mapped = KEYMAP[e.code];
  if (mapped) input[mapped] = false;
});
function primaryOwned() {
  for (const id of ['carbine', 'scatter', 'smg']) if (game.owned.has(id)) return id;
  return null;
}

hud.onBuy = (id) => game.buy(id);

document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement && player.alive) {
    player.look(e.movementX, e.movementY);
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (game.phase === 'live' || game.phase === 'buy') {
    if (document.pointerLockElement !== renderer.domElement && !shotMode) {
      renderer.domElement.requestPointerLock();
      return;
    }
    game.firing = true;
    game.tryFire(game.time);
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) game.firing = false;
});
window.addEventListener('blur', () => {
  input.f = input.b = input.l = input.r = input.crouch = input.use = false;
  game.firing = false;
});

// ------------------------------------------------------------ overlays
document.getElementById('play').addEventListener('click', () => {
  sound.unlock();
  document.getElementById('menu').classList.add('hidden');
  if (!game.started) game.startMatch();
  if (!shotMode) renderer.domElement.requestPointerLock();
});
document.getElementById('spectate').addEventListener('click', () => {
  document.getElementById('dead').classList.add('hidden');
  spectating = true;
});
document.getElementById('again').addEventListener('click', () => window.location.reload());

let spectating = false;
let spectateIdx = 0;

// ------------------------------------------------------------ shot modes
function facePlayerAt(x, z) {
  player.yaw = Math.atan2(-(x - player.pos.x), -(z - player.pos.z));
  player.pitch = 0;
}

function setupShotMode(mode) {
  document.getElementById('menu').classList.add('hidden');
  game.startMatch();
  const settle = (ms) => setTimeout(() => { window.__shotReady = true; }, ms);
  if (mode === 'menu') {
    document.getElementById('menu').classList.remove('hidden');
    game.phase = 'menu';
    hud.showHud(false);
    settle(1600);
    return;
  }
  if (mode === 'buy') {
    hud.setBuyOpen(true);
    settle(1600);
    return;
  }
  // live modes: skip the buy phase.
  game.phase = 'live';
  game.phaseT = 100;
  hud.setBuyOpen(false);
  if (mode === 'play') {
    player.pos.set(0, 0, 14);
    player.armor = 100;
    facePlayerAt(0, -14);
    // Two attackers in the mid lane, already engaging the player.
    const [b1, b2] = game.squad.tide;
    b1.pos.set(-3, 0, -6); b1.yaw = 0;
    b2.pos.set(4, 0, -8); b2.yaw = 0;
    for (const b of [b1, b2]) {
      b.seen = { fighter: player, at: game.time, pos: player.pos.clone() };
      b.reactUntil = game.time;
      b.state = 'engage';
      b.burstLeft = 4;
    }
    hud.setObjective('Defend Site A (Quay Gate) and Site B (Cold Store). Eliminate Tidebreak or stop the plant.');
    settle(2000);
    return;
  }
  if (mode === 'plant') {
    game.plantCharge(SITES.A, null);
    player.pos.set(-14, 0, -9);
    player.armor = 100;
    facePlayerAt(SITES.A.center[0], SITES.A.center[1]);
    const ally = game.squad.watch[0];
    ally.pos.set(-17, 0, -5);
    ally.yaw = Math.PI / 2;
    settle(2200);
  }
}

// ------------------------------------------------------------ main loop
let lastT = performance.now();
let acc = 0;
let simTime = 0;
let menuAngle = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  acc += frameDt;
  while (acc >= SIM_DT) {
    game.step(SIM_DT, input, simTime);
    simTime += SIM_DT;
    acc -= SIM_DT;
  }
  fx.update(frameDt);
  // Camera: orbit the dock on the menu, spectate an ally when dead, else FPS.
  if (game.phase === 'menu' && !game.started) {
    menuAngle += frameDt * 0.06;
    const cx = Math.sin(menuAngle) * 24, cz = Math.cos(menuAngle) * 18;
    player.camera.position.set(cx, 13, cz);
    player.camera.lookAt(0, 1, -4);
  } else if (spectating && !player.alive) {
    const alive = game.squad.watch.filter((b) => b.alive);
    if (alive.length) {
      const ally = alive[spectateIdx % alive.length];
      player.camera.position.set(ally.pos.x, ally.pos.y + 1.7, ally.pos.z);
      player.camera.rotation.set(ally.pitch, ally.yaw, 0);
    }
  } else {
    player.updateCamera(simTime);
  }
  // Buoys bob on the water.
  const buoys = map.group.userData.buoys || [];
  for (let i = 0; i < buoys.length; i++) {
    buoys[i].position.y = -0.1 + Math.sin(simTime * 1.1 + i * 2.1) * 0.12;
  }
  hud.drawMinimap(player, game.squad.watch, game.squad.tide, game.pings, simTime);
  renderer.render(scene, player.camera);
}

if (shotMode) setupShotMode(shotMode);
requestAnimationFrame(frame);
