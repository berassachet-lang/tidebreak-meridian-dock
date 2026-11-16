// TIDEBREAK — Meridian Dock: the round state machine, economy, objective
// (plant/defuse), player shooting and grenades, and the win/lose rules.
// Fixed-step simulation lives here; rendering only reads this state.
import * as THREE from 'three';
import {
  ROUND_TIME, BUY_TIME, DEFUSE_TIME, CHARGE_TIME,
  ROUNDS_TO_WIN, MAX_ROUNDS, START_MONEY, ECON, WEAPONS, GRENADES, SITES,
} from './config.js';
import { fireHitscan } from './weapons.js';

const _dir = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _right = new THREE.Vector3();

export class Game {
  constructor(deps) {
    this.scene = deps.scene;
    this.player = deps.player;
    this.squad = deps.squad; // {tide, watch, all}
    this.fx = deps.fx;
    this.grenades = deps.grenades;
    this.sound = deps.sound;
    this.hud = deps.hud;
    this.colliders = deps.colliders;
    this.nodes = deps.nodes;

    this.phase = 'menu'; // menu | buy | live | roundEnd | matchEnd
    this.round = 1;
    this.scoreWatch = 0;
    this.scoreTide = 0;
    this.phaseT = 0; // seconds left in the current phase
    this.time = 0; // total sim time
    this.started = false;

    // Player loadout.
    this.owned = new Set(['pistol']);
    this.weaponId = 'pistol';
    this.ammo = {}; // weaponId -> {mag, reserve}
    for (const id of Object.keys(WEAPONS)) {
      this.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    this.grenadeCount = { frag: 0, smoke: 0 };
    this.selectedGrenade = 'frag';
    this.reloading = false;
    this.reloadEnd = 0;
    this.lastShotAt = -10;
    this.firing = false; // mouse held
    this.channel = null; // player defuse {until, total}
    this.channelTarget = null;

    // Objective state.
    this.chargePlanted = false;
    this.chargeSite = null;
    this.chargeMesh = null;
    this.chargeLight = null;
    this.chargeBeepAt = 0;
    this.smokeClouds = []; // {x,y,z,r,until}
    this.pings = []; // {x,z,at} recent gunfire, for the minimap

    this.fighters = [this.player, ...this.squad.all];
    this.player.team = 'watch';
    this.player.isPlayer = true;
    this.player.name = 'You';
    this.kills = 0;
    this._endReason = '';
  }

  // ------------------------------------------------------------ lifecycle
  startMatch() {
    this.started = true;
    this.round = 1;
    this.scoreWatch = 0;
    this.scoreTide = 0;
    this.player.money = START_MONEY;
    this.owned = new Set(['pistol']);
    this.weaponId = 'pistol';
    for (const id of Object.keys(WEAPONS)) {
      this.ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    }
    this.grenadeCount = { frag: 0, smoke: 0 };
    this.startRound();
  }

  startRound() {
    this.chargePlanted = false;
    this.chargeSite = null;
    this.removeChargeMesh();
    this.smokeClouds = [];
    this.pings = [];
    this.channel = null;
    this.reloading = false;
    // Spawn the player and the bots.
    const spawns = this.spawnPoints();
    this.player.spawn(spawns.watch[0][0], spawns.watch[0][1], Math.PI);
    this.player.armor = this.player.armor; // armor persists between rounds
    this.squad.watch.forEach((b, i) => {
      b.weaponId = 'smg';
      b.spawn(spawns.watch[i + 1][0], spawns.watch[i + 1][1], Math.PI);
    });
    this.squad.tide.forEach((b, i) => {
      b.weaponId = i === 3 ? 'smg' : 'carbine';
      b.spawn(spawns.tide[i][0], spawns.tide[i][1], 0);
    });
    // Attackers split between the two sites; the first carries the charge.
    const siteKeys = ['A', 'B', 'A', 'B'];
    this.squad.tide.forEach((b, i) => {
      b.assignedSite = SITES[siteKeys[i]];
      b.isCarrier = i === 0;
    });
    // Defenders hold mid and the two sites.
    const holdSpots = [[0, 2], [-21, -9], [21, -11]];
    this.squad.watch.forEach((b, i) => {
      const spot = holdSpots[i % holdSpots.length];
      b.holdNode = this.nearestNodeIdx(spot[0], spot[1]);
      b.setPathTo(b.holdNode);
    });
    // Refill the current magazine from reserve at round start.
    const cur = this.ammo[this.weaponId];
    const need = WEAPONS[this.weaponId].mag - cur.mag;
    const take = Math.min(need, cur.reserve);
    cur.mag += take;
    cur.reserve -= take;
    this.phase = 'buy';
    this.phaseT = BUY_TIME;
    this.hud.showHud(true);
    this.hud.setObjective('Buy phase — press B to buy. Defend Site A (Quay Gate) and Site B (Cold Store).');
    this.hud.showBanner(`ROUND ${this.round}`, 'Buy your gear — the Tidebreak crew is coming.', '', 2200);
    this.sound.roundStart();
    this.syncHud();
  }

  spawnPoints() {
    return {
      watch: [[-6, 19], [0, 19.5], [6, 19]],
      tide: [[-6, -19], [0, -19.5], [6, -19], [-2, -18.5]],
    };
  }

  nearestNodeIdx(x, z) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.nodes.length; i++) {
      const d = (this.nodes[i].x - x) ** 2 + (this.nodes[i].z - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ------------------------------------------------------------ economy
  buy(id) {
    if (this.phase !== 'buy') return false;
    const price =
      id === 'armor' ? 650 : id === 'frag' ? GRENADES.frag.price : id === 'smoke' ? GRENADES.smoke.price : WEAPONS[id].price;
    if (this.player.money < price) { this.sound.denied(); return false; }
    if (id === 'armor') {
      if (this.player.armor >= 50) { this.sound.denied(); return false; }
      this.player.money -= price;
      this.player.armor = 50;
    } else if (id === 'frag' || id === 'smoke') {
      if (this.grenadeCount[id] >= 2) { this.sound.denied(); return false; }
      this.player.money -= price;
      this.grenadeCount[id]++;
    } else {
      if (this.owned.has(id)) { this.sound.denied(); return false; }
      this.player.money -= price;
      this.owned.add(id);
      this.switchWeapon(id);
    }
    this.sound.buy();
    this.syncHud();
    this.hud.refreshBuyOwned([...this.owned, ...(this.player.armor >= 50 ? ['armor'] : [])]);
    return true;
  }

  switchWeapon(id) {
    if (!this.owned.has(id) || this.weaponId === id) return;
    this.weaponId = id;
    this.reloading = false;
    this.syncHud();
  }

  selectGrenade(kind) {
    this.selectedGrenade = kind;
    this.syncHud();
  }

  // ------------------------------------------------------------ shooting
  get weaponDef() { return WEAPONS[this.weaponId]; }

  get spreadDeg() {
    const def = this.weaponDef;
    const move = def.moveSpread * this.player.moveAmount;
    const crouch = this.player.crouching ? 0.7 : 1;
    return (def.spread + move + this.player.bloom) * crouch;
  }

  tryFire(time) {
    if (this.phase !== 'live' || !this.player.alive) return;
    const def = this.weaponDef;
    const ammo = this.ammo[this.weaponId];
    if (this.reloading) return;
    if (time - this.lastShotAt < def.fireInterval) return;
    if (ammo.mag <= 0) {
      this.sound.dryFire();
      this.lastShotAt = time;
      this.startReload(time);
      return;
    }
    this.lastShotAt = time;
    ammo.mag--;
    // Direction from the camera, with a random cone for spread.
    this.player.camera.getWorldDirection(_dir);
    const spreadRad = THREE.MathUtils.degToRad(this.spreadDeg);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spreadRad;
    _right.crossVectors(_dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(_right, _dir).normalize();
    _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    _eye.copy(this.player.camera.position);
    _muzzle.copy(_eye).addScaledVector(_dir, 0.6);
    _muzzle.y -= 0.12;
    const hit = fireHitscan(this.player, { ...def, spread: 0 }, _eye, _dir, this.fighters, this.colliders, def.range);
    this.fx.tracer(_muzzle, hit.point, def.tracer);
    this.fx.muzzle(_muzzle);
    this.sound.shot(this.weaponId, 0);
    this.onShotFired(this.player);
    this.player.addRecoil(def.recoil);
    this.player.bloom = Math.min(def.bloomMax, this.player.bloom + def.bloom);
    if (hit.hit && hit.target) {
      const dist = hit.t;
      let dmg = def.damage * (1 - Math.min(0.5, dist / def.range * 0.5));
      if (hit.head) dmg *= def.headMult;
      this.applyDamage(hit.target, dmg, hit.head, this.player);
    }
    if (ammo.mag === 0) this.startReload(time);
    this.syncHud();
  }

  startReload(time) {
    const def = this.weaponDef;
    const ammo = this.ammo[this.weaponId];
    if (this.reloading || ammo.reserve <= 0 || ammo.mag === def.mag) return;
    this.reloading = true;
    this.reloadEnd = time + def.reload;
    this.sound.reload();
    this.hud.setReloading(true);
  }

  finishReload() {
    const def = this.weaponDef;
    const ammo = this.ammo[this.weaponId];
    const need = def.mag - ammo.mag;
    const take = Math.min(need, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    this.reloading = false;
    this.hud.setReloading(false);
    this.syncHud();
  }

  throwGrenade(time) {
    if (this.phase !== 'live' || !this.player.alive) return;
    const kind = this.selectedGrenade;
    if (this.grenadeCount[kind] <= 0) { this.sound.denied(); return; }
    this.grenadeCount[kind]--;
    this.player.camera.getWorldDirection(_dir);
    _eye.copy(this.player.camera.position);
    this.grenades.throw(kind, _eye, _dir, 15);
    this.sound.grenadeThrow();
    this.syncHud();
  }

  detonateGrenade(kind, pos, time) {
    if (kind === 'frag') {
      this.sound.explosion(pos.distanceTo(this.player.pos));
      this.fx.muzzle(pos.clone().setY(1));
      const radius = GRENADES.frag.radius;
      for (const f of this.fighters) {
        if (!f.alive) continue;
        const d = Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z);
        if (d > radius) continue;
        const eyeY = f.pos.y + (f.eyeHeight ?? 1.55);
        if (!this.losClear(pos.x, pos.y + 0.4, pos.z, f.pos.x, eyeY, f.pos.z)) continue;
        const dmg = GRENADES.frag.damage * (1 - d / radius * 0.85);
        this.applyDamage(f, dmg, false, null);
      }
    } else {
      this.fx.addSmoke(pos.x, 1.2, pos.z, time + GRENADES.smoke.life);
      this.smokeClouds.push({ x: pos.x, y: 1.2, z: pos.z, r: 4.5, until: time + GRENADES.smoke.life });
    }
  }

  // ------------------------------------------------------------ damage
  applyDamage(target, amount, head, attacker) {
    if (!target.alive) return;
    const taken = target.damage(amount);
    if (target === this.player) {
      this.hud.damageFlash();
      this.sound.hurt();
      if (this.channel) this.channel = null; // damage breaks a defuse
      if (!this.player.alive) {
        this.hud.killfeed(attacker ? attacker.name : 'Tidebreak', 'You', head, attacker ? attacker.team : 'tide', 'watch');
        this.onPlayerDeath();
      }
      return;
    }
    // A bot was hit.
    this.hud.hitmarker(!target.alive);
    if (head) this.sound.hit(); else this.sound.hit();
    if (!target.alive) {
      const killer = attacker === this.player ? 'You' : attacker ? attacker.name : 'Watch';
      const killerTeam = attacker ? attacker.team : 'watch';
      this.hud.killfeed(killer, target.name, head, killerTeam, target.team);
      if (attacker === this.player) {
        this.kills++;
        this.player.money += ECON.kill;
        this.sound.kill();
        this.syncHud();
      }
      // The dead bot's squad hears the kill.
      for (const b of this.squad.all) {
        if (b.alive && b.team === target.team) b.heardAt = { x: target.pos.x, z: target.pos.z, at: this.time };
      }
      this.checkRoundEnd();
    }
  }

  onPlayerDeath() {
    document.getElementById('dead').classList.remove('hidden');
    document.getElementById('dead-title').textContent = 'YOU ARE DOWN';
    document.getElementById('dead-text').textContent = 'Your squad is still fighting. The round ends soon.';
    if (document.pointerLockElement) document.exitPointerLock();
    this.checkRoundEnd();
  }

  onShotFired(shooter) {
    // Everyone nearby hears the shot and turns toward it.
    this.pings.push({ x: shooter.pos.x, z: shooter.pos.z, at: this.time });
    if (this.pings.length > 24) this.pings.shift();
    for (const b of this.squad.all) {
      if (!b.alive || b === shooter) continue;
      const d = Math.hypot(b.pos.x - shooter.pos.x, b.pos.z - shooter.pos.z);
      if (d < 26) b.heardAt = { x: shooter.pos.x, z: shooter.pos.z, at: this.time };
    }
    if (shooter !== this.player && shooter.team === 'tide') {
      shooter.lastSeenAt = this.time; // a firing enemy shows on the minimap
    }
  }

  // ------------------------------------------------------------ objective
  smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const s of this.smokeClouds) {
      if (this.time > s.until) continue;
      if (segmentHitsSphere(ax, ay, az, bx, by, bz, s.x, s.y, s.z, s.r)) return true;
    }
    return false;
  }

  plantCharge(site, byBot) {
    if (this.phase !== 'live' || this.chargePlanted) return;
    this.chargeSite = site;
    this.phaseT = CHARGE_TIME;
    this.chargeBeepAt = this.time;
    // Charge mesh: a blinking box on the site.
    const geo = new THREE.BoxGeometry(0.55, 0.35, 0.4);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, roughness: 0.4, metalness: 0.5 });
    this.chargeMesh = new THREE.Mesh(geo, mat);
    this.chargeMesh.position.set(site.center[0], 0.18, site.center[1]);
    this.scene.add(this.chargeMesh);
    this.chargeLight = new THREE.PointLight(0xff3020, 8, 10, 1.5);
    this.chargeLight.position.set(site.center[0], 1.2, site.center[1]);
    this.scene.add(this.chargeLight);
    this.hud.showBanner('CHARGE PLANTED', `Site ${site.id} (${site.name}) — defuse it, Watch!`, 'warn', 3200);
    this.hud.setObjective(`CHARGE PLANTED at Site ${site.id} — hold E near it to defuse!`);
    this.player.money += 0; // plant bonus goes to the carrier's team only
    this.sound.beep(true);
  }

  removeChargeMesh() {
    if (this.chargeMesh) { this.scene.remove(this.chargeMesh); this.chargeMesh = null; }
    if (this.chargeLight) { this.scene.remove(this.chargeLight); this.chargeLight = null; }
  }

  explodeCharge() {
    this.sound.explosion(this.chargeSite ? Math.hypot(this.player.pos.x - this.chargeSite.center[0], this.player.pos.z - this.chargeSite.center[1]) : 0);
    if (this.chargeMesh) {
      this.fx.muzzle(this.chargeMesh.position.clone().setY(1.5));
    }
    this.removeChargeMesh();
    this.endRound('tide', 'The charge detonated — Site ' + this.chargeSite.id + ' is gone.');
  }

  defuseCharge() {
    if (this.phase !== 'live' || !this.chargePlanted) return;
    this.chargePlanted = false;
    this.player.money += ECON.defuseBonus;
    this.endRound('watch', 'Charge defused — Meridian Dock holds.');
  }

  onChannelDone(bot, kind) {
    if (kind === 'plant' && bot.isCarrier && !this.chargePlanted) {
      this.plantCharge(bot.assignedSite, bot);
    } else if (kind === 'defuse' && this.chargePlanted) {
      this.defuseCharge();
    }
  }

  // ------------------------------------------------------------ rounds
  checkRoundEnd() {
    if (this.phase !== 'live') return;
    const watchAlive = this.fighters.filter((f) => f.team === 'watch' && f.alive).length;
    const tideAlive = this.fighters.filter((f) => f.team === 'tide' && f.alive).length;
    if (tideAlive === 0) this.endRound('watch', 'Tidebreak squad eliminated.');
    else if (watchAlive === 0) this.endRound('tide', 'Harbor Watch is down.');
  }

  endRound(winner, reason) {
    if (this.phase === 'roundEnd' || this.phase === 'matchEnd') return;
    this.phase = 'roundEnd';
    this.phaseT = 4.5;
    this._endReason = reason;
    if (winner === 'watch') {
      this.scoreWatch++;
      this.player.money += ECON.roundWin;
      this.hud.showBanner('ROUND WON', reason, 'gold', 3400);
      this.sound.roundWin();
    } else {
      this.scoreTide++;
      this.player.money += ECON.roundLoss;
      this.hud.showBanner('ROUND LOST', reason, 'warn', 3400);
      this.sound.roundLose();
    }
    this.hud.hidePrompt();
    this.syncHud();
  }

  nextAfterRoundEnd() {
    document.getElementById('dead').classList.add('hidden');
    if (this.scoreWatch >= ROUNDS_TO_WIN || this.scoreTide >= ROUNDS_TO_WIN || this.round >= MAX_ROUNDS) {
      this.endMatch();
      return;
    }
    this.round++;
    this.startRound();
  }

  endMatch() {
    this.phase = 'matchEnd';
    const won = this.scoreWatch > this.scoreTide;
    const tied = this.scoreWatch === this.scoreTide;
    document.getElementById('match-title').textContent = tied ? 'DRAW' : won ? 'HARBOR WATCH WINS' : 'TIDEBREAK WINS';
    document.getElementById('match-text').textContent =
      `Final score ${this.scoreWatch} — ${this.scoreTide} over ${this.round} rounds. ` +
      (tied ? 'Nobody takes the dock tonight.' : won ? 'Meridian Dock holds. Your squad kept the harbor.' : 'The dock is theirs — run it back and take it.');
    document.getElementById('match-end').classList.remove('hidden');
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ------------------------------------------------------------ per-step
  step(dt, input, time) {
    this.time = time;
    if (this.phase === 'buy') {
      this.phaseT -= dt;
      this.player.step(input, dt, time);
      for (const b of this.squad.all) b.step(this, dt, time);
      if (this.phaseT <= 0) {
        this.phase = 'live';
        this.phaseT = ROUND_TIME;
        this.hud.setBuyOpen(false);
        this.hud.setObjective('Defend Site A (Quay Gate) and Site B (Cold Store). Eliminate Tidebreak or stop the plant.');
        this.hud.showBanner('GO — ROUND ' + this.round, 'Defend the sites.', '', 1800);
      }
    } else if (this.phase === 'live') {
      this.phaseT -= dt;
      // Player defuse channel: hold E near the planted charge.
      if (this.chargePlanted && this.player.alive && input.use) {
        const d = Math.hypot(this.player.pos.x - this.chargeSite.center[0], this.player.pos.z - this.chargeSite.center[1]);
        if (d < 2.6) {
          if (!this.channel) this.channel = { until: time + DEFUSE_TIME, total: DEFUSE_TIME };
          const left = this.channel.until - time;
          this.hud.showPrompt(`<b>DEFUSING…</b> ${Math.ceil(left * 10) / 10}s — hold <b>E</b>`);
          if (time - (this._defuseTick || 0) > 0.5) { this._defuseTick = time; this.sound.defuse(); }
          if (left <= 0) {
            this.channel = null;
            this.hud.hidePrompt();
            this.defuseCharge();
          }
        } else {
          this.channel = null;
          this.hud.hidePrompt();
        }
      } else if (this.channel) {
        this.channel = null;
        this.hud.hidePrompt();
      }
      // Charge beeps, faster as it nears detonation.
      if (this.chargePlanted) {
        const interval = Math.max(0.25, this.phaseT / CHARGE_TIME);
        if (time - this.chargeBeepAt > interval) {
          this.chargeBeepAt = time;
          this.sound.beep(this.phaseT < 5);
          if (this.chargeLight) this.chargeLight.intensity = this.chargeLight.intensity > 4 ? 2 : 10;
        }
      }
      // Firing (held mouse) and reload.
      if (this.firing) this.tryFire(time);
      if (this.reloading && time >= this.reloadEnd) this.finishReload();
      this.player.step(input, dt, time);
      for (const b of this.squad.all) b.step(this, dt, time);
      // Footstep sounds.
      if (this.player.lastStepAt === time) this.sound.step(0);
      // Minimap: mark enemies the player can currently see.
      for (const e of this.squad.tide) {
        if (!e.alive) continue;
        const d = Math.hypot(e.pos.x - this.player.pos.x, e.pos.z - this.player.pos.z);
        if (d < 46) {
          const eyeY = e.pos.y + e.eyeHeight;
          const py = this.player.pos.y + this.player.eyeHeight;
          if (this.losClear(this.player.pos.x, py, this.player.pos.z, e.pos.x, eyeY, e.pos.z)) e.lastSeenAt = time;
        }
      }
      if (this.phaseT <= 0) {
        if (this.chargePlanted) this.explodeCharge();
        else this.endRound('watch', 'Time — Tidebreak never planted. The dock holds.');
      }
      this.checkRoundEnd();
    } else if (this.phase === 'roundEnd') {
      this.phaseT -= dt;
      this.player.step({ f: false, b: false, l: false, r: false, crouch: false }, dt, time);
      for (const b of this.squad.all) b.step(this, dt, time);
      if (this.phaseT <= 0) this.nextAfterRoundEnd();
    }
    // Grenades and smoke always simulate.
    this.grenades.step(dt, time);
    for (let i = this.smokeClouds.length - 1; i >= 0; i--) {
      if (time > this.smokeClouds[i].until) {
        const s = this.smokeClouds[i];
        this.smokeClouds.splice(i, 1);
        const fxSmoke = this.fx.smokes.find((x) => Math.abs(x.x - s.x) < 0.5 && Math.abs(x.z - s.z) < 0.5);
        if (fxSmoke) {
          this.fx.removeSmoke(fxSmoke);
          this.fx.smokes.splice(this.fx.smokes.indexOf(fxSmoke), 1);
        }
      }
    }
    this.syncHud();
  }

  losClear(ax, ay, az, bx, by, bz) {
    // Segment vs map boxes, then vs smoke.
    for (const c of this.colliders) {
      if (c.top < Math.min(ay, by)) continue;
      const t = segmentBoxT(ax, ay, az, bx, by, bz, c);
      if (t !== Infinity) return false;
    }
    if (this.smokeBlocks(ax, ay, az, bx, by, bz)) return false;
    return true;
  }

  syncHud() {
    const ammo = this.ammo[this.weaponId];
    this.hud.setHealth(this.player.health, this.player.armor);
    this.hud.setAmmo(ammo.mag, ammo.reserve, this.weaponDef.name);
    this.hud.setGrenades(this.grenadeCount.frag, this.grenadeCount.smoke, this.selectedGrenade);
    this.hud.setMoney(this.player.money);
    this.hud.setScore(this.scoreWatch, this.scoreTide, this.round);
    if (this.phase === 'live' || this.phase === 'buy') this.hud.setTimer(this.phaseT, this.chargePlanted);
    this.hud.setAlive(
      [{ name: 'You', alive: this.player.alive }, ...this.squad.watch],
      this.squad.tide,
    );
    this.hud.setCrosshairGap(this.phase === 'live' ? this.spreadDeg : 0.5);
  }
}

function segmentBoxT(ax, ay, az, bx, by, bz, box) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let t0 = 0, t1 = 1;
  const o = [ax, ay, az], d = [dx, dy, dz];
  const lo = [box.minX, 0, box.minZ], hi = [box.maxX, box.top, box.maxZ];
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

function segmentHitsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return false;
  let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}
