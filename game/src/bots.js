// Bot fighters: waypoint navigation, vision and hearing, burst fire with
// reaction time and aim error, site holds, planting and defusing. Bots think
// on the same fixed step as the player; rendering only lerps their meshes.
import * as THREE from 'three';
import { BOT, WEAPONS, SIM_DT } from './config.js';
import { collideCircle } from './player.js';
import { hasLineOfSight } from './map.js';
import { fireHitscan, rayWalls } from './weapons.js';

const TIDE_NAMES = ['Rook', 'Vex', 'Marrow', 'Sable'];
const WATCH_NAMES = ['Heron', 'Kelpie'];

const _dir = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _eye = new THREE.Vector3();

// Breadth-first search over the waypoint graph.
export function findPath(nodes, from, to) {
  if (from === to) return [to];
  const prev = new Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of nodes[cur].edges) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let n = to;
        while (n !== from) { n = prev[n]; path.unshift(n); }
        return path;
      }
      queue.push(nb);
    }
  }
  return [to];
}

export function nearestNode(nodes, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

let botSeq = 0;

export class Bot {
  constructor(scene, team, name, colliders, nodes) {
    this.id = botSeq++;
    this.team = team;
    this.name = name;
    this.colliders = colliders;
    this.nodes = nodes;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.health = BOT.health;
    this.armor = 0;
    this.alive = true;
    this.eyeHeight = BOT.eyeHeight;
    this.height = BOT.height;
    this.weaponId = team === 'tide' ? 'carbine' : 'smg';
    this.mag = WEAPONS[this.weaponId].mag;
    this.reserve = WEAPONS[this.weaponId].reserve;
    this.reloading = false;
    this.reloadEnd = 0;
    this.lastShotAt = -10;
    this.burstLeft = 0;
    this.nextBurstAt = 0;
    this.state = 'advance';
    this.path = [];
    this.pathIdx = 0;
    this.holdUntil = 0;
    this.holdNode = -1;
    this.assignedSite = null;
    this.isCarrier = false;
    this.seen = null; // {fighter, at, pos}
    this.reactUntil = 0;
    this.heardAt = null; // {x, z, at}
    this.channel = null; // {kind:'plant'|'defuse', until, total}
    this.stuckSince = 0;
    this.lastPos = new THREE.Vector3();
    this.fallT = 0;
    this.aimError = 0.05 + Math.random() * 0.02;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeUntil = 0;

    // Body: capsule-ish figure in the team's color, with a visor and a gun.
    const color = team === 'watch' ? 0x3f8fb5 : 0xc96a2e;
    const dark = 0x23262c;
    this.mesh = new THREE.Group();
    const torsoMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2 });
    const darkMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6, metalness: 0.4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.95, 10), torsoMat);
    body.position.y = 0.95;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), darkMat);
    head.position.y = 1.58;
    head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x9be8ff, emissive: 0x4d7a8a, emissiveIntensity: 0.8 }));
    visor.position.set(0, 1.6, 0.18);
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8), darkMat);
    legs.position.y = 0.25;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), darkMat);
    gun.position.set(0.22, 1.15, -0.2);
    this.mesh.add(body, head, visor, legs, gun);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.scene = scene;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.lastPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.health = BOT.health;
    this.armor = 0;
    this.alive = true;
    this.mag = WEAPONS[this.weaponId].mag;
    this.reserve = WEAPONS[this.weaponId].reserve;
    this.reloading = false;
    this.state = 'advance';
    this.path = [];
    this.pathIdx = 0;
    this.seen = null;
    this.heardAt = null;
    this.channel = null;
    this.fallT = 0;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, yaw, 0);
    this.mesh.position.copy(this.pos);
  }

  die() {
    this.alive = false;
    this.fallT = 0;
    this.channel = null;
  }

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
    if (this.health <= 0) this.die();
    return rest;
  }

  get eyePos() {
    _eye.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
    return _eye;
  }

  /** Can this bot see `fighter` right now? Vision cone + range + LOS + smoke.
   *  `world` is the Game: its smokeBlocks method is called bound to it. */
  canSee(fighter, world) {
    if (!fighter.alive) return false;
    const dx = fighter.pos.x - this.pos.x;
    const dz = fighter.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const range = fighter.crouching ? BOT.sightRange * 0.7 : BOT.sightRange;
    if (dist > range) return false;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const dot = (dx * fx + dz * fz) / (dist || 1);
    if (dot < 0.15 && dist > 6) return false; // outside the vision cone
    const eye = this.eyePos;
    const fEyeY = fighter.pos.y + (fighter.eyeHeight ?? 1.55);
    if (!hasLineOfSight(eye.x, eye.y, eye.z, fighter.pos.x, fEyeY, fighter.pos.z, this.colliders)) return false;
    if (world.smokeBlocks(eye.x, eye.y, eye.z, fighter.pos.x, fEyeY, fighter.pos.z)) return false;
    return true;
  }

  setPathTo(nodeIdx) {
    const from = nearestNode(this.nodes, this.pos.x, this.pos.z);
    this.path = findPath(this.nodes, from, nodeIdx);
    this.pathIdx = 0;
  }

  /** One fixed step. `world` gives fighters, sites, charge state, time.
   *  Bots only act while the round is live: during the buy phase they wait
   *  at spawn, and once a round ends they freeze where they stand. */
  step(world, dt, time) {
    if (!this.alive) {
      if (this.fallT < 1) {
        this.fallT += dt * 2.2;
        this.mesh.rotation.x = -Math.min(1, this.fallT) * Math.PI * 0.5;
        this.mesh.position.y = -Math.min(1, this.fallT) * 0.25;
      }
      return;
    }
    if (world.phase !== 'live') {
      this.vel.set(0, 0, 0);
      this.mesh.position.copy(this.pos);
      return;
    }
    const def = WEAPONS[this.weaponId];
    // Finish reloads.
    if (this.reloading && time >= this.reloadEnd) {
      const need = def.mag - this.mag;
      const take = Math.min(need, this.reserve);
      this.mag += take;
      this.reserve -= take;
      this.reloading = false;
    }
    // Vision sweep: nearest visible enemy. Bots hold fire until the round
    // is live: during the buy phase they walk to their holds and watch.
    let bestSeen = null, bestD = Infinity;
    if (world.phase === 'live') {
      for (const f of world.fighters) {
        if (f === this || f.team === this.team || !f.alive) continue;
        if (!this.canSee(f, world)) continue;
        const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z);
        if (d < bestD) { bestD = d; bestSeen = f; }
      }
    }
    if (bestSeen) {
      if (!this.seen || this.seen.fighter !== bestSeen) {
        this.seen = { fighter: bestSeen, at: time, pos: bestSeen.pos.clone() };
        this.reactUntil = time + BOT.reactMin + Math.random() * (BOT.reactMax - BOT.reactMin);
      } else {
        this.seen.pos.copy(bestSeen.pos);
        this.seen.at = time;
      }
    } else if (this.seen && time - this.seen.at > 1.2) {
      this.seen = null;
    }

    // Channeling (plant/defuse) pauses everything else.
    if (this.channel) {
      if (time >= this.channel.until) {
        const kind = this.channel.kind;
        this.channel = null;
        world.onChannelDone(this, kind);
      } else if (this.seen) {
        // Spotted an enemy while channeling: abort and fight.
        this.channel = null;
      } else {
        this.vel.set(0, 0, 0);
        this.faceToward(this.channel.x, this.channel.z, dt);
        return;
      }
    }

    // Decide what to do.
    if (this.seen && time >= this.reactUntil) {
      this.state = 'engage';
    } else if (this.state === 'engage' && !this.seen) {
      this.state = 'advance';
    }

    if (this.state === 'engage') {
      this.engage(world, dt, time);
    } else {
      this.advance(world, dt, time);
    }

    // Move with collision.
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    collideCircle(this.pos, this.vel, BOT.radius, this.height, this.colliders, { halfX: 28, halfZ: 22 });
    // Stuck detection: repath to the next node directly.
    if (this.path.length && this.state === 'advance') {
      if (this.pos.distanceToSquared(this.lastPos) < 0.0004) {
        if (!this.stuckSince) this.stuckSince = time;
        else if (time - this.stuckSince > 1.4) {
          this.pathIdx = Math.min(this.pathIdx + 1, this.path.length - 1);
          this.stuckSince = 0;
        }
      } else this.stuckSince = 0;
      this.lastPos.copy(this.pos);
    }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
  }

  faceToward(x, z, dt) {
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z));
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += THREE.MathUtils.clamp(diff, -5 * dt, 5 * dt);
  }

  engage(world, dt, time) {
    const target = this.seen.fighter;
    const dist = Math.hypot(target.pos.x - this.pos.x, target.pos.z - this.pos.z);
    this.faceToward(target.pos.x, target.pos.z, dt);
    // Strafe while fighting, to make bots harder targets.
    if (time > this.strafeUntil) {
      this.strafeDir *= -1;
      this.strafeUntil = time + 0.7 + Math.random() * 0.9;
    }
    const wantClose = dist > 14;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const speed = wantClose ? BOT.runSpeed : BOT.walkSpeed * 0.5;
    this.vel.x = fx * (wantClose ? speed : 0) + rx * this.strafeDir * speed * 0.45;
    this.vel.z = fz * (wantClose ? speed : 0) + rz * this.strafeDir * speed * 0.45;
    // Burst fire.
    const def = WEAPONS[this.weaponId];
    if (this.mag === 0 && !this.reloading && this.reserve > 0) {
      this.reloading = true;
      this.reloadEnd = time + def.reload;
      return;
    }
    if (this.burstLeft > 0 && time - this.lastShotAt >= def.fireInterval && !this.reloading) {
      this.shootAt(world, target, dist, time);
    } else if (this.burstLeft <= 0 && time >= this.nextBurstAt && !this.reloading && this.mag > 0) {
      this.burstLeft = 3 + Math.floor(Math.random() * 3);
      this.nextBurstAt = time + 0.35 + Math.random() * 0.5;
    }
  }

  shootAt(world, target, dist, time) {
    const def = WEAPONS[this.weaponId];
    this.mag--;
    this.lastShotAt = time;
    this.burstLeft--;
    const eye = this.eyePos;
    const err = this.aimError + dist * 0.0016 + (target.moveAmount ?? 0) * 0.02;
    _toTarget.set(target.pos.x - eye.x, (target.pos.y + 1.3) - eye.y, target.pos.z - eye.z).normalize();
    _toTarget.x += (Math.random() - 0.5) * 2 * err;
    _toTarget.y += (Math.random() - 0.5) * 2 * err;
    _toTarget.z += (Math.random() - 0.5) * 2 * err;
    _toTarget.normalize();
    const muzzle = eye.clone().addScaledVector(_toTarget, 0.7);
    const hit = fireHitscan(this, { ...def, spread: 0 }, eye, _toTarget, world.fighters, this.colliders, def.range);
    world.fx.tracer(muzzle, hit.point, def.tracer);
    world.fx.muzzle(muzzle);
    world.sound.shot(this.weaponId, this.pos.distanceTo(world.player.pos));
    world.onShotFired(this);
    if (hit.hit && hit.target) {
      let dmg = def.damage * (1 - Math.min(0.5, dist / def.range * 0.5));
      if (hit.head) dmg *= def.headMult;
      world.applyDamage(hit.target, dmg, hit.head, this);
    }
  }

  advance(world, dt, time) {
    // Charge planted: defenders rush the site, attackers hold it.
    if (world.chargePlanted) {
      if (this.team === 'watch') {
        const site = world.chargeSite;
        const node = nearestNode(this.nodes, site.center[0], site.center[1]);
        if (this.holdNode !== node) { this.holdNode = node; this.setPathTo(node); this.state = 'advance'; }
        if (this.atNode(node, 1.6)) {
          this.vel.set(0, 0, 0);
          this.faceToward(site.center[0], site.center[1], dt);
          if (!this.channel) this.channel = { kind: 'defuse', until: time + 5, total: 5, x: site.center[0], z: site.center[1] };
        }
        this.followPath(dt);
        return;
      }
      // Attackers: hold near the planted site.
      const site = world.chargeSite;
      if (!this.holdNode || this.holdNode < 0) {
        const node = nearestNode(this.nodes, site.center[0] + 4, site.center[1] + 4);
        this.holdNode = node;
        this.setPathTo(node);
      }
      if (this.atNode(this.holdNode, 1.8)) {
        this.vel.set(0, 0, 0);
        this.faceToward(this.pos.x - Math.sin(this.yaw), this.pos.z - Math.cos(this.yaw), dt);
        return;
      }
      this.followPath(dt);
      return;
    }

    // Investigate a heard shot when idle.
    if (this.heardAt && time - this.heardAt.at < 4 && this.state !== 'engage') {
      const node = nearestNode(this.nodes, this.heardAt.x, this.heardAt.z);
      if (this.holdNode !== node) { this.holdNode = node; this.setPathTo(node); }
      if (this.atNode(node, 2)) {
        this.vel.set(0, 0, 0);
        this.heardAt = null;
        this.holdUntil = time + 1.5;
        return;
      }
      this.followPath(dt);
      return;
    }

    // Round plan by team.
    if (this.team === 'tide') {
      const site = this.assignedSite;
      const node = nearestNode(this.nodes, site.center[0], site.center[1]);
      if (this.holdNode !== node) { this.holdNode = node; this.setPathTo(node); }
      if (this.atNode(node, 1.8)) {
        this.vel.set(0, 0, 0);
        this.faceToward(site.center[0], site.center[1], dt);
        // Carrier plants once the site is reached and looks clear.
        if (this.isCarrier && !this.channel && !this.seen) {
          this.channel = { kind: 'plant', until: time + 3.5, total: 3.5, x: site.center[0], z: site.center[1] };
        }
        return;
      }
      this.followPath(dt);
    } else {
      // Defenders: walk to the hold node, then watch the lane.
      if (this.holdNode < 0) return;
      if (this.atNode(this.holdNode, 1.5)) {
        this.vel.set(0, 0, 0);
        if (time < this.holdUntil) return;
        // Slowly scan the lane: sweep yaw.
        this.yaw += Math.sin(time * 0.5 + this.id) * 0.35 * dt;
        return;
      }
      this.followPath(dt);
    }
  }

  atNode(nodeIdx, radius) {
    const n = this.nodes[nodeIdx];
    return Math.hypot(n.x - this.pos.x, n.z - this.pos.z) < radius;
  }

  followPath(dt) {
    if (!this.path.length || this.pathIdx >= this.path.length) {
      this.vel.set(0, 0, 0);
      return;
    }
    const node = this.nodes[this.path[this.pathIdx]];
    const dx = node.x - this.pos.x;
    const dz = node.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) {
      this.pathIdx++;
      return;
    }
    const speed = BOT.walkSpeed;
    this.vel.x = (dx / d) * speed;
    this.vel.z = (dz / d) * speed;
    this.faceToward(node.x, node.z, dt);
  }
}

export function makeSquad(scene, colliders, nodes) {
  const tide = TIDE_NAMES.map((n) => new Bot(scene, 'tide', n, colliders, nodes));
  const watch = WATCH_NAMES.map((n) => new Bot(scene, 'watch', n, colliders, nodes));
  return { tide, watch, all: [...tide, ...watch] };
}
