// Meridian Dock: a dusk container terminal, built entirely from boxes,
// cylinders and canvas-painted textures. No imported models, no images.
// Exports the three.js scene pieces plus the gameplay data: AABB colliders,
// the bot waypoint graph, spawns and bombsite zones.
import * as THREE from 'three';
import { MAP, PALETTE, SITES } from './config.js';

const tmpV = new THREE.Vector3();

// ---------------------------------------------------------------- textures
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function containerTexture(base, label) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 3, h);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(0, 0, w, 10);
    g.fillRect(0, h - 10, w, 10);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.fillText(label, w / 2, h / 2 + 9);
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 4;
    g.strokeRect(2, 2, w - 4, h - 4);
  });
}

function hazardTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#c9a227';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#15181d';
    for (let i = -h; i < w + h; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + 16, 0);
      g.lineTo(i + 16 + h, h);
      g.lineTo(i + h, h);
      g.closePath();
      g.fill();
    }
  });
}

function groundTexture() {
  return canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#3a3f45';
    g.fillRect(0, 0, w, h);
    // asphalt speckle
    for (let i = 0; i < 5200; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.09)';
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    // expansion joints
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // lane dashes down the middle
    g.fillStyle = 'rgba(255,210,62,0.55)';
    for (let y = 40; y < h; y += 96) g.fillRect(w / 2 - 4, y, 8, 48);
    // site letters, painted on the ground (world x -> canvas x, z -> canvas y)
    const px = (x) => ((x + MAP.halfX) / (MAP.halfX * 2)) * w;
    const py = (z) => ((z + MAP.halfZ) / (MAP.halfZ * 2)) * h;
    g.font = 'bold 150px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,210,62,0.85)';
    g.fillText('A', px(SITES.A.center[0]), py(SITES.A.center[1]));
    g.fillStyle = 'rgba(127,212,255,0.85)';
    g.fillText('B', px(SITES.B.center[0]), py(SITES.B.center[1]));
    // site zone outlines
    g.strokeStyle = 'rgba(255,210,62,0.6)';
    g.lineWidth = 5;
    g.strokeRect(px(SITES.A.center[0]) - 64, py(SITES.A.center[1]) - 64, 128, 128);
    g.strokeStyle = 'rgba(127,212,255,0.6)';
    g.strokeRect(px(SITES.B.center[0]) - 64, py(SITES.B.center[1]) - 64, 128, 128);
  });
}

// ---------------------------------------------------------------- map data
// Every solid is [centerX, centerZ, width, depth, height, color, label, baseY?].
// Height 0 means a flat visual only (not a collider). baseY stacks a box on
// top of another: its bottom sits at baseY instead of the ground.
const CONTAINERS = [
  // mid canyon, west wall of boxes
  [-6.5, -8, 6, 2.6, 2.6, PALETTE.containerTeal, 'MERID 07', 0],
  [-6.5, -8, 6, 2.6, 2.6, PALETTE.containerRust, 'TIDE 22', 2.6],
  [-6.5, 2, 6, 2.6, 5.2, PALETTE.containerBlue, 'NORTH 41', 0],
  [-6.5, 9, 6, 2.6, 2.6, PALETTE.containerSand, 'DOCK 13', 0],
  // mid canyon, east wall of boxes
  [6.5, -6, 6, 2.6, 2.6, PALETTE.containerRust, 'MERID 19', 0],
  [6.5, 4, 6, 2.6, 5.2, PALETTE.containerTeal, 'TIDE 08', 0],
  [6.5, 11, 6, 2.6, 2.6, PALETTE.containerGrey, 'NORTH 02', 0],
  // north stacks near the quay
  [-14, -16, 6, 2.6, 5.2, PALETTE.containerBlue, 'MERID 31', 0],
  [-14, -16, 6, 2.6, 2.6, PALETTE.containerSand, 'DOCK 55', 5.2],
  [12, -17, 6, 2.6, 2.6, PALETTE.containerGrey, 'TIDE 60', 0],
  [2, -15, 6, 2.6, 2.6, PALETTE.containerTeal, 'NORTH 77', 0],
  // south stacks, spawn cover
  [-12, 14, 6, 2.6, 2.6, PALETTE.containerRust, 'MERID 04', 0],
  [12, 15, 6, 2.6, 5.2, PALETTE.containerBlue, 'DOCK 90', 0],
  [0, 17.5, 6, 2.6, 2.6, PALETTE.containerSand, 'TIDE 15', 0],
  // site A cover
  [-17, -4, 2.6, 6, 2.6, PALETTE.containerTeal, 'MERID 12', 0],
  [-24, -14, 6, 2.6, 2.6, PALETTE.containerGrey, 'NORTH 33', 0],
  // site B cover
  [17, -6, 2.6, 6, 2.6, PALETTE.containerRust, 'DOCK 21', 0],
  [24, -16, 6, 2.6, 2.6, PALETTE.containerBlue, 'TIDE 48', 0],
];

const LOW_COVER = [
  // low walls and crates you can shoot over while crouched behind
  [-2, -2, 3, 1, 1.15, PALETTE.wallTop],
  [3, 6, 3, 1, 1.15, PALETTE.wallTop],
  [-11, 4, 1, 3, 1.15, PALETTE.wallTop],
  [11, -2, 1, 3, 1.15, PALETTE.wallTop],
  [-18, 8, 4, 1.2, 1.1, PALETTE.wallTop],
  [18, 8, 4, 1.2, 1.1, PALETTE.wallTop],
  [0, -10, 4, 1.2, 1.1, PALETTE.wallTop],
];

// Waypoint nodes for the bot graph. Attackers flow north -> sites; defenders
// flow south -> mid and site holds. Edges are built by line-of-sight.
const WAYPOINTS = [
  [0, -19], [-8, -19], [8, -19],          // tide spawn row
  [0, -13], [-8, -12], [8, -12],          // north mid
  [-14, -9], [14, -10],                    // site approaches
  [-21, -9], [21, -11],                    // sites A and B
  [-21, -2], [21, -3],                     // west / east lanes
  [-6, 0], [6, 0], [0, 2],                 // mid canyon
  [-14, 6], [14, 7],                       // south lanes
  [-6, 13], [6, 13], [0, 16],              // south mid
  [0, 19], [-8, 19], [8, 19],              // watch spawn row
  [-21, 12], [21, 12],                     // far lane ends
];

export const SPAWNS = {
  watch: [[-6, 19], [0, 19.5], [6, 19]],
  tide: [[-6, -19], [0, -19.5], [6, -19], [-2, -18.5]],
};

export function buildMap(scene) {
  const colliders = []; // {minX,maxX,minZ,maxZ,top}
  const minimapBoxes = []; // {x,z,w,d,color} for the 2D map
  const group = new THREE.Group();
  scene.add(group);

  const addCollider = (cx, cz, w, d, h) => {
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top: h });
  };
  const addBox = (cx, cy, cz, w, h, d, mat, collide = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, cz);
    m.castShadow = h > 2;
    m.receiveShadow = true;
    group.add(m);
    if (collide) addCollider(cx, cz, w, d, h);
    return m;
  };

  // Lighting: dusk sun low from the west, cool ambient fill.
  const hemi = new THREE.HemisphereLight(0x8fa3c7, 0x2c2620, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb37a, 1.5);
  sun.position.set(-30, 26, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32; sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 90;
  scene.add(sun);
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 130);
  scene.background = new THREE.Color(PALETTE.sky);

  // Ground with painted site letters and lane dashes.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.94, metalness: 0.05 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Water beyond the north quay wall.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(140, 40),
    new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.25, metalness: 0.6 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.5, -42);
  group.add(water);

  // Perimeter walls.
  const wallMat = new THREE.MeshStandardMaterial({ color: PALETTE.wall, roughness: 0.9 });
  const wallTopMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.85 });
  addBox(0, 3, -MAP.halfZ - 0.5, MAP.halfX * 2 + 2, 6, 1, wallMat);
  addBox(0, 3, MAP.halfZ + 0.5, MAP.halfX * 2 + 2, 6, 1, wallMat);
  addBox(-MAP.halfX - 0.5, 3, 0, 1, 6, MAP.halfZ * 2 + 2, wallMat);
  addBox(MAP.halfX + 0.5, 3, 0, 1, 6, MAP.halfZ * 2 + 2, wallMat);
  addBox(0, 6.25, -MAP.halfZ - 0.5, MAP.halfX * 2 + 2, 0.5, 1.4, wallTopMat, false);
  addBox(0, 6.25, MAP.halfZ + 0.5, MAP.halfX * 2 + 2, 0.5, 1.4, wallTopMat, false);
  minimapBoxes.push(
    { x: 0, z: -22, w: 56, d: 1, color: '#5d636d' },
    { x: 0, z: 22, w: 56, d: 1, color: '#5d636d' },
    { x: -28, z: 0, w: 1, d: 44, color: '#5d636d' },
    { x: 28, z: 0, w: 1, d: 44, color: '#5d636d' },
  );

  // Container stacks.
  for (const [cx, cz, w, d, h, color, label, baseY = 0] of CONTAINERS) {
    const tex = containerTexture('#' + color.toString(16).padStart(6, '0'), label);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.35 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, baseY + h / 2, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top: baseY + h });
    minimapBoxes.push({ x: cx, z: cz, w, d, color: '#' + color.toString(16).padStart(6, '0') });
  }
  // Stacked second layers (visual height on the taller stacks is already in
  // the data above; add edge trim so stacks read as separate boxes).
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.8 });
  for (const [cx, cz, w, d, h, , , baseY = 0] of CONTAINERS) {
    if (baseY > 0) addBox(cx, baseY - 0.08, cz, w + 0.06, 0.16, d + 0.06, trimMat, false);
    if (h > 4) addBox(cx, baseY + h - 0.08, cz, w + 0.06, 0.16, d + 0.06, trimMat, false);
  }

  // Low cover.
  const coverMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTop, roughness: 0.9 });
  for (const [cx, cz, w, d, h, color] of LOW_COVER) {
    addBox(cx, h / 2, cz, w, h, d, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    minimapBoxes.push({ x: cx, z: cz, w, d, color: '#8b929c' });
  }

  // Hazard-striped barriers at the two site mouths.
  const hz = hazardTexture();
  const hzMat = new THREE.MeshStandardMaterial({ map: hz, roughness: 0.8 });
  addBox(-15, 0.55, -3.5, 0.3, 1.1, 4, hzMat);
  addBox(15, 0.55, -4.5, 0.3, 1.1, 4, hzMat);

  // Crane gantry over the north mid: two legs and a beam with a hook block.
  const craneMat = new THREE.MeshStandardMaterial({ color: PALETTE.crane, roughness: 0.55, metalness: 0.5 });
  addBox(-10, 6, -14, 1.2, 12, 1.2, craneMat);
  addBox(10, 6, -14, 1.2, 12, 1.2, craneMat);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 1.4, 1.6), craneMat);
  beam.position.set(0, 12.4, -14);
  beam.castShadow = true;
  group.add(beam);
  const hook = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.6 }));
  hook.position.set(-3, 10.2, -14);
  group.add(hook);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4),
    new THREE.MeshStandardMaterial({ color: 0x111318 }));
  cable.position.set(-3, 11.6, -14);
  group.add(cable);

  // Cold Store (site B): open-fronted warehouse, roof on pillars.
  const whMat = new THREE.MeshStandardMaterial({ color: PALETTE.warehouse, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: PALETTE.warehouseRoof, roughness: 0.9 });
  addBox(24.5, 2.75, -11, 0.6, 5.5, 13, whMat); // east wall
  addBox(21, 2.75, -17.2, 8, 5.5, 0.6, whMat); // north wall
  addBox(21, 2.75, -4.8, 8, 5.5, 0.6, whMat); // south wall
  addBox(21, 5.75, -11, 8.6, 0.5, 13, roofMat, false); // roof
  addBox(17.4, 2.75, -17, 0.6, 5.5, 0.6, whMat); // west pillars
  addBox(17.4, 2.75, -5, 0.6, 5.5, 0.6, whMat);
  minimapBoxes.push({ x: 21, z: -11, w: 8, d: 13, color: '#55606e' });

  // Office hut (site A): low building with a door gap on its east face.
  const offMat = new THREE.MeshStandardMaterial({ color: PALETTE.office, roughness: 0.85 });
  addBox(-24.5, 1.6, -10, 0.6, 3.2, 9, offMat);
  addBox(-21, 1.6, -14.2, 8, 3.2, 0.6, offMat);
  addBox(-21, 1.6, -5.8, 8, 3.2, 0.6, offMat);
  addBox(-21, 3.35, -10, 8.6, 0.3, 9, roofMat, false);
  addBox(-17.6, 1.6, -13.4, 0.6, 3.2, 1.6, offMat);
  addBox(-17.6, 1.6, -6.6, 0.6, 3.2, 1.6, offMat);
  minimapBoxes.push({ x: -21, z: -10, w: 8, d: 9, color: '#7a6a52' });

  // Lamp poles: sodium floodlights over the mid and both sites.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.6, metalness: 0.5 });
  const lampMat = new THREE.MeshStandardMaterial({ color: PALETTE.lamp, emissive: PALETTE.lamp, emissiveIntensity: 1.6 });
  const lampSpots = [];
  for (const [lx, lz, withLight] of [[-14, 0, true], [14, 0, false], [-24, -2, true], [15, -16, false]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7), poleMat);
    pole.position.set(lx, 3.5, lz);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.5), lampMat);
    head.position.set(lx, 7.05, lz);
    group.add(head);
    if (withLight) {
      const s = new THREE.SpotLight(0xffb347, 260, 34, 0.62, 0.45, 1.4);
      s.position.set(lx, 7, lz);
      tmpV.set(lx, 0, lz);
      s.target.position.copy(tmpV);
      scene.add(s);
      scene.add(s.target);
      lampSpots.push(s);
    }
  }

  // Buoys on the water, blinking in the render loop (kept in group.userData).
  const buoyMat = new THREE.MeshStandardMaterial({ color: 0xff5040, emissive: 0xff2010, emissiveIntensity: 1.2 });
  const buoys = [];
  for (const [bx, bz] of [[-18, -30], [4, -34], [20, -29]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), buoyMat);
    b.position.set(bx, -0.1, bz);
    group.add(b);
    buoys.push(b);
  }
  group.userData.buoys = buoys;

  // Site markers: glowing floor rings.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 40),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? PALETTE.siteA : PALETTE.siteB, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.center[0], 0.03, s.center[1]);
    group.add(ring);
  }

  // Waypoint graph: connect nodes whose straight line clears all colliders.
  const nodes = WAYPOINTS.map(([x, z]) => ({ x, z, edges: [] }));
  const segClear = (a, b) => {
    for (const c of colliders) {
      if (segmentHitsBox(a.x, a.z, b.x, b.z, c, 0.7)) return false;
    }
    return true;
  };
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 11 && segClear(a, b)) {
        a.edges.push(j);
        b.edges.push(i);
      }
    }
  }
  return { group, colliders, nodes, minimapBoxes };
}

// 2D segment vs expanded AABB test (XZ plane).
function segmentHitsBox(x1, z1, x2, z2, box, pad) {
  const minX = box.minX - pad, maxX = box.maxX + pad;
  const minZ = box.minZ - pad, maxZ = box.maxZ + pad;
  const dx = x2 - x1, dz = z2 - z1;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (x1 < minX || x1 > maxX) return false;
  } else {
    let ta = (minX - x1) / dx, tb = (maxX - x1) / dx;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (z1 < minZ || z1 > maxZ) return false;
  } else {
    let ta = (minZ - z1) / dz, tb = (maxZ - z1) / dz;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Line of sight between two points at a given height, against colliders. */
export function hasLineOfSight(ax, ay, az, bx, by, bz, colliders) {
  for (const c of colliders) {
    if (c.top < Math.min(ay, by)) continue;
    if (segmentHitsBox3D(ax, ay, az, bx, by, bz, c)) return false;
  }
  return true;
}

function segmentHitsBox3D(ax, ay, az, bx, by, bz, box) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  let t0 = 0, t1 = 1;
  const axes = [
    [ax, dx, box.minX, box.maxX],
    [ay, dy, 0, box.top],
    [az, dz, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
    } else {
      let ta = (lo - o) / d, tb = (hi - o) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}
