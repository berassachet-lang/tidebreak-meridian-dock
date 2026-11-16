// TIDEBREAK — Meridian Dock: tuning, weapons, economy and palette.
// One place for every number the rest of the game reads, so balance changes
// never touch simulation code.
export const SIM_DT = 1 / 60;
export const ROUND_TIME = 100; // seconds of live play per round
export const BUY_TIME = 15; // seconds of buy phase before each round
export const PLANT_TIME = 3.5; // seconds holding E to plant
export const DEFUSE_TIME = 5.0; // seconds holding E to defuse
export const CHARGE_TIME = 35; // seconds from plant to detonation
export const ROUNDS_TO_WIN = 7;
export const MAX_ROUNDS = 13;
export const START_MONEY = 800;

export const ECON = {
  kill: 300,
  roundWin: 3250,
  roundLoss: 1900,
  plantBonus: 300,
  defuseBonus: 300,
};

export const PLAYER = {
  eyeHeight: 1.62,
  crouchEyeHeight: 1.08,
  radius: 0.42,
  height: 1.74,
  crouchHeight: 1.12,
  walkSpeed: 4.3,
  crouchSpeed: 2.2,
  accel: 42, // m/s^2 toward the wanted velocity
  health: 100,
};

export const BOT = {
  eyeHeight: 1.55,
  radius: 0.42,
  height: 1.7,
  walkSpeed: 3.4,
  runSpeed: 4.1,
  health: 100,
  // Reaction delay after first seeing an enemy, in seconds (per-bot jitter).
  reactMin: 0.28,
  reactMax: 0.55,
  // How far a bot can spot an enemy (m), shorter when the enemy crouches.
  sightRange: 46,
  hearRange: 26,
};

// Weapons. damage = body damage; headshots multiply by headMult. spread is in
// degrees of half-angle; bloom grows per shot and decays when not firing.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 SIDEARM', slot: 2, price: 0, auto: false,
    damage: 34, headMult: 2.5, mag: 12, reserve: 48, reload: 1.15,
    fireInterval: 0.3, spread: 0.55, moveSpread: 1.6, bloom: 0.5, bloomMax: 2.2,
    recoil: 0.55, range: 60, tracer: 0xffe9a8,
  },
  carbine: {
    id: 'carbine', name: 'KR-7 CARBINE', slot: 1, price: 2700, auto: true,
    damage: 33, headMult: 2.5, mag: 30, reserve: 90, reload: 2.1,
    fireInterval: 0.11, spread: 0.5, moveSpread: 1.9, bloom: 0.42, bloomMax: 2.6,
    recoil: 0.62, range: 80, tracer: 0xffd23e,
  },
  smg: {
    id: 'smg', name: 'VX-9 SMG', slot: 1, price: 1500, auto: true,
    damage: 26, headMult: 2.5, mag: 32, reserve: 96, reload: 1.7,
    fireInterval: 0.085, spread: 0.8, moveSpread: 1.7, bloom: 0.38, bloomMax: 2.8,
    recoil: 0.4, range: 45, tracer: 0x9be8ff,
  },
  scatter: {
    id: 'scatter', name: 'SG-12 SCATTERGUN', slot: 1, price: 1700, auto: false,
    damage: 11, headMult: 2.0, mag: 6, reserve: 24, reload: 2.6,
    fireInterval: 0.8, spread: 2.6, moveSpread: 1.2, bloom: 0.9, bloomMax: 3.0,
    recoil: 1.7, range: 26, pellets: 8, tracer: 0xffb27d,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag grenade', price: 300, fuse: 1.6, radius: 9, damage: 110 },
  smoke: { id: 'smoke', name: 'Smoke grenade', price: 250, fuse: 1.2, radius: 6, life: 14 },
};

export const TEAMS = {
  watch: { name: 'Harbor Watch', short: 'WATCH', color: 0x7fd4ff, css: '#7fd4ff' },
  tide: { name: 'Tidebreak', short: 'TIDE', color: 0xff9d6b, css: '#ff9d6b' },
};

// Dusk-harbor palette: deep teal sky, sodium-orange lamps, rust containers.
export const PALETTE = {
  sky: 0x2a3547,
  fog: 0x2e3648,
  ground: 0x3a3f45,
  groundLine: 0x2c3036,
  wall: 0x4a4f57,
  wallTop: 0x5d636d,
  containerTeal: 0x2e7f7a,
  containerRust: 0xb05a2a,
  containerBlue: 0x2f5d8a,
  containerSand: 0x9a7d4f,
  containerGrey: 0x6b7076,
  crane: 0xd8a13c,
  warehouse: 0x55606e,
  warehouseRoof: 0x3c4450,
  office: 0x7a6a52,
  lamp: 0xffb347,
  water: 0x14202e,
  siteA: 0xffd23e,
  siteB: 0x7fd4ff,
};

export const SITES = {
  A: { id: 'A', name: 'Quay Gate', center: [-21, -9], size: [7, 7] },
  B: { id: 'B', name: 'Cold Store', center: [21, -11], size: [7, 7] },
};

export const MAP = { halfX: 28, halfZ: 22, wallHeight: 6 };
