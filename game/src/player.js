// The human player: first-person movement with acceleration, crouching and
// AABB collision, plus the view model (gun) and the recoil/spread model that
// makes stopping to aim pay. No allocations in the per-frame path: every
// vector here is a reused temp.
import * as THREE from 'three';
import { PLAYER, SIM_DT } from './config.js';

const _wish = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Circle-vs-AABB collision in the XZ plane, resolved per axis so the
 *  player slides along walls. `pos` is the feet position; `feetY` is 0 on
 *  the flat dock floor. Returns nothing; mutates pos and zeroes the blocked
 *  velocity component via `vel`. */
export function collideCircle(pos, vel, radius, height, colliders, mapHalf) {
  // World bounds first.
  pos.x = Math.max(-mapHalf.halfX + radius, Math.min(mapHalf.halfX - radius, pos.x));
  pos.z = Math.max(-mapHalf.halfZ + radius, Math.min(mapHalf.halfZ - radius, pos.z));
  for (const c of colliders) {
    if (c.top < 0.4) continue; // too low to block a standing body
    if (pos.x + radius <= c.minX || pos.x - radius >= c.maxX) continue;
    if (pos.z + radius <= c.minZ || pos.z - radius >= c.maxZ) continue;
    // Overlap: push out along the smallest penetration axis.
    const pushL = pos.x + radius - c.minX;
    const pushR = c.maxX - (pos.x - radius);
    const pushU = pos.z + radius - c.minZ;
    const pushD = c.maxZ - (pos.z - radius);
    const m = Math.min(pushL, pushR, pushU, pushD);
    if (m === pushL) { pos.x = c.minX - radius; if (vel.x > 0) vel.x = 0; }
    else if (m === pushR) { pos.x = c.maxX + radius; if (vel.x < 0) vel.x = 0; }
    else if (m === pushU) { pos.z = c.minZ - radius; if (vel.z > 0) vel.z = 0; }
    else { pos.z = c.maxZ + radius; if (vel.z < 0) vel.z = 0; }
  }
}

export class Player {
  constructor(scene, colliders) {
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, 0, 19); // feet
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // face north (-z) toward the Tidebreak spawn
    this.pitch = 0;
    this.crouching = false;
    this.health = PLAYER.health;
    this.armor = 0;
    this.alive = true;
    this.money = 800;
    this.moveAmount = 0; // 0..1, how much the player moved this step
    this.bloom = 0; // extra spread in degrees, decays when not firing
    this.recoilPitch = 0; // unrecovered pitch kick, decays
    this.stepAcc = 0;
    this.lastStepAt = 0;

    this.camera = new THREE.PerspectiveCamera(78, 16 / 9, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    scene.add(this.camera);

    // View-model gun: a low-poly rifle built from boxes, parented to the camera.
    this.gun = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.45, metalness: 0.7 });
    const grip = new THREE.MeshStandardMaterial({ color: 0x3a332a, roughness: 0.85 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb05a2a, roughness: 0.5, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
    body.position.set(0, -0.02, -0.2);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.0, -0.62);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), grip);
    mag.position.set(0, -0.13, -0.28);
    mag.rotation.x = 0.15;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.22), grip);
    stock.position.set(0, -0.01, 0.2);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), accent);
    sight.position.set(0, 0.075, -0.3);
    this.gun.add(body, barrel, mag, stock, sight);
    this.gun.position.set(0.24, -0.24, -0.5);
    this.camera.add(this.gun);
    this.gunBasePos = this.gun.position.clone();
    this.gunKick = 0; // view-model kick, decays to 0
  }

  get eyeHeight() {
    return this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight;
  }

  get height() {
    return this.crouching ? PLAYER.crouchHeight : PLAYER.height;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.health = PLAYER.health;
    this.alive = true;
    this.bloom = 0;
    this.recoilPitch = 0;
    this.gunKick = 0;
    this.crouching = false;
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0021;
    this.pitch -= dy * 0.0021;
    const lim = 1.52;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  /** One fixed simulation step. `input` is {f,b,l,r,crouch}. */
  step(input, dt, time) {
    if (!this.alive) return;
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _wish.set(0, 0, 0);
    if (input.f) _wish.add(_forward);
    if (input.b) _wish.sub(_forward);
    if (input.r) _wish.add(_right);
    if (input.l) _wish.sub(_right);
    if (_wish.lengthSq() > 0) _wish.normalize();
    this.crouching = !!input.crouch;
    const speed = this.crouching ? PLAYER.crouchSpeed : PLAYER.walkSpeed;
    _wish.multiplyScalar(speed);
    // Accelerate toward the wanted velocity; decelerate fast when idle.
    const rate = _wish.lengthSq() > 0 ? PLAYER.accel : PLAYER.accel * 1.6;
    this.vel.x += THREE.MathUtils.clamp(_wish.x - this.vel.x, -rate * dt, rate * dt);
    this.vel.z += THREE.MathUtils.clamp(_wish.z - this.vel.z, -rate * dt, rate * dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideCircle(this.pos, this.vel, PLAYER.radius, this.height, this.colliders, { halfX: 28, halfZ: 22 });
    this.moveAmount = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / PLAYER.walkSpeed);
    // Footsteps: one soft step per 0.55 m walked.
    this.stepAcc += Math.hypot(this.vel.x, this.vel.z) * dt;
    if (this.stepAcc > 1.9) {
      this.stepAcc = 0;
      this.lastStepAt = time;
    }
    // Spread bloom and recoil recover.
    this.bloom = Math.max(0, this.bloom - dt * 3.2);
    this.recoilPitch = THREE.MathUtils.damp(this.recoilPitch, 0, 9, dt);
    this.gunKick = THREE.MathUtils.damp(this.gunKick, 0, 14, dt);
  }

  /** Camera + view model for this rendered frame. */
  updateCamera(time) {
    const bob = this.moveAmount * (this.crouching ? 0.012 : 0.028);
    const bobPhase = time * (this.crouching ? 7 : 11);
    this.camera.position.set(
      this.pos.x + Math.sin(bobPhase) * bob * 0.4,
      this.eyeHeight + Math.abs(Math.sin(bobPhase)) * bob,
      this.pos.z,
    );
    this.camera.rotation.set(this.pitch + this.recoilPitch, this.yaw, 0);
    // View-model sway and kick.
    this.gun.position.set(
      this.gunBasePos.x + Math.sin(bobPhase * 0.5) * 0.006 * this.moveAmount,
      this.gunBasePos.y - this.gunKick * 0.05 + Math.abs(Math.cos(bobPhase)) * 0.004 * this.moveAmount,
      this.gunBasePos.z + this.gunKick * 0.12,
    );
    this.gun.rotation.x = this.gunKick * 0.35;
  }

  /** Apply damage, armor absorbing half. Returns the damage actually taken. */
  damage(amount) {
    if (!this.alive) return 0;
    let rest = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, rest * 0.5);
      this.armor -= absorbed;
      rest -= absorbed;
    }
    rest = Math.round(rest);
    this.health = Math.max(0, this.health - rest);
    if (this.health <= 0) this.alive = false;
    return rest;
  }

  addRecoil(amount) {
    this.recoilPitch += amount * 0.011;
    this.gunKick = Math.min(1, this.gunKick + amount * 0.35);
  }
}
