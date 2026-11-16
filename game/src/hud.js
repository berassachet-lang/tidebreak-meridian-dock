// HUD: health/ammo/timer/score, kill feed, banners, the buy menu and the
// top-down minimap. DOM writes are cached so unchanged values never touch
// the layout. All ids match index.html.
import { WEAPONS, GRENADES, ECON, SITES } from './config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(mapData) {
    this.mapData = mapData; // {minimapBoxes}
    this.cache = new Map();
    this.mm = $('minimap').getContext('2d');
    this.buyOpen = false;
    this.onBuy = null; // (id) => void, set by the game
    this.buildBuyMenu();
  }

  _set(id, value) {
    if (this.cache.get(id) === value) return;
    this.cache.set(id, value);
    const el = $(id);
    if (el) el.textContent = value;
  }

  _show(id, show) {
    const el = $(id);
    if (el) el.classList.toggle('hidden', !show);
  }

  showHud(show) { this._show('hud', show); }

  setHealth(hp, armor) {
    this._set('health-num', String(Math.ceil(hp)));
    $('health-num').classList.toggle('low', hp <= 30);
    const fill = $('health-fill');
    fill.style.width = `${Math.max(0, hp)}%`;
    fill.classList.toggle('low', hp <= 30);
    this._set('armor-num', String(Math.ceil(armor)));
  }

  setAmmo(mag, reserve, name) {
    this._set('ammo-mag', String(mag));
    this._set('ammo-reserve', `/ ${reserve}`);
    this._set('weapon-name', name);
  }

  setGrenades(frag, smoke, selected) {
    this._set('grenades', `G [${selected === 'frag' ? '●' : '○'}] Frag ×${frag}   [${selected === 'smoke' ? '●' : '○'}] Smoke ×${smoke}`);
  }

  setMoney(m) {
    this._set('money', `$${m}`);
    this._set('buy-money', `— $${m}`);
  }

  setScore(us, them, round) {
    this._set('score-us', String(us));
    this._set('score-them', String(them));
    this._set('round-label', `ROUND ${round}`);
  }

  setTimer(seconds, planted) {
    const s = Math.max(0, Math.ceil(seconds));
    this._set('timer-value', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    $('timer-value').classList.toggle('low', s <= 10);
    if (planted) $('timer-value').style.color = '#ff5d5d';
    else $('timer-value').style.color = '';
  }

  setObjective(text) { this._set('objective-text', text); }

  setAlive(usList, themList) {
    this._set('alive-us', `WATCH ● ${usList.filter((f) => f.alive).map((f) => f.name ?? 'You').join(' ')}`);
    this._set('alive-them', `TIDE ● ${themList.filter((f) => f.alive).map((f) => f.name).join(' ')}`);
  }

  setCrosshairGap(spreadDeg) {
    const px = 8 + spreadDeg * 9;
    $('crosshair').style.setProperty('--gap', `${px.toFixed(1)}px`);
  }

  hitmarker(kill) {
    const el = $('hitmarker');
    el.classList.toggle('kill', !!kill);
    el.style.opacity = '1';
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { el.style.opacity = '0'; }, 140);
  }

  damageFlash() {
    const el = $('damage-vignette');
    el.style.opacity = '1';
    clearTimeout(this._dvT);
    this._dvT = setTimeout(() => { el.style.opacity = '0'; }, 160);
  }

  showBanner(title, sub, kind = '', ms = 2600) {
    const b = $('banner');
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub || '';
    b.className = kind;
    b.classList.remove('hidden');
    clearTimeout(this._banT);
    this._banT = setTimeout(() => b.classList.add('hidden'), ms);
  }

  hideBanner() { $('banner').classList.add('hidden'); }

  showPrompt(html) {
    const p = $('prompt');
    p.innerHTML = html;
    p.classList.remove('hidden');
  }

  hidePrompt() { $('prompt').classList.add('hidden'); }

  setReloading(on) { this._show('reload-hint', on); }

  killfeed(killer, victim, headshot, killerTeam, victimTeam) {
    const feed = $('killfeed');
    const div = document.createElement('div');
    const kc = killerTeam === 'watch' ? 'kf-us' : 'kf-them';
    const vc = victimTeam === 'watch' ? 'kf-us' : 'kf-them';
    div.innerHTML = `<span class="${kc}">${killer}</span> ${headshot ? '⌖' : '→'} <span class="${vc}">${victim}</span>`;
    feed.prepend(div);
    while (feed.children.length > 4) feed.lastChild.remove();
    setTimeout(() => div.remove(), 6000);
  }

  // ------------------------------------------------------------ buy menu
  buildBuyMenu() {
    const grid = $('buy-grid');
    const items = [
      { id: 'carbine', key: '1', name: WEAPONS.carbine.name, price: WEAPONS.carbine.price, desc: 'Auto rifle · 30 rnd · accurate at range' },
      { id: 'smg', key: '2', name: WEAPONS.smg.name, price: WEAPONS.smg.price, desc: 'Fast SMG · 32 rnd · close quarters' },
      { id: 'scatter', key: '3', name: WEAPONS.scatter.name, price: WEAPONS.scatter.price, desc: '8-pellet scattergun · 6 shells · devastating up close' },
      { id: 'armor', key: '4', name: 'KEVLAR VEST', price: 650, desc: 'Armor 50 · absorbs half of incoming damage' },
      { id: 'frag', key: '5', name: 'FRAG GRENADE', price: GRENADES.frag.price, desc: 'Timed explosive · 110 damage in 9 m' },
      { id: 'smoke', key: '6', name: 'SMOKE GRENADE', price: GRENADES.smoke.price, desc: '14 s smoke wall · blocks sight lines' },
    ];
    for (const it of items) {
      const div = document.createElement('div');
      div.className = 'buy-item';
      div.dataset.buyId = it.id;
      div.innerHTML = `<div class="bi-name">${it.name}<span>[${it.key}]</span></div><div class="bi-desc">${it.desc}</div><div class="bi-price">$${it.price}</div>`;
      div.addEventListener('click', () => this.onBuy && this.onBuy(it.id));
      grid.appendChild(div);
    }
  }

  setBuyOpen(open) {
    this.buyOpen = open;
    this._show('buy-menu', open);
    if (open) this.refreshBuyOwned();
  }

  refreshBuyOwned(ownedIds = []) {
    for (const el of document.querySelectorAll('.buy-item')) {
      el.classList.toggle('owned', ownedIds.includes(el.dataset.buyId));
    }
  }

  // ------------------------------------------------------------ minimap
  drawMinimap(player, allies, enemies, pings, time) {
    const g = this.mm;
    const W = 336, H = 264;
    const sx = (x) => ((x + 28) / 56) * W;
    const sy = (z) => ((z + 22) / 44) * H;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#12161f';
    g.fillRect(0, 0, W, H);
    // Static boxes.
    for (const b of this.mapData.minimapBoxes) {
      g.fillStyle = b.color;
      g.fillRect(sx(b.x - b.w / 2), sy(b.z - b.d / 2), Math.max(2, (b.w / 56) * W), Math.max(2, (b.d / 44) * H));
    }
    // Sites.
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      g.strokeStyle = key === 'A' ? '#ffd23e' : '#7fd4ff';
      g.lineWidth = 1.5;
      g.strokeRect(sx(s.center[0] - 3.5), sy(s.center[1] - 3.5), 7 * 6, 7 * 6);
      g.fillStyle = g.strokeStyle;
      g.font = 'bold 13px monospace';
      g.fillText(key, sx(s.center[0]) - 4, sy(s.center[1]) + 4);
    }
    // Noise pings (recent gunfire) fade over 3 s.
    for (const p of pings) {
      const age = time - p.at;
      if (age > 3) continue;
      g.strokeStyle = `rgba(255,93,93,${1 - age / 3})`;
      g.beginPath();
      g.arc(sx(p.x), sy(p.z), 4 + age * 6, 0, Math.PI * 2);
      g.stroke();
    }
    // Enemies, only when recently seen or heard.
    for (const e of enemies) {
      if (!e.alive) continue;
      const seen = e.lastSeenAt !== undefined && time - e.lastSeenAt < 3;
      if (!seen) continue;
      g.fillStyle = '#ff5d5d';
      g.beginPath();
      g.arc(sx(e.pos.x), sy(e.pos.z), 4, 0, Math.PI * 2);
      g.fill();
    }
    // Allies.
    for (const a of allies) {
      if (!a.alive) continue;
      g.fillStyle = '#7fd4ff';
      g.beginPath();
      g.arc(sx(a.pos.x), sy(a.pos.z), 4, 0, Math.PI * 2);
      g.fill();
    }
    // Player arrow.
    if (player.alive) {
      const px = sx(player.pos.x), py = sy(player.pos.z);
      g.save();
      g.translate(px, py);
      g.rotate(Math.atan2(-Math.sin(player.yaw), -Math.cos(player.yaw)) + Math.PI / 2);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -7);
      g.lineTo(5, 6);
      g.lineTo(-5, 6);
      g.closePath();
      g.fill();
      g.restore();
    }
  }
}
