// Gunplay: hitscan fire with head/body hitboxes, recoil and spread, tracer
// lines, a reusable muzzle flash, and ballistic frag/smoke grenades. All
// ray tests are slab tests against the map's AABBs and the fighters'
// hitboxes — no three.js Raycaster, no per-shot allocation.
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './config.js';

// ---------------------------------------------------------------- ray math
// Slab test: ray origin o, direction d (normalized), box [min,max]. Returns
// the smallest t >= 0 of the hit, or Infinity.
export function rayAABB(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  let t0 = 0, t1 = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [minX, minY, minZ], hi = [maxX, maxY, maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
    } else {
      let ta = (lo[i] - o[i]) / d[i];
      let tb = (hi[i] - o[i]) / d[i];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}

/** First solid the ray meets: walls (top > 0.4) and the floor. Returns t. */
export function rayWalls(ox, oy, oz, dx, dy, dz, colliders, maxDist) {
  let best = maxDist;
  for (const c of colliders) {
    if (c.top < 0.4) continue;
    const t = rayAABB(ox, oy, oz, dx, dy, dz, c.minX, 0, c.minZ, c.maxX, c.top, c.maxZ);
    if (t < best) best = t;
  }
  if (dy < -1e-6) {
    const t = -oy / dy;
    if (t >= 0 && t < best) best = t;
  }
  return best;
}

// ---------------------------------------------------------------- visuals
const TRACER_POOL = 24;
const SMOKE_PUFFS = 16;

export class WeaponFX {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    for (let i = 0; i < TRACER_POOL; i++) {
      const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo.clone(), mat);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.flash = new THREE.PointLight(0xffc266, 0, 9, 1.6);
    scene.add(this.flash);
    this.smokes = []; // {group, until, x, z}
    this.smokeMat = new THREE.MeshBasicMaterial({ color: 0xb9c0c8, transparent: true, opacity: 0.42, depthWrite: false });
  }

  tracer(from, to, color) {
    let slot = this.tracers.find((t) => t.life <= 0);
    if (!slot) slot = this.tracers[0];
    const pos = slot.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    slot.line.material.color.setHex(color);
    slot.line.material.opacity = 0.85;
    slot.line.visible = true;
    slot.life = 0.09;
  }

  muzzle(at) {
    this.flash.position.copy(at);
    this.flash.intensity = 26;
  }

  update(dt) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    this.flash.intensity = Math.max(0, this.flash.intensity - dt * 320);
    for (const s of this.smokes) {
      const k = Math.min(1, (s.born + 1.2 - performance.now() / 1000) * 0.8 + 0.4);
      s.group.scale.setScalar(Math.max(0.2, k));
    }
  }

  addSmoke(x, y, z, until) {
    const group = new THREE.Group();
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + Math.random() * 0.9, 1), this.smokeMat);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 3.4;
      puff.position.set(Math.cos(a) * r, (Math.random() - 0.3) * 1.6, Math.sin(a) * r);
      group.add(puff);
    }
    group.position.set(x, y, z);
    this.scene.add(group);
    this.smokes.push({ group, until, x, z, born: performance.now() / 1000 });
  }

  removeSmoke(s) {
    this.scene.remove(s.group);
    for (const p of s.group.children) p.geometry.dispose();
  }
}

// ---------------------------------------------------------------- grenades
export class GrenadeSim {
  constructor(scene, colliders, fx, onDetonate) {
    this.scene = scene;
    this.colliders = colliders;
    this.fx = fx;
    this.onDetonate = onDetonate; // (kind, pos) => void
    this.live = []; // {kind, pos, vel, fuse, mesh}
    this.geo = new THREE.SphereGeometry(0.11, 10, 8);
    this.fragMat = new THREE.MeshStandardMaterial({ color: 0x2e4d2a, roughness: 0.5, metalness: 0.4 });
    this.smokeMat = new THREE.MeshStandardMaterial({ color: 0x8a929c, roughness: 0.6, metalness: 0.3 });
  }

  throw(kind, origin, dir, speed = 15) {
    const mesh = new THREE.Mesh(this.geo, kind === 'frag' ? this.fragMat : this.smokeMat);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(speed);
    vel.y += 3.2;
    this.live.push({ kind, pos: origin.clone(), vel, fuse: GRENADES[kind].fuse, mesh });
  }

  step(dt, time) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const g = this.live[i];
      g.fuse -= dt;
      g.vel.y -= 12 * dt;
      g.pos.addScaledVector(g.vel, dt);
      // Ground bounce.
      if (g.pos.y < 0.11) {
        g.pos.y = 0.11;
        if (Math.abs(g.vel.y) > 1.2) g.vel.y = -g.vel.y * 0.42;
        else { g.vel.y = 0; g.vel.x *= 0.6; g.vel.z *= 0.6; }
      }
      // Wall bounce (cheap: clamp inside the arena, reflect off boxes).
      for (const c of this.colliders) {
        if (c.top < 0.4) continue;
        if (g.pos.x > c.minX - 0.11 && g.pos.x < c.maxX + 0.11 && g.pos.z > c.minZ - 0.11 && g.pos.z < c.maxZ + 0.11 && g.pos.y < c.top) {
          const dxl = g.pos.x - (c.minX - 0.11), dxr = (c.maxX + 0.11) - g.pos.x;
          const dzl = g.pos.z - (c.minZ - 0.11), dzr = (c.maxZ + 0.11) - g.pos.z;
          const m = Math.min(dxl, dxr, dzl, dzr);
          if (m === dxl) { g.pos.x = c.minX - 0.11; g.vel.x = -Math.abs(g.vel.x) * 0.45; }
          else if (m === dxr) { g.pos.x = c.maxX + 0.11; g.vel.x = Math.abs(g.vel.x) * 0.45; }
          else if (m === dzl) { g.pos.z = c.minZ - 0.11; g.vel.z = -Math.abs(g.vel.z) * 0.45; }
          else { g.pos.z = c.maxZ + 0.11; g.vel.z = Math.abs(g.vel.z) * 0.45; }
        }
      }
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh);
        this.live.splice(i, 1);
        this.onDetonate(g.kind, g.pos, time);
      }
    }
  }
}

/** Fire one hitscan shot. `shooter` is {pos, yaw, pitch, team, isPlayer}.
 *  `targets` is the list of fighters to test (bots or the player). Returns
 *  {hit, head, target, point, wallDist} — the caller applies damage. */
export function fireHitscan(shooter, def, origin, dir, targets, colliders, maxRange) {
  const pellets = def.pellets ?? 1;
  let best = null;
  const spreadRad = THREE.MathUtils.degToRad(def.spread);
  for (let p = 0; p < pellets; p++) {
    const d = dir.clone();
    if (pellets > 1 || spreadRad > 0) {
      // Random cone offset around the aim direction.
      const a = Math.random() * Math.PI * 2;
      const r = (pellets > 1 ? Math.sqrt(Math.random()) : Math.random()) * spreadRad * (pellets > 1 ? 1 : 0.6);
      const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(d, up).normalize();
      const upv = new THREE.Vector3().crossVectors(right, d).normalize();
      d.addScaledVector(right, Math.cos(a) * r).addScaledVector(upv, Math.sin(a) * r).normalize();
    }
    const wallT = rayWalls(origin.x, origin.y, origin.z, d.x, d.y, d.z, colliders, maxRange);
    let hitT = wallT;
    let hitTarget = null;
    let head = false;
    for (const t of targets) {
      if (!t.alive || t === shooter) continue;
      if (t.team === shooter.team) continue;
      const eyeY = t.pos.y + (t.eyeHeight ?? 1.55);
      const headT = raySphere(origin.x, origin.y, origin.z, d.x, d.y, d.z, t.pos.x, eyeY + 0.12, t.pos.z, 0.24);
      if (headT < hitT) { hitT = headT; hitTarget = t; head = true; continue; }
      const bodyT = rayAABB(origin.x, origin.y, origin.z, d.x, d.y, d.z,
        t.pos.x - 0.42, t.pos.y, t.pos.z - 0.42, t.pos.x + 0.42, t.pos.y + (t.height ?? 1.7), t.pos.z + 0.42);
      if (bodyT < hitT) { hitT = bodyT; hitTarget = t; head = false; }
    }
    const point = origin.clone().addScaledVector(d, hitT);
    if (!best || (hitTarget && !best.target) || (hitTarget && best.target && hitT < best.t)) {
      best = { hit: hitTarget !== null, head, target: hitTarget, point, t: hitT, wallDist: wallT };
    }
  }
  return best;
}

export { WEAPONS };
