import * as THREE from 'three';
import { applyRandomizer, generateWorldMap, mulberry32, hashSeed } from './randomizer.js';

// ---------------------------------------------------------------------------
// Constants (from uw2ol: code/common/constants.py)
// ---------------------------------------------------------------------------
const COLS = 2160;            // world map width  in tiles
const ROWS = 1080;            // world map height in tiles
const TILESET_COLS = 16;      // tiles per row in the tileset image
const TILESET_ROWS = 8;
const SAILABLE = new Set(Array.from({ length: 32 }, (_, i) => i + 1)); // ids 1..32
const DAY_LENGTH_SEC = 180;   // one full in-game day
const SAIL_DAY_SCALE = 10;    // time flows this much faster under sail (voyages cost days)
const PORT_SIZE = 96;         // port maps are 96x96 tiles
const PORT_WALK_MAX = 39;     // walkable port tile ids: 1..39
const PORT_WALK_MAX_ASIA = 46;
const WALK_SPEED = 6;         // tiles per second in port (x2 with Shift)

// ---------------------------------------------------------------------------
// Renderer / camera (created first: textures need the max anisotropy)
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
let camDist = 34;                       // zoom level (wheel)
const CAM_TILT = 0.35;                  // radians from vertical

// --- Mega Drive palette mode flag (must exist before any texture loads) ---
const MD_KEY = 'uw-md-mode';
const mdMode = localStorage.getItem(MD_KEY) === '1';

// ---------------------------------------------------------------------------
// Boot: load all assets, then init
// ---------------------------------------------------------------------------
const [mapBuf, portMapBuf, ports, portMeta, buildingNames, villages, goodsData, shipData, matesData, maidsData, towns, ruins, shipTex, personTex, npcAtlasTex, heroesTex] =
  await Promise.all([
    fetch('./assets/world_map.bin').then(r => r.arrayBuffer()),
    fetch('./assets/portmaps.bin').then(r => r.arrayBuffer()),
    fetch('./assets/ports.json').then(r => r.json()),
    fetch('./assets/port_meta.json').then(r => r.json()),
    fetch('./assets/building_names.json').then(r => r.json()),
    fetch('./assets/villages.json').then(r => r.json()),
    fetch('./assets/goods.json').then(r => r.json()),
    fetch('./assets/ships.json').then(r => r.json()),
    fetch('./assets/mates.json').then(r => r.json()),
    fetch('./assets/maids.json').then(r => r.json()),
    fetch('./assets/towns.json').then(r => r.json()),
    fetch('./assets/ruins.json').then(r => r.json()),
    loadTex('./assets/ship-tileset.png', false),
    loadTex('./assets/person-tileset.png', false),
    loadTex('./assets/npc_atlas.png', false),
    loadTex('./assets/heroes.png', false),
  ]);
let mapData = new Uint8Array(mapBuf);
const portMaps = new Uint8Array(portMapBuf);   // 101 maps of 96*96

// Isabella's companions — custom mates with waifulabs portraits (id > 50, injected)
Object.assign(matesData, {
  51: { name: 'Eudora', nation: 'Portugal', lv: 3, leadership: 40, seamanship: 45, knowledge: 75, intuition: 70, courage: 40, swordplay: 30, luck: 65, accounting: 20, gunnery: 10, navigation: 30, image: [1, 1], portrait: './assets/waifu/eudora.png' },
  52: { name: 'Mita', nation: 'Portugal', lv: 2, leadership: 45, seamanship: 65, knowledge: 50, intuition: 55, courage: 50, swordplay: 45, luck: 55, accounting: 30, gunnery: 20, navigation: 65, image: [1, 1], portrait: './assets/waifu/mita.png' },
  53: { name: 'Sophia', nation: 'Portugal', lv: 2, leadership: 40, seamanship: 50, knowledge: 65, intuition: 60, courage: 40, swordplay: 35, luck: 60, accounting: 60, gunnery: 15, navigation: 40, image: [1, 1], portrait: './assets/waifu/sophia.png' },
  54: { name: 'Barbara', nation: 'Portugal', lv: 2, leadership: 50, seamanship: 55, knowledge: 45, intuition: 50, courage: 65, swordplay: 60, luck: 50, accounting: 25, gunnery: 40, navigation: 45, image: [1, 1], portrait: './assets/waifu/barbara.png' },
});

const phaseNames = ['dawn', 'day', 'dusk', 'night'];
const phaseTex = {};
await Promise.all(phaseNames.map(async n => {
  phaseTex[n] = await loadTex(`./assets/tiles_${n}.png`);
}));

// --- Mega Drive palette transform: quantize to 9-bit color + boost contrast --
function mdTransform(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 10) continue;
    // 9-bit color depth (Mega Drive: 32 steps per channel) + MD-style punch
    for (let ch = 0; ch < 3; ch++) {
      const v = px[i + ch] / 255;
      const c = Math.max(0, Math.min(1, (v - 0.5) * 1.22 + 0.47));   // contrast
      px[i + ch] = Math.round(c * 31) * 255 / 31;
    }
    // saturation boost (MD colors are punchier)
    const r = px[i], gg = px[i + 1], b = px[i + 2];
    const lum = (r + gg + b) / 3;
    px[i]     = Math.max(0, Math.min(255, r + (r - lum) * 0.35));
    px[i + 1] = Math.max(0, Math.min(255, gg + (gg - lum) * 0.35));
    px[i + 2] = Math.max(0, Math.min(255, b + (b - lum) * 0.35));
  }
  g.putImageData(d, 0, 0);
  return c;
}

// Tilesets: raw colors (no sRGB decode — output matches the original PNGs),
// mipmaps + anisotropy so distant tiles blend instead of moiré-striping.
// (texel-center sampling in the shader keeps magnified pixels crisp even
//  with LinearFilter; filtering only kicks in when tiles are minified.)
// Sprites (filter=false): crisp nearest, no mipmaps.
function loadTex(url, filter = true) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
    if (mdMode) t.image = mdTransform(t.image);
    if (filter) {
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = maxAniso;
    } else {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
    }
    res(t);
  }, undefined, rej));
}

// the world is a torus: edges wrap west<->east and north<->south
const wrapX = x => ((x % COLS) + COLS) % COLS;
const wrapZ = z => ((z % ROWS) + ROWS) % ROWS;
const tileAt = (col, row) => mapData[wrapZ(row) * COLS + wrapX(col)];
const sailableAt = (x, z) => SAILABLE.has(tileAt(Math.floor(x), Math.floor(z)));
// shortest distance on the torus (wrap-aware)
const distT = (ax, az, bx, bz) => {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  return Math.hypot(Math.min(dx, COLS - dx), Math.min(dz, ROWS - dz));
};
// nearest item of `list` within maxD tiles of (x, z), wrap-aware;
// getZ handles lists whose second coordinate is stored as `y` (ports, villages)
function nearestOf(list, x, z, maxD, getZ = it => it.z) {
  let best = null, bestD = maxD;
  for (const it of list) {
    const d = distT(it.x, getZ(it), x, z);
    if (d < bestD) { best = it; bestD = d; }
  }
  return best;
}
// plain 2D distance from the ship to a map point (no wrap — used for local checks)
const shipDist2D = (x, z) => Math.hypot(x - shipPos.x, z - shipPos.z);

// --- randomizer (UWNHRando-style): applied at boot when a seed is stored ----
const isLandTile = (x, z) => !SAILABLE.has(tileAt(Math.floor(x), Math.floor(z)));
// precomputed land/coast tile lists (coast = land with a SAILABLE neighbor)
let landList = [], coastList = [];
function buildGeoLists() {
  landList = [];
  coastList = [];
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      if (isLandTile(x, z)) {
        landList.push(x, z);
        if (sailableAt(x + 1, z) || sailableAt(x - 1, z) ||
            sailableAt(x, z + 1) || sailableAt(x, z - 1)) {
          coastList.push(x, z);
        }
      }
    }
  }
}
const snapCoast = rnd => {
  const i = Math.floor(rnd() * (coastList.length / 2)) * 2;
  return [coastList[i], coastList[i + 1]];
};
const snapLand = rnd => {
  const i = Math.floor(rnd() * (landList.length / 2)) * 2;
  return [landList[i], landList[i + 1]];
};

const RANDO_KEY = 'uw-rando';
let randoSummary = null;
let randoSeedStr = '';
const randoPortDev = {};
try {
  const ro = JSON.parse(localStorage.getItem(RANDO_KEY));
  if (ro && ro.seed) {
    randoSeedStr = ro.seed;
    if (ro.mapStructure) {
      // generate a brand new world map (UWNHRando's flagship feature)
      const { data, sealedLakes } = generateWorldMap(
        mulberry32(hashSeed(ro.seed) ^ 0x9e3779b9), COLS, ROWS, 1, [74, 66, 82],
        { landPct: ro.landPct, continents: ro.continents,
          riverCount: ro.riverCount, mountCount: ro.mountCount,
          polar: ro.polar, coastSmoothing: ro.coastSmoothing });
      mapData = data;
      randoSummary = { seed: ro.seed, mapStructure: true, sealedLakes };
    }
    buildGeoLists();
    const summary = applyRandomizer(
      { seed: ro.seed, markets: ro.markets ?? true, specialties: ro.specialties ?? true,
        startShip: ro.startShip ?? true, portDev: ro.portDev ?? true,
        // a new map forces relocation of ports and discoveries
        portLocations: ro.mapStructure ? true : (ro.portLocations ?? false),
        discoveries: ro.mapStructure ? true : (ro.discoveries ?? false) },
      { goodsData, villages, ports, portMeta,
        portRegion: pid => (portMeta[pid] ?? portMeta[Math.min(pid, 101)])?.region,
        portDev: randoPortDev, snapCoast, snapLand,
        ships: Object.entries(shipData).map(([name, a]) => ({ name, ...a })) });
    randoSummary = { ...(randoSummary ?? {}), ...summary, seed: summary.seed ?? randoSummary?.seed };
  }
} catch (e) { console.warn('randomizer failed', e); }

// ---------------------------------------------------------------------------
// Tilemap shader (shared by world map and port maps)
// ---------------------------------------------------------------------------
function makeTilemapMesh(data, cols, rows, texA, texB, tsCols = TILESET_COLS, tsRows = TILESET_ROWS) {
  const dataTex = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.UnsignedByteType);
  dataTex.magFilter = THREE.NearestFilter;
  dataTex.minFilter = THREE.NearestFilter;
  dataTex.needsUpdate = true;

  const uniforms = {
    mapData:   { value: dataTex },
    tilesA:    { value: texA },
    tilesB:    { value: texB },
    blend:     { value: 0 },
    mapSize:   { value: new THREE.Vector2(cols, rows) },
    tilesetSize: { value: new THREE.Vector2(tsCols, tsRows) },
  };

  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms,
    vertexShader: /* glsl */`
      out vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D mapData, tilesA, tilesB;
      uniform float blend;
      uniform vec2 mapSize, tilesetSize;
      in vec2 vUv;
      out vec4 fragColor;

      vec3 sampleTileset(sampler2D ts, vec2 tileXY, vec2 frac) {
        float t = texture(mapData, vec2((tileXY.x + 0.5) / mapSize.x,
                                        1.0 - (tileXY.y + 0.5) / mapSize.y)).r * 255.0;
        float idx = t - 1.0;                       // tile ids start at 1
        float tx = mod(idx, tilesetSize.x);
        float ty = floor(idx / tilesetSize.x);     // row from top
        // exact texel lookup, tileset is 16px tiles, flipY = true
        vec2 tilesetPx = tilesetSize * 16.0;
        vec2 texel = vec2(tx * 16.0 + floor(frac.x * 16.0) + 0.5,
                          ty * 16.0 + floor((1.0 - frac.y) * 16.0) + 0.5);
        vec2 uv = vec2(texel.x / tilesetPx.x, 1.0 - texel.y / tilesetPx.y);
        // continuous derivatives (frac is smooth within a tile) so the GPU
        // picks the right mip level / anisotropy — kills moire on dithered tiles
        vec2 gx = dFdx(vUv) * 16.0 * mapSize / tilesetPx;
        vec2 gy = dFdy(vUv) * 16.0 * mapSize / tilesetPx;
        return textureGrad(ts, uv, gx, gy).rgb;
      }

      void main() {
        vec2 pos = vUv * mapSize;
        vec2 tileXY = floor(pos);
        vec2 frac = fract(pos);
        vec3 a = sampleTileset(tilesA, tileXY, frac);
        vec3 b = sampleTileset(tilesB, tileXY, frac);
        fragColor = vec4(mix(a, b, blend), 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cols / 2, 0, rows / 2);
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Sprite factory: flat textured quad lying on the map (ships, people, npcs)
// ---------------------------------------------------------------------------
function makeSprite(tex, repX, repY, size = 2) {
  const map = tex.clone();
  map.needsUpdate = true;
  map.repeat.set(repX, repY);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}
// direction frame helper (sprite sheets share the up/right/down/left layout)
const shipFrame = (map, dir, frame, row) =>
  map.offset.set((DIRECTION_COL[dir] + frame) / 8, (3 - row) / 4);

// ---------------------------------------------------------------------------
// Sea scene
// ---------------------------------------------------------------------------
const seaScene = new THREE.Scene();
seaScene.background = new THREE.Color(0x020a14);

const world = makeTilemapMesh(mapData, COLS, ROWS, phaseTex.day, phaseTex.day);
// toroidal world: render the map as a 3x3 grid of copies so edges connect
// seamlessly (meshes share one material; three.js frustum-culls the rest)
for (let ox = -1; ox <= 1; ox++) {
  for (let oz = -1; oz <= 1; oz++) {
    if (ox === 0 && oz === 0) { seaScene.add(world.mesh); continue; }
    const copy = new THREE.Mesh(world.mesh.geometry, world.mesh.material);
    copy.rotation.copy(world.mesh.rotation);
    copy.position.set(world.mesh.position.x + ox * COLS, 0,
                      world.mesh.position.z + oz * ROWS);
    seaScene.add(copy);
  }
}

// --- ship: flat quad just above the map, UV window into the sprite sheet ---
// Sprite sheet: 8 cols x 4 rows of 32px; row 1 (from top) = player ship.
// cols: up 0-1, right 2-3, down 4-5, left 6-7 (two frames each)
const ship = makeSprite(shipTex, 1 / 8, 1 / 4);
const shipMap = ship.material.map;
seaScene.add(ship);

const DIRECTION_COL = { up: 0, right: 2, down: 4, left: 6,
                        ne: 2, se: 2, nw: 6, sw: 6 };
let shipDir = 'down';
let animFrame = 0, animTimer = 0, storyT = 0;

function updateShipSprite() {
  shipFrame(shipMap, shipDir, animFrame, curShip().row);   // sprite row by ship size
}

// start position: just off Lisbon (relocated when the map is randomized)
const lisbon = ports.find(p => p.id === 1);
const [startX, startZ] = sailableNear(lisbon.x, lisbon.y);
const shipPos = new THREE.Vector3(startX, 0.4, startZ);

// --- port markers: the original map icons (117 = city port, 121 = supply) ---
// port/village icons are 2x2 tiles laid out consecutively in ONE tileset row:
// [tl, tr, bl, br] — city 117-120, supply 121-124, village 125-128
function iconTexture(tid) {
  const img = phaseTex.day.image;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const tile = (t, dx, dy) => {
    const sx = (t - 1) % 16 * 16, sy = ((t - 1) / 16 | 0) * 16;
    g.drawImage(img, sx, sy, 16, 16, dx, dy, 16, 16);
  };
  tile(tid, 0, 0);
  tile(tid + 1, 16, 0);
  tile(tid + 2, 0, 16);
  tile(tid + 3, 16, 16);
  // chroma-key the sea-blue background (sample the top-left pixel)
  const d = g.getImageData(0, 0, 32, 32);
  const bg = g.getImageData(0, 0, 1, 1).data;
  for (let i = 0; i < d.data.length; i += 4) {
    if (Math.abs(d.data[i] - bg[0]) < 30 &&
        Math.abs(d.data[i + 1] - bg[1]) < 30 &&
        Math.abs(d.data[i + 2] - bg[2]) < 30) {
      d.data[i + 3] = 0;
    }
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}
const portIconTex = iconTexture(117);
const supplyIconTex = iconTexture(121);
const villageIconTex = iconTexture(125);
const villagePoints = makePortPoints(
  villages.map(v => ({ id: v.id, x: v.x, y: v.y })), villageIconTex);
seaScene.add(villagePoints);

function makePortPoints(list, tex) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(list.length * 3);
  list.forEach((p, i) => { pos.set([p.x + 0.5, 0.6, p.y + 0.5], i * 3); });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    map: tex, size: 2.2, transparent: true, depthWrite: false, sizeAttenuation: true,
  }));
}
const cityPorts = ports.filter(p => p.id <= 101 || p.id === 132);   // Faro (132) is a city port
const supplyPorts = ports.filter(p => p.id > 101 && p.id !== 132);
const portPoints = makePortPoints(cityPorts, portIconTex);
const supplyPoints = makePortPoints(supplyPorts, supplyIconTex);
seaScene.add(portPoints);
seaScene.add(supplyPoints);
// toroidal world: every marker cloud gets 8 wrap-around copies so edges connect
function addWrapCopies(base) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      if (ox === 0 && oz === 0) continue;
      const pp = new THREE.Points(base.geometry, base.material);
      pp.position.set(ox * COLS, 0, oz * ROWS);
      seaScene.add(pp);
    }
  }
}
for (const base of [portPoints, supplyPoints, villagePoints]) addWrapCopies(base);

function makeDotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,217,77,0.9)');
  grad.addColorStop(1, 'rgba(255,217,77,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const markerTex = makeDotTexture();

// towns (blue) and ruins (purple) get their own markers, visible everywhere
function makeMarkers(list, color) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(list.length * 3);
  list.forEach((t, i) => { pos.set([t.x + 0.5, 0.6, (t.z ?? t.y) + 0.5], i * 3); });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    map: markerTex, size: 1.6, transparent: true, depthWrite: false,
    color, sizeAttenuation: true,
  }));
}
const townPoints = makeMarkers(towns, 0x60a5fa);
const ruinPoints = makeMarkers(ruins, 0xc084fc);
for (const pts of [townPoints, ruinPoints]) {
  seaScene.add(pts);
  addWrapCopies(pts);
}



// ---------------------------------------------------------------------------
// Port scene (built on demand when entering a port)
// ---------------------------------------------------------------------------
const portScene = new THREE.Scene();
portScene.background = new THREE.Color(0x020a14);

// person sprite: the 6 UW2 protagonists (DOS sheet, 8 cols x 6 rows of 68px)
const HEROES_W = 544, HEROES_H = 612;
const person = makeSprite(heroesTex, 68 / HEROES_W, 68 / HEROES_H, 2.4);
const personMap = person.material.map;
portScene.add(person);

const personPos = new THREE.Vector3(48, 0.4, 48);
let personDir = 'down';

// the 6 UW2 protagonists from the DOS sheet (rows 0-5);
// cols per character: up 0-1, left 2-3, down 4-5, right 6-7
const CHARACTER_NAMES = ['João Ferrero', 'Catalina Erantzo', 'Otto Baynes',
                         'Ernst Von Bohr', 'Pietro Conti', 'Ali Vezas', 'Isabella'];
// hero nationalities (index matches CHARACTER_NAMES)
const HERO_NATION = ['Portugal', 'Spain', 'England', 'Holland', 'Italy', 'Turkey', 'Portugal'];
// hero CRPG base attributes {str, agi, con, int, per, cha} (3-18), themed per character
const HERO_ATTRS = [
  { str: 12, agi: 12, con: 12, int: 12, per: 12, cha: 14 },  // João — balanced leader
  { str: 14, agi: 14, con: 12, int: 10, per: 12, cha: 12 },  // Catalina — fierce pirate
  { str: 15, agi: 11, con: 14, int: 10, per: 10, cha: 13 },  // Otto — stalwart knight
  { str: 9, agi: 11, con: 10, int: 16, per: 14, cha: 10 },   // Ernst — brilliant geographer
  { str: 12, agi: 13, con: 12, int: 11, per: 14, cha: 11 },  // Pietro — lucky treasure hunter
  { str: 10, agi: 12, con: 11, int: 13, per: 12, cha: 15 },  // Ali — charming merchant
  { str: 8, agi: 11, con: 10, int: 16, per: 13, cha: 12 },   // Isabella — scholar
];

// Main storylines — one per hero, 5 chapters each. check() = completion condition,
// progress() = "cur/goal" text, reward = gold, text = narrative beat on completion.
const STORYLINES = [
  { title: 'The Secret of Atlantis', steps: [                       // 0 João
    { name: 'For the Glory of Portugal', goal: 'Reach fame 5',
      check: () => P.fame >= 5, progress: () => `${Math.min(P.fame, 5)}/5 fame`, reward: 500,
      text: 'Well sailed, João! Word of your exploits reaches Duke Leon\'s court. Your voyage for Portugal\'s glory has begun.' },
    { name: 'Proving Your Worth', goal: 'Make 3 discoveries',
      check: () => discoveriesFound.size >= 3, progress: () => `${Math.min(discoveriesFound.size, 3)}/3`, reward: 1000,
      text: 'Your discoveries are the talk of Lisbon. The Duke watches your progress with growing pride.' },
    { name: 'Royal Favor', goal: 'Reach fame 15',
      check: () => P.fame >= 15, progress: () => `${Math.min(P.fame, 15)}/15 fame`, reward: 2000,
      text: 'The crown grants you an audience. "Continue, João — perhaps the legend of Atlantis is more than myth."' },
    { name: 'The Atlantis Legend', goal: 'Make 8 discoveries',
      check: () => discoveriesFound.size >= 8, progress: () => `${Math.min(discoveriesFound.size, 8)}/8`, reward: 3000,
      text: 'Fragments of an ancient map hint at a sunken continent. The secret of Atlantis feels within reach.' },
    { name: 'The Lost Continent', goal: 'Make 15 discoveries',
      check: () => discoveriesFound.size >= 15, progress: () => `${Math.min(discoveriesFound.size, 15)}/15`, reward: 10000,
      text: 'At last — the lost land of Atlantis rises from legend! Your name will echo through the ages, son of Duke Leon Franco.' } ] },
  { title: 'Vengeance', steps: [                                    // 1 Catalina
    { name: 'The Red-Haired Pirate', goal: 'Reach fame 5',
      check: () => P.fame >= 5, progress: () => `${Math.min(P.fame, 5)}/5 fame`, reward: 500,
      text: 'Your name is whispered in every tavern. The trail of your brother and your beloved grows warmer.' },
    { name: 'Hunting the Trail', goal: 'Sink 3 ships',
      check: () => P.shipsSunk >= 3, progress: () => `${Math.min(P.shipsSunk, 3)}/3`, reward: 1000,
      text: 'Each sunken ship brings you closer to the ones responsible. Portugal will answer for their loss.' },
    { name: 'Growing Notoriety', goal: 'Reach fame 15',
      check: () => P.fame >= 15, progress: () => `${Math.min(P.fame, 15)}/15 fame`, reward: 2000,
      text: 'The red-haired pirate is feared across the seas. Your enemies know you are coming.' },
    { name: 'The Betrayer\'s Trail', goal: 'Sink 8 ships',
      check: () => P.shipsSunk >= 8, progress: () => `${Math.min(P.shipsSunk, 8)}/8`, reward: 3000,
      text: 'The web of betrayal unravels. You can almost see the faces of those who took everything from you.' },
    { name: 'Vengeance at Last', goal: 'Sink 15 ships',
      check: () => P.shipsSunk >= 15, progress: () => `${Math.min(P.shipsSunk, 15)}/15`, reward: 10000,
      text: 'It is done. The sea has claimed your vengeance. May your brother and your beloved finally rest in peace.' } ] },
  { title: 'The King\'s Privateer', steps: [                        // 2 Otto
    { name: 'Secret Orders', goal: 'Reach fame 5 (Squire)',
      check: () => P.fame >= 5, progress: () => `${Math.min(P.fame, 5)}/5 fame`, reward: 500,
      text: 'King Henry\'s seal glints in your hand. Sail as a privateer, Sir Otto — and keep your mission secret.' },
    { name: 'Proving Loyalty', goal: 'Reach fame 10 (Knight)',
      check: () => P.fame >= 10, progress: () => `${Math.min(P.fame, 10)}/10 fame`, reward: 1000,
      text: 'Your deeds reach London. The King is pleased with his secret knight.' },
    { name: 'Rising Star', goal: 'Reach fame 20 (Viscount)',
      check: () => P.fame >= 20, progress: () => `${Math.min(P.fame, 20)}/20 fame`, reward: 2000,
      text: 'Spain\'s admirals curse your name. The Spanish Fleet weakens under your privateering.' },
    { name: 'The King\'s Trust', goal: 'Reach fame 30 (Earl)',
      check: () => P.fame >= 30, progress: () => `${Math.min(P.fame, 30)}/30 fame`, reward: 3000,
      text: 'The King himself commends you. England\'s dominance of the seas is nearly assured.' },
    { name: 'Hero of England', goal: 'Reach fame 50 (Duke)',
      check: () => P.fame >= 50, progress: () => `${Math.min(P.fame, 50)}/50 fame`, reward: 10000,
      text: 'The Spanish Fleet is broken! King Henry VIII names you a hero of England. Your secret mission is complete.' } ] },
  { title: 'Map of the World', steps: [                             // 3 Ernst
    { name: 'Mercator\'s Request', goal: 'Discover 3 ports',
      check: () => discovered.size >= 3, progress: () => `${Math.min(discovered.size, 3)}/3`, reward: 500,
      text: 'Your old friend Mercator writes: "Plot the world for me, Ernst. Every coast, every port."' },
    { name: 'Charting the Coast', goal: 'Discover 8 ports',
      check: () => discovered.size >= 8, progress: () => `${Math.min(discovered.size, 8)}/8`, reward: 1000,
      text: 'Your charts grow detailed. Sailors everywhere will soon navigate by your maps.' },
    { name: 'Unknown Lands', goal: 'Make 3 discoveries',
      check: () => discoveriesFound.size >= 3, progress: () => `${Math.min(discoveriesFound.size, 3)}/3`, reward: 2000,
      text: 'Beyond the known coasts lie wonders no map has ever shown. You ink them in, one by one.' },
    { name: 'The Far Reaches', goal: 'Discover 15 ports',
      check: () => discovered.size >= 15, progress: () => `${Math.min(discovered.size, 15)}/15`, reward: 3000,
      text: 'From Lisbon to the farthest shore, your map spans the known world. Mercator will be astonished.' },
    { name: 'The Complete Map', goal: 'Discover 25 ports',
      check: () => discovered.size >= 25, progress: () => `${Math.min(discovered.size, 25)}/25`, reward: 10000,
      text: 'It is finished — a detailed map of the entire world! Your name joins Mercator\'s among the great geographers.' } ] },
  { title: 'The Conti Debt', steps: [                               // 4 Pietro
    { name: 'A Family\'s Burden', goal: 'Amass 10,000 gold',
      check: () => P.gold >= 10000, progress: () => `${Math.min(P.gold, 10000)}/10000g`, reward: 500,
      text: 'The Conti debt hangs over you, but every coin earned is a step toward freedom.' },
    { name: 'First Treasures', goal: 'Dig up 2 treasures',
      check: () => P.treasuresDug >= 2, progress: () => `${Math.min(P.treasuresDug, 2)}/2`, reward: 1000,
      text: 'Glittering treasure! The rumors were true — the world is full of riches for those who seek them.' },
    { name: 'Exotic Riches', goal: 'Amass 40,000 gold',
      check: () => P.gold >= 40000, progress: () => `${Math.min(P.gold, 40000)}/40000g`, reward: 2000,
      text: 'Your coffers swell. The moneylenders of Genoa grow nervous — the Conti name is rising again.' },
    { name: 'The Great Haul', goal: 'Dig up 4 treasures',
      check: () => P.treasuresDug >= 4, progress: () => `${Math.min(P.treasuresDug, 4)}/4`, reward: 3000,
      text: 'Another vault of treasure! Your exploits as a treasure hunter are legendary.' },
    { name: 'Debt Repaid', goal: 'Amass 100,000 gold',
      check: () => P.gold >= 100000, progress: () => `${Math.min(P.gold, 100000)}/100000g`, reward: 10000,
      text: 'The last coin is paid. The Conti family debt is erased — and you are richer than ever. The world is yours!' } ] },
  { title: 'The Merchant of Istanbul', steps: [                     // 5 Ali
    { name: 'A Merchant\'s Dream', goal: 'Amass 5,000 gold',
      check: () => P.gold >= 5000, progress: () => `${Math.min(P.gold, 5000)}/5000g`, reward: 500,
      text: 'From the bazaars of Istanbul to distant shores, your trading journey begins. Fortune favors the bold.' },
    { name: 'Establishing Routes', goal: 'Discover 5 ports',
      check: () => discovered.size >= 5, progress: () => `${Math.min(discovered.size, 5)}/5`, reward: 1000,
      text: 'New ports, new markets, new profits. Your trade network begins to span the seas.' },
    { name: 'Building Wealth', goal: 'Amass 25,000 gold',
      check: () => P.gold >= 25000, progress: () => `${Math.min(P.gold, 25000)}/25000g`, reward: 2000,
      text: 'Your ships return heavy with goods and gold. Merchants from Venice to Alexandria know your name.' },
    { name: 'Master of Trade', goal: 'Discover 12 ports',
      check: () => discovered.size >= 12, progress: () => `${Math.min(discovered.size, 12)}/12`, reward: 3000,
      text: 'Your trade routes circle the globe. No market is beyond your reach.' },
    { name: 'Trade Magnate', goal: 'Amass 100,000 gold',
      check: () => P.gold >= 100000, progress: () => `${Math.min(P.gold, 100000)}/100000g`, reward: 10000,
      text: 'You are a magnate of trade, wealthier than sultans! The boy who struggled in Istanbul now rules the markets of the world.' } ] },
  { title: 'The Fantasy Journey of Isabella', steps: [              // 6 Isabella
    { name: 'The Duke\'s Commission', goal: 'Reach fame 3',
      check: () => P.fame >= 3, progress: () => `${Math.min(P.fame, 3)}/3 fame`, reward: 1000,
      text: 'In Lisbon, Duke Leon entrusts you with a commission and a generous sum. Your quiet days translating ancient texts in Sintra are over — the sea calls, Isabella.' },
    { name: 'The Athens Library', goal: 'Discover Athens',
      check: () => discovered.has(17), progress: () => discovered.has(17) ? 'found' : 'not yet', reward: 1500,
      text: 'In the great library of Athens you decipher the way to awaken the red stone: gather spiritual power from the four most legendary sites on Earth — the Pyramids, Stonehenge, Bermuda, and Yingzhou.' },
    { name: 'The Four Sacred Sites', goal: 'Make 4 discoveries',
      check: () => discoveriesFound.size >= 4, progress: () => `${Math.min(discoveriesFound.size, 4)}/4`, reward: 2500,
      text: 'Spiritual power hums within the red stone. But the Spanish fleet shadows you — they too covet Yubel\'s magic. Stay sharp, Isabella.' },
    { name: 'The Spanish Intercept', goal: 'Sink 3 ships',
      check: () => P.shipsSunk >= 3, progress: () => `${Math.min(P.shipsSunk, 3)}/3`, reward: 3000,
      text: 'The Spanish fleet moves to seize you! At the brink, Yubel\'s magic flares — and in a flash of light the four of you are hurled into another world…' },
    { name: 'The Way Home', goal: 'Make 8 discoveries',
      check: () => discoveriesFound.size >= 8, progress: () => `${Math.min(discoveriesFound.size, 8)}/8`, reward: 4000,
      text: 'Stranded in a strange world, you and your companions search for the way back. Every discovery brings you closer to home.' },
    { name: 'Sending Yudora Home', goal: 'Reach fame 20',
      check: () => P.fame >= 20, progress: () => `${Math.min(P.fame, 20)}/20 fame`, reward: 10000,
      text: 'With the spiritual power gathered, you open the way home and see Yudora safely back to her own world. Your fantastical journey becomes legend, Isabella!' } ] },
];

// recolored DOS hero portraits (first 6 of assets_dos/portraits/portraits.png, in CHARACTER_NAMES order)
const DOS_PORTRAIT = {
  0: './assets/dos/hero_joao.png',      // João
  1: './assets/dos/hero_catalina.png',  // Catalina
  2: './assets/dos/hero_otto.png',      // Otto
  3: './assets/dos/hero_ernst.png',     // Ernst
  4: './assets/dos/hero_pietro.png',    // Pietro
  5: './assets/dos/hero_ali.png',       // Ali
  6: './assets/waifu/isabella.png',     // Isabella (waifulabs)
};

// main storyline progression: advance the current chapter when its condition is met
function checkStory() {
  const s = STORYLINES[P.character];
  if (!s || P.story.step >= s.steps.length) return;   // no storyline / already finished
  const step = s.steps[P.story.step];
  if (step.check()) {
    P.story.step++;
    P.gold += step.reward;
    const done = P.story.step >= s.steps.length;
    showDialog(CHARACTER_NAMES[P.character],
      step.text + (done ? '<br><b>— Main storyline complete! —</b>' : ''),
      DOS_PORTRAIT[P.character]);
    save();
    // auto-close the story beat after a few seconds so it doesn't block play
    clearTimeout(checkStory._t);
    checkStory._t = setTimeout(() => { if (PANELS.dialog.open) closeDialog(); }, 4500);
  }
}

const heroFrame = (map, dir, frame, charRow) => {
  const col = DIRECTION_COL[dir] + frame;  map.offset.set(col * 68 / HEROES_W, 1 - (charRow * 68 + 68) / HEROES_H);
};

function updatePersonSprite() {
  heroFrame(personMap, personDir, animFrame, P.character);
}

// short labels for the port quick bar
const BLD_SHORT = {
  market: 'Market', bar: 'Bar', dry_dock: 'Dock', harbor: 'Harbor', inn: 'Inn',
  palace: 'Palace', job_house: 'Jobs', msc: 'MSC', bank: 'Bank',
  item_shop: 'Shop', church: 'Church', fortune_house: 'Fortune',
};
const quickbar = document.getElementById('port-quickbar');
function renderQuickbar() {
  quickbar.innerHTML = '';
  for (const b of portBuildings) {
    const btn = document.createElement('button');
    btn.textContent = BLD_SHORT[b.name] ?? b.name;
    btn.title = b.name.replace(/_/g, ' ');
    btn.onclick = () => { if (!inBuilding && !PANELS.dialog.open) openBuilding(b); };
    quickbar.appendChild(btn);
  }
}

// port state
let scene = 'sea';              // 'sea' | 'port' | 'land'
let landExpedition = false;     // ship left anchored nearby while exploring on foot
let portReturnPos = null;       // land coords to return to when leaving a port on foot
let portId = null;              // 1-based port id (ports.json)
let portData = null;            // Uint8Array view of the 96x96 map
let portWalkMax = PORT_WALK_MAX;
let portBuildings = [];         // [{id, name, x, y}]
let portWorld = null;           // {mesh, uniforms}
let portChipTex = {};           // tilesetFile -> {phase: tex}
let buildingNear = null;        // building the player stands on
let inBuilding = null;          // building currently visited

const portTileAt = (c, r) => portData[r * PORT_SIZE + c] + 1;  // ids start at 1
const walkableAt = (x, z) => {
  const c = Math.floor(x), r = Math.floor(z);
  if (c < 0 || r < 0 || c >= PORT_SIZE || r >= PORT_SIZE) return false;
  return portTileAt(c, r) <= portWalkMax;
};

// ports without their own PORTMAP reuse another port's map
const PORT_MAP_OVERRIDE = { 131: 94, 132: 0 };   // Tamsui walks Zeiton's streets; Faro reuses Lisbon's map

async function enterPort(pid) {
  // arriving on foot (land expedition): remember where to walk back to
  if (scene === 'land') portReturnPos = { x: landPos.x, z: landPos.z };
  else if (scene === 'sea') portReturnPos = null;
  const meta = portMeta[pid] ?? portMeta[Math.min(pid, 101)];
  const mapIdx = PORT_MAP_OVERRIDE[pid] ?? Math.min(pid - 1, 100);
  const tsFile = String(meta.tileset * 2).padStart(3, '0');

  // load this port's tileset (4 phases) on first visit
  if (!portChipTex[tsFile]) {
    const set = {};
    await Promise.all(phaseNames.map(async n => {
      set[n] = await loadTex(`./assets/portchips/${tsFile}_${n}.png`);
    }));
    portChipTex[tsFile] = set;
  }
  const chips = portChipTex[tsFile];

  // (re)build the port map mesh
  if (portWorld) portScene.remove(portWorld.mesh);
  portData = new Uint8Array(portMaps.buffer, mapIdx * PORT_SIZE * PORT_SIZE, PORT_SIZE * PORT_SIZE);
  // PORTMAP bytes are 0-based; the shader expects 1-based tile ids (like the world map)
  const portDataShifted = portData.map(v => v + 1);
  portWorld = makeTilemapMesh(portDataShifted, PORT_SIZE, PORT_SIZE, chips.day, chips.day, 16, 15);
  portWorld.chips = chips;
  portScene.add(portWorld.mesh);

  portId = pid;
  P.lastPort = pid;   // remember the last port visited (for no-ship reload)
  portDevOf(pid);   // initialize development stats on arrival
  portWalkMax = mapIdx >= 94 ? PORT_WALK_MAX_ASIA : PORT_WALK_MAX;
  portBuildings = Object.entries(meta.buildings)
    .map(([id, [x, y]]) => ({ id: +id, name: buildingNames[id], x, y }));
  renderQuickbar();

  // spawn just south of the harbor (building id 4), else center
  const harbor = portBuildings.find(b => b.id === 4);
  let sx = 48, sz = 80;
  if (harbor) {
    sx = harbor.x + 0.5;
    for (let d = 1; d < 8; d++) {
      if (walkableAt(sx, harbor.y + d + 0.5)) { sz = harbor.y + d + 0.5; break; }
    }
  }
  personPos.set(sx, 0.4, sz);
  personDir = 'up';
  animFrame = 0;
  person.position.copy(personPos);
  updatePersonSprite();

  scene = 'port';
  camDist = 20;
  endBattle();                    // reaching port shakes off any pursuers
  spawnPortNpcs();
  const name = ports.find(p => p.id === pid)?.name ?? meta.name;
  showBanner(portReturnPos
    ? `${name}<small>your ship is anchored off the coast — press Esc to leave on foot</small>`
    : `${name}<small>press Esc at any time to set sail</small>`);
  playMusic(portMusicFor(pid));
  buildPortMinimap();
}

function setSail() {
  if (landExpedition) {
    showBanner('Your ship is anchored off the coast<small>leave the city on foot and press L near your ship to re-board</small>');
    return;
  }
  if (P.fleet.length === 0) {
    showBanner('You have no ship<small>travel by boarding a merchant ship at the harbor, or leave the city on foot</small>');
    return;
  }
  scene = 'sea';
  inBuilding = null;
  quickbar.style.display = 'none';
  closeDialog();
  hideBuildingPanel();
  camDist = 34;
  const name = ports.find(p => p.id === portId)?.name ?? '';
  showBanner(`Set sail from ${name}`);
  playSfx('./assets/sounds/wave.ogg');
  playMusic(seaMusicFor(portId));
}

// leave a port on foot during a land expedition (no sailing allowed)
function exitPortToLand() {
  scene = 'land';
  inBuilding = null;
  buildingNear = null;         // forget the port's buildings — we're outside now
  quickbar.style.display = 'none';
  closeDialog();
  hideBuildingPanel();
  camDist = 16;
  if (portReturnPos) landPos.set(portReturnPos.x, 0.4, portReturnPos.z);
  showLandPerson();
  showBanner('Back to the wilds<small>return to your ship and press L to re-board</small>');
}

// ---------------------------------------------------------------------------
// Panel manager: market/shipyard/mates/outfit are building sub-panels;
// menu/dev/dialog are global. one place to open/close/query them all.
// ---------------------------------------------------------------------------
const PANELS = {};
function definePanel(name, el, { building = false, render = null, onClose = null } = {}) {
  PANELS[name] = { el, building, render, onClose, open: false };
}
function openPanel(name) {
  const p = PANELS[name];
  p.open = true;
  if (p.building) buildingPanel.style.display = 'none';
  p.render?.();
  p.el.style.display = 'block';
}
function closePanel(name) {
  const p = PANELS[name];
  if (!p.open) return;
  p.open = false;
  p.el.style.display = 'none';
  p.onClose?.();
  if (p.building && inBuilding) buildingPanel.style.display = 'block';
}
const anyPanelOpen = () => Object.values(PANELS).some(p => p.open);
const SUB_PANELS = ['market', 'shipyard', 'mates', 'outfit', 'crew', 'supply'];
// close the first open panel from `names`; returns true if something was closed
const closeFirstOpen = names => {
  for (const n of names) {
    if (PANELS[n].open) { closePanel(n); return true; }
  }
  return false;
};
function closeBuildingSubPanels() {
  for (const n of SUB_PANELS) closePanel(n);
}
const closeBuildingSubPanelOpen = () => closeFirstOpen(SUB_PANELS);
// close the topmost closable panel; returns true if something was closed
const closeTopPanel = () => closeFirstOpen(['dialog', 'menu', 'dev', ...SUB_PANELS]);

// render a row of tab buttons; onPick(id) switches the tab and re-renders
function mkTabs(container, tabs, current, onPick) {
  container.innerHTML = '';
  for (const [id, label] of tabs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = id === current ? 'active' : '';
    b.onclick = () => onPick(id);
    container.appendChild(b);
  }
}

// ---------------------------------------------------------------------------
// Texas Hold'em (德州扑克) in the bar: heads-up vs the dealer
// ---------------------------------------------------------------------------
const pokerPanel = document.getElementById('poker-panel');
let pk = null;

// --- 7-card hand evaluation: returns [category, ...tiebreakers] ---
const PK_HANDS = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight',
                  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
function evalHand(cards) {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suits = cards.map(c => Math.floor((c - 1) / 13));
  const cnt = {};
  for (const r of ranks) cnt[r] = (cnt[r] ?? 0) + 1;
  const groups = Object.entries(cnt).map(([r, n]) => [+r, n])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const suitCnt = [0, 0, 0, 0];
  for (const s of suits) suitCnt[s]++;
  const flushSuit = suitCnt.findIndex(n => n >= 5);
  const straightOf = rs => {
    const u = [...new Set(rs)].sort((a, b) => b - a);
    for (let i = 0; i + 4 < u.length; i++) if (u[i] - u[i + 4] === 4) return u[i];
    if (u.includes(14) && [2, 3, 4, 5].every(r => u.includes(r))) return 5;   // wheel
    return 0;
  };
  const straight = straightOf(ranks);
  const kickers = n => groups.filter(g => g[1] === 1).map(g => g[0]).slice(0, n);
  if (flushSuit >= 0) {
    const sf = straightOf(cards.filter(c => Math.floor((c - 1) / 13) === flushSuit)
                              .map(cardRank));
    if (sf) return [8, sf];
  }
  if (groups[0][1] === 4) return [7, groups[0][0], ...kickers(1)];
  if (groups[0][1] === 3 && groups[1]?.[1] === 2) return [6, groups[0][0], groups[1][0]];
  if (flushSuit >= 0) return [5, ...ranks.slice(0, 5)];
  if (straight) return [4, straight];
  if (groups[0][1] === 3) return [3, groups[0][0], ...kickers(2)];
  if (groups[0][1] === 2 && groups[1]?.[1] === 2) return [2, groups[0][0], groups[1][0], ...kickers(1)];
  if (groups[0][1] === 2) return [1, groups[0][0], ...kickers(3)];
  return [0, ...ranks.slice(0, 5)];
}
const cmpHands = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

// --- dealer AI: rough strength estimate ---
function aiStrength() {
  const all = pk.board.concat(pk.dealer);
  if (pk.board.length >= 3) {
    const [cat, ...tb] = evalHand(all);
    let s = cat * 10 + (tb[0] ?? 0) / 14 * 3;
    // draw bonuses
    const suits = all.map(c => Math.floor((c - 1) / 13));
    if ([0, 1, 2, 3].some(x => suits.filter(y => y === x).length === 4)) s += 2;
    const rs = [...new Set(all.map(cardRank))];
    if (rs.length >= 4 && (rs[0] - rs[3] === 3)) s += 1.5;
    return s;
  }
  // preflop hole-card heuristic
  const [a, b] = pk.dealer.map(cardRank).sort((x, y) => y - x);
  const suited = Math.floor((pk.dealer[0] - 1) / 13) === Math.floor((pk.dealer[1] - 1) / 13);
  let s = a === b ? 8 + a / 2 : a / 3 + (suited ? 1.5 : 0) + (a - b === 1 ? 1 : 0);
  return s;
}
// AI answers a raise: 'call' or 'fold'
const aiAnswer = () => aiStrength() >= 8 + Math.random() * 6 ? 'call' : 'fold';

function openPoker() {
  pk = { deck: bjNewDeck(), dealer: [], player: [], board: [], pot: 0,
         toCall: 0, stage: 'preflop', msg: '', state: 'act', hidden: true };
  // blinds: player SB 10, dealer BB 20
  P.gold -= 10;
  pk.pot = 30;
  pk.toCall = 10;
  pk.player = [pk.deck.pop(), pk.deck.pop()];
  pk.dealer = [pk.deck.pop(), pk.deck.pop()];
  pk.msg = 'Blinds posted (you 10 / dealer 20). Your action.';
  save();
  renderPoker();
}
function closePoker() {
  if (!pk) return;
  pk = null;
  pokerPanel.style.display = 'none';
}

function pkNextStreet() {
  if (pk.stage === 'preflop') pk.board = [pk.deck.pop(), pk.deck.pop(), pk.deck.pop()];
  else pk.board.push(pk.deck.pop());
  pk.stage = { preflop: 'flop', flop: 'turn', turn: 'river' }[pk.stage];
  pk.toCall = 0;
  pk.msg = `${pk.stage.toUpperCase()} — check or raise.`;
  pk.state = 'act';
}

function pkAction(kind) {
  if (!pk || pk.state !== 'act') return;
  if (kind === 'fold') return pkSettle('fold');
  if (kind === 'raise') {
    if (P.gold < 50) return;
    P.gold -= 50;
    pk.pot += 50;
    if (aiAnswer() === 'fold') return pkSettle('aifold');
    pk.pot += 50;   // AI calls
    pk.msg = 'Dealer calls your raise.';
  } else {
    // check/call
    if (pk.toCall > 0) {
      P.gold -= pk.toCall;
      pk.pot += pk.toCall;
    }
    pk.msg = pk.toCall > 0 ? `You call ${pk.toCall}g.` : 'Check.';
  }
  save();
  if (pk.stage === 'river') return pkSettle('showdown');
  pkNextStreet();
  renderPoker();
}

function pkSettle(result) {
  pk.state = 'done';
  pk.hidden = false;
  if (result === 'fold') {
    pk.msg = `You folded. Dealer takes the ${pk.pot}g pot.`;
  } else if (result === 'aifold') {
    P.gold += pk.pot;
    pk.msg = `Dealer folds! You take the ${pk.pot}g pot.`;
  } else {
    const ph = evalHand(pk.player.concat(pk.board));
    const dh = evalHand(pk.dealer.concat(pk.board));
    const cmp = cmpHands(ph, dh);
    const line = `${PK_HANDS[ph[0]]} vs ${PK_HANDS[dh[0]]}`;
    if (cmp > 0) { P.gold += pk.pot; pk.msg = `${line} — you win the ${pk.pot}g pot!`; }
    else if (cmp < 0) pk.msg = `${line} — dealer wins the ${pk.pot}g pot.`;
    else { P.gold += Math.floor(pk.pot / 2); pk.msg = `${line} — split pot (${Math.floor(pk.pot / 2)}g each).`; }
  }
  save();
  renderPoker();
}

function renderPoker() {
  if (!pk) { pokerPanel.style.display = 'none'; return; }
  pokerPanel.style.display = 'block';
  document.getElementById('pk-dealer').innerHTML =
    pk.dealer.map(c => bjCardHtml(c, pk.hidden)).join('');
  document.getElementById('pk-board').innerHTML = pk.board.map(c => bjCardHtml(c)).join('') || '—';
  document.getElementById('pk-player').innerHTML = pk.player.map(c => bjCardHtml(c)).join('');
  document.getElementById('pk-pot').textContent = pk.pot;
  document.getElementById('pk-tocall').textContent = pk.toCall > 0 ? `to call: ${pk.toCall}g` : '';
  document.getElementById('pk-msg').textContent = pk.msg;
  const acts = document.getElementById('pk-actions');
  acts.innerHTML = '';
  const mk = (label, fn, disabled = false) => mkBtn(acts, label, fn, disabled);
  if (pk.state === 'act') {
    mk('Fold', () => pkAction('fold'));
    mk(pk.toCall > 0 ? `Call ${pk.toCall}g` : 'Check', () => pkAction('call'), P.gold < pk.toCall);
    mk('Raise 50g', () => pkAction('raise'), P.gold < 50);
  } else {
    mk('Next hand', () => openPoker(), P.gold < 10);
    mk('Leave table', () => closePoker());
  }
}

// ---------------------------------------------------------------------------
// Blackjack (21点) in the bar
// ---------------------------------------------------------------------------
const bjPanel = document.getElementById('blackjack-panel');
let bj = null;   // {deck, dealer, player, bet, state, hideHole}

const BJ_SUITS = ['♠', '♥', '♦', '♣'];
// card id = suit*13 + rank(1..13); poker rank: 2-14 with ace high
const cardRank = c => { const r = (c - 1) % 13 + 1; return r === 1 ? 14 : r; };
const bjValue = c => Math.min((c - 1) % 13 + 1, 10);
function bjTotal(hand) {
  let total = 0, aces = 0;
  for (const c of hand) { total += bjValue(c); if ((c - 1) % 13 === 0) aces++; }
  while (aces && total + 10 <= 21) { total += 10; aces--; }
  return total;
}
const bjCardHtml = (c, hide = false) => {
  if (hide) return '<span class="bj-card back">?</span>';
  const r = (c - 1) % 13, s = Math.floor((c - 1) / 13);
  return `<span class="bj-card${s === 1 || s === 2 ? ' red' : ''}">${['A','2','3','4','5','6','7','8','9','10','J','Q','K'][r]}${BJ_SUITS[s]}</span>`;
};

function bjNewDeck() {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push(s * 13 + r);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function renderBj() {
  if (!bj) { bjPanel.style.display = 'none'; return; }
  bjPanel.style.display = 'block';
  document.getElementById('bj-dealer').innerHTML =
    bj.dealer.map((c, i) => bjCardHtml(c, bj.hideHole && i === 1)).join('');
  document.getElementById('bj-dealer-total').textContent =
    bj.hideHole ? `${bjValue(bj.dealer[0])} + ?` : bjTotal(bj.dealer);
  document.getElementById('bj-player').innerHTML = bj.player.map(c => bjCardHtml(c)).join('');
  document.getElementById('bj-player-total').textContent = bjTotal(bj.player);
  document.getElementById('bj-msg').textContent = bj.msg;
  const acts = document.getElementById('bj-actions');
  acts.innerHTML = '';
  const mk = (label, fn, disabled = false) => mkBtn(acts, label, fn, disabled);
  if (bj.state === 'bet') {
    for (const amt of [50, 100, 500]) {
      mk(`Bet ${amt}g`, () => bjDeal(amt), P.gold < amt);
    }
    mk('Leave table', () => closeBlackjack());
  } else if (bj.state === 'player') {
    mk('Hit', () => bjHit());
    mk('Stand', () => bjStand());
  } else {
    mk('Next hand', () => { bj.state = 'bet'; bj.msg = `gold: ${P.gold}g — place your bet`; renderBj(); });
    mk('Leave table', () => closeBlackjack());
  }
}

function openBlackjack() {
  bj = { deck: bjNewDeck(), dealer: [], player: [], bet: 0, state: 'bet', hideHole: false,
         msg: `gold: ${P.gold}g — place your bet` };
  renderBj();
}
function closeBlackjack() {
  if (!bj) return;
  bj = null;
  renderBj();
}

function bjDeal(amt) {
  P.gold -= amt;
  bj.bet = amt;
  bj.player = [bj.deck.pop(), bj.deck.pop()];
  bj.dealer = [bj.deck.pop(), bj.deck.pop()];
  bj.hideHole = true;
  bj.msg = '';
  bj.state = 'player';
  // instant blackjack check
  if (bjTotal(bj.player) === 21) return bjSettle('blackjack');
  save();
  renderBj();
}

function bjHit() {
  bj.player.push(bj.deck.pop());
  if (bjTotal(bj.player) > 21) return bjSettle('bust');
  renderBj();
}

function bjStand() {
  bj.hideHole = false;
  while (bjTotal(bj.dealer) < 17) bj.dealer.push(bj.deck.pop());
  const pt = bjTotal(bj.player), dt = bjTotal(bj.dealer);
  if (dt > 21) return bjSettle('dealerbust');
  if (pt > dt) return bjSettle('win');
  if (pt < dt) return bjSettle('lose');
  return bjSettle('push');
}

function bjSettle(result) {
  bj.hideHole = false;
  bj.state = 'done';
  const b = bj.bet;
  if (result === 'blackjack') { P.gold += Math.floor(b * 2.5); bj.msg = `BLACKJACK! +${Math.floor(b * 2.5)}g`; }
  else if (result === 'dealerbust') { P.gold += b * 2; bj.msg = `Dealer busts — you win! +${b * 2}g`; }
  else if (result === 'win') { P.gold += b * 2; bj.msg = `You win! +${b * 2}g`; }
  else if (result === 'push') { P.gold += b; bj.msg = `Push — bet returned (${b}g).`; }
  else if (result === 'bust') { bj.msg = 'Bust! You lose.'; }
  else { bj.msg = 'Dealer wins.'; }
  if (result === 'blackjack' || result === 'dealerbust' || result === 'win') P.fame += 0;
  save();
  renderBj();
}

// ---------------------------------------------------------------------------
// Bar maids (uw2ol hash_maids): waitress in the bar with real tips
// ---------------------------------------------------------------------------
function talkToMaid(maidId) {
  const maid = maidsData[maidId];
  const img = figureUrl(...maid.image);
  const actions = [
    { label: 'Ask for info', action() {
      // best-paying region for a random sellable good of this port's region
      const region = portMeta[Math.min(portId, 101)].region;
      const table = region && goodsData.regions[region];
      if (table) {
        const names = Object.keys(table.available);
        const g = names[Math.floor(Math.random() * names.length)];
        let best = null, bestPrice = 0;
        for (const [r, t] of Object.entries(goodsData.regions)) {
          if (r === region) continue;
          const price = t.prices[g]?.[1] ?? 0;
          if (price > bestPrice) { bestPrice = price; best = r; }
        }
        setBuildingText(`<img src="${img}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
          `<b>${maid.name}</b>: "They say <b>${g}</b> fetches a fine price in <b>${best}</b>… just between us."`);
      } else {
        setBuildingText(`<img src="${img}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
          `<b>${maid.name}</b>: "Uhh… that's too personal."`);
      }
    } },
    { label: 'Tell her a story', action() {
      gainFame('adventureFame', Math.random() < 0.3 ? 1 : 0);
      setBuildingText(`<img src="${img}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
        `<b>${maid.name}</b>: "Wow! Interesting… tell me another one sometime, captain."`);
    } },
    { label: 'Buy her a drink', cost: 100, action() {
      P.gold -= 100;
      const unknown = villages.filter(v => !discoveriesFound.has(v.id));
      if (unknown.length) {
        const v = unknown[Math.floor(Math.random() * unknown.length)];
        setBuildingText(`<img src="${img}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
          `<b>${maid.name}</b>: "How sweet. You know, a sailor told me there's something strange at ` +
          `<b>${fmtLonLat(v.x, v.y)}</b>…"`);
      } else {
        setBuildingText(`<img src="${img}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
          `<b>${maid.name}</b>: "How sweet of you, captain."`);
      }
    } },
  ];
  setBuildingText(`<img src="${img}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
    `<b>${maid.name}</b>: "I'm ${maid.name}. How are you?"`);
  renderActions(actions.concat(buildingMenu(inBuilding).filter(x => !x.label.startsWith('Talk to the waitress'))));
  return true;   // keep the submenu (the wrapper must not re-render)
}

// ---------------------------------------------------------------------------
// Talk to NPCs (E): uw2ol's dialog lines + useful tips
// ---------------------------------------------------------------------------
const dialogPanel = document.getElementById('dialog-panel');

function showDialog(name, text, portraitUrl) {
  document.getElementById('dialog-name').textContent = name;
  document.getElementById('dialog-text').innerHTML = text;
  const img = document.getElementById('dialog-portrait');
  if (portraitUrl) { img.src = portraitUrl; img.style.display = 'block'; }
  else { img.style.display = 'none'; }
  openPanel('dialog');
}
definePanel('dialog', dialogPanel);
const closeDialog = () => closePanel('dialog');

function npcDialog(npc) {
  const kind = npc.kind;
  // wanderers (man/woman) have a Jephed charIdx -> show their portrait
  const portrait = (npc.charIdx !== undefined) ? npcPortraitUrl(npc.charIdx) : null;
  if (kind === 'man') {
    const p = ports[Math.floor(Math.random() * ports.length)];
    showDialog('Sailor', `"Have you been to <b>${p.name}</b>?"`, portrait);
  } else if (kind === 'woman') {
    showDialog('Townswoman', '"Do you like this place? ... How about me?"', portrait);
  } else if (kind === 'dog') {
    showDialog('Dog', 'Woof! Woof!', portrait);
  } else if (kind === 'oldman') {
    const unknown = villages.filter(v => !discoveriesFound.has(v.id));
    if (unknown.length && Math.random() < 0.6) {
      const v = unknown[Math.floor(Math.random() * unknown.length)];
      showDialog('Old man', `"Cherish your time, kid. I was like you many years ago…<br>` +
        `Say — they say there's something strange at <b>${fmtLonLat(v.x, v.y)}</b>."`, portrait);
    } else {
      showDialog('Old man', '"Cherish your time, kid. I was like you many years ago."', portrait);
    }
  } else if (kind === 'agent') {
    const spec = goodsData.specialties[portId];
    if (spec) {
      // find the region paying the most for the local specialty (excluding home)
      const home = portMeta[Math.min(portId, 101)].region;
      let best = null, bestPrice = 0;
      for (const [region, table] of Object.entries(goodsData.regions)) {
        if (region === home) continue;
        const price = table.prices[spec.name]?.[1] ?? 0;
        if (price > bestPrice) { bestPrice = price; best = region; }
      }
      showDialog('Agent', `"Here! We have everything you can imagine!<br>` +
        `Our specialty is <b>${spec.name}</b> (buy: ${spec.price}g). ` +
        (best ? `They pay much more for it in <b>${best}</b>."` : '"'), portrait);
    } else {
      showDialog('Agent', '"Here! We have everything you can imagine!"', portrait);
    }
  } else if (kind === 'guard') {
    showDialog('Guard', P.fame >= 5
      ? `"Good day, ${fameTitle()}. The governor speaks well of you."`
      : '"Halt! State your business. …Move along, sailor."', portrait);
  }
}

function nearestNpc() {
  if (currentPhase === 'night') return null;   // npcs are home at night
  let best = null, bestD = 1.8;
  for (const n of npcs) {
    const d = Math.hypot(n.pos.x - personPos.x, n.pos.z - personPos.z);
    if (d < bestD) { best = n; bestD = d; }
  }
  for (const s of staticNpcs) {
    const d = Math.hypot(s.mesh.position.x - personPos.x, s.mesh.position.z - personPos.z);
    if (d < bestD) { best = s; bestD = d; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Port NPCs (uw2ol port_npc.py): wanderers + static npcs at building doors
// ---------------------------------------------------------------------------
let npcs = [];         // wandering men/women
let staticNpcs = [];   // dog / old man / agent / guard at entrances

function makeNpcMesh(frameIdx) {
  const mesh = makeSprite(personTex, 1 / 32, 1);
  mesh.material.map.offset.set(frameIdx / 32, 0);
  return mesh;
}

// Jephed's top-down pixel art characters (40 chars in npc_atlas.png, 8x5 sheets)
// per character: 3 cols x 4 rows of 20x32 cells; rows: down/right/up/left
const ATLAS_W = 512, ATLAS_H = 640;
const PACK_DIR_ROW = { down: 0, left: 1, right: 2, up: 3 };

function makePackNpcMesh(charIdx) {
  const map = npcAtlasTex.clone();
  map.needsUpdate = true;
  map.repeat.set(20 / ATLAS_W, 32 / ATLAS_H);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 2),
    new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2;
  setPackNpcFrame(mesh, charIdx, 'down', 0);
  return mesh;
}

function setPackNpcFrame(mesh, charIdx, dir, frameCol) {
  const cx = (charIdx % 8) * 64 + frameCol * 20;
  const cy = Math.floor(charIdx / 8) * 128 + PACK_DIR_ROW[dir] * 32;
  mesh.material.map.offset.set(cx / ATLAS_W, 1 - (cy + 32) / ATLAS_H);
}

const NPC_FRAMES = {
  man:   { up: 16, right: 18, down: 20, left: 22 },
  woman: { up: 8,  right: 10, down: 12, left: 14 },
};
const STATIC_NPCS = [
  { building: 2, frames: [28, 29], kind: 'dog', label: 'dog' },        // dog at the bar
  { building: 5, frames: [26, 27], kind: 'oldman', label: 'old man' }, // old man at the inn
  { building: 1, frames: [24, 25], kind: 'agent', label: 'agent' },    // agent at the market
  { building: 6, frames: [30, 31], kind: 'guard', label: 'guard' },    // guard at the palace
];

function spawnPortNpcs() {
  for (const n of [...npcs, ...staticNpcs]) portScene.remove(n.mesh);
  npcs = [];
  staticNpcs = [];

  // wanderers near the harbor — Jephed pack characters
  const harbor = portBuildings.find(b => b.id === 4);
  const cx = harbor ? harbor.x : 48, cz = harbor ? harbor.y + 2 : 60;
  const usedChars = new Set();
  for (let i = 0; i < 6; i++) {
    let charIdx;
    do { charIdx = Math.floor(Math.random() * 40); } while (usedChars.has(charIdx));
    usedChars.add(charIdx);
    let sx = cx + 0.5, sz = cz + 0.5;
    for (let t = 0; t < 20; t++) {
      const x = cx + Math.floor(Math.random() * 17 - 8) + 0.5;
      const z = cz + Math.floor(Math.random() * 17 - 8) + 0.5;
      if (walkableAt(x, z)) { sx = x; sz = z; break; }
    }
    const kind = i % 2 === 0 ? 'man' : 'woman';
    const mesh = makePackNpcMesh(charIdx);
    mesh.position.set(sx, 0.4, sz);
    portScene.add(mesh);
    npcs.push({ kind, charIdx, mesh, pos: new THREE.Vector3(sx, 0.4, sz), dir: 'down',
                frame: 0, animT: Math.random() * 0.3, moveT: 0, mvx: 0, mvz: 0 });
  }

  // static npcs in front of their buildings
  for (const s of STATIC_NPCS) {
    const b = portBuildings.find(x => x.id === s.building);
    if (!b) continue;
    const mesh = makeNpcMesh(s.frames[0]);
    mesh.position.set(b.x + 2.5, 0.4, b.y + 1.5);   // beside the door, never blocking it
    portScene.add(mesh);
    staticNpcs.push({ mesh, frames: s.frames, kind: s.kind, label: s.label,
                      animT: Math.random() * 0.6, cur: 0 });
  }
}

function updateNpcs(dt, phase) {
  const visible = phase !== 'night';   // uw2ol: no npcs out at night
  for (const n of npcs) {
    n.mesh.visible = visible;
    if (!visible || PANELS.dialog.open) continue;   // wanderers pause while you chat
    n.animT += dt;
    n.moveT -= dt;
    if (n.moveT <= 0) {
      n.moveT = 1 + Math.random() * 2;
      if (Math.random() < 0.3) { n.mvx = 0; n.mvz = 0; }
      else {
        const ang = Math.floor(Math.random() * 4) * Math.PI / 2;
        n.mvx = Math.cos(ang);
        n.mvz = Math.sin(ang);
      }
    }
    if (n.mvx || n.mvz) {
      const sp = 2 * dt;
      const nx = n.pos.x + n.mvx * sp, nz = n.pos.z + n.mvz * sp;
      if (walkableAt(nx, nz)) { n.pos.x = nx; n.pos.z = nz; }
      else { n.mvx = -n.mvx; n.mvz = -n.mvz; }
      n.dir = n.mvz < 0 ? 'up' : n.mvz > 0 ? 'down' : n.mvx < 0 ? 'left' : 'right';
      if (n.animT > 0.35) { n.animT = 0; n.frame ^= 1; }
    }
    n.mesh.position.copy(n.pos);
    // pack: idle = col 0, walking = cols 1/2 alternating
    const col = (n.mvx || n.mvz) ? 1 + n.frame : 0;
    setPackNpcFrame(n.mesh, n.charIdx, n.dir, col);
  }
  for (const s of staticNpcs) {
    s.mesh.visible = visible;
    if (!visible) continue;
    s.animT += dt;
    if (s.animT > 0.6) {
      s.animT = 0;
      s.cur ^= 1;
      s.mesh.material.map.offset.set(s.frames[s.cur] / 32, 0);
    }
  }
}

// ---------------------------------------------------------------------------
// Land exploration (L): walk ashore, Dragon-Quest style expeditions
// ---------------------------------------------------------------------------
const landPerson = makeSprite(heroesTex, 68 / HEROES_W, 68 / HEROES_H, 2.4);
const landPersonMap = landPerson.material.map;
landPerson.visible = false;
seaScene.add(landPerson);

const landPos = new THREE.Vector3(0, 0.4, 0);
let landDir = 'down';

function updateLandPersonSprite() {
  heroFrame(landPersonMap, landDir, animFrame, P.character);
}

const LAND_MONSTERS = [
  { name: 'Prairie Dog', img: [3, 5], hp: 8,  atk: 3,  def: 0, exp: 4,  gold: 5 },
  { name: 'Tree Snake',  img: [1, 4], hp: 12, atk: 5,  def: 0, exp: 7,  gold: 8 },
  { name: 'Python',      img: [16, 3], hp: 18, atk: 7, def: 1, exp: 12, gold: 12 },
  { name: 'Bison',       img: [4, 1], hp: 26, atk: 8, def: 2, exp: 16, gold: 10 },
  { name: 'Panda',       img: [5, 1], hp: 30, atk: 10, def: 3, exp: 22, gold: 20 },
  { name: 'Crocodile',   img: [9, 5], hp: 38, atk: 12, def: 3, exp: 30, gold: 25 },
  { name: 'Saber-toothed Tiger', img: [2, 2], hp: 50, atk: 15, def: 4, exp: 45, gold: 40 },
  { name: 'Blue Whale',  img: [9, 1], hp: 80, atk: 18, def: 6, exp: 80, gold: 100 },
];
let landBattle = null;    // {enemy, log[], round}
let encounterT = 2;       // seconds of walking before next possible encounter

const heroMaxHp = () => 20 + 8 * P.hero.lv + HERO_ATTRS[P.character].con * 2;
const heroMaxSp = () => 10 + 2 * P.hero.lv + HERO_ATTRS[P.character].int + HERO_ATTRS[P.character].per;
// apply pending hero level-ups from stored exp; log each one to `logArr`
function heroLevelUps(logArr) {
  while (P.hero.exp >= P.hero.lv * 20) {
    P.hero.exp -= P.hero.lv * 20;
    P.hero.lv++;
    P.hero.hp = heroMaxHp();
    logArr.push(`Level up! ${CHARACTER_NAMES[P.character]} is now lv ${P.hero.lv}!`);
  }
}
const heroAtk = () => Math.max(1, Math.round((4 + 2 * P.hero.lv + [0, 4, 8, 14][P.hero.weapon] + Math.floor(HERO_ATTRS[P.character].str / 5)) * (P.fatigue >= 90 ? 0.75 : 1)));
const heroDef = () => Math.floor(P.hero.lv / 2) + [0, 2, 5, 9][P.hero.armor];
const mateMaxHp = id => 15 + 5 * (matesData[id]?.lv ?? 1) + Math.floor(mateAttrs(id).con / 3);
const mateMaxSp = id => 10 + 2 * (matesData[id]?.lv ?? 1) + Math.floor(mateAttrs(id).int / 2);
const mateAtk = id => 3 + (matesData[id]?.lv ?? 1) + Math.floor((matesData[id]?.swordplay ?? 0) / 20) + Math.floor(mateAttrs(id).str / 5);
const mateDef = id => Math.floor((matesData[id]?.lv ?? 1) / 3);
// derive a mate's CRPG base attributes {str,agi,con,int,per,cha} (3-18) from their stats
const mateAttrs = id => {
  const m = matesData[id] ?? {};
  const s = v => 3 + Math.round((v ?? 0) / 100 * 15);   // 0-100 -> 3-18
  return {
    str: s(((m.courage ?? 0) + (m.swordplay ?? 0)) / 2),
    agi: s(m.seamanship),
    con: s((m.lv ?? 1) * 10),
    int: s(m.knowledge),
    per: s(m.intuition),
    cha: s(m.leadership),
  };
};
// increment the protagonist's fame of a type AND share +1 with each mate
function gainFame(type, n) {
  P[type] += n;
  const key = type.replace('Fame', '');   // navalFame -> naval
  for (const id of P.mates) {
    P.mateFame[id] = P.mateFame[id] ?? { naval: 0, trade: 0, adventure: 0, notoriety: 0 };
    P.mateFame[id][key] = (P.mateFame[id][key] ?? 0) + 1;
  }
}
const mateHpOf = id => P.mateHp[id] ?? mateMaxHp(id);

function landAt(x, z) {   // walkable for a person: land tiles (not sailable water)
  // tileAt wraps toroidally, so no bounds check — the world is seamless
  return !SAILABLE.has(tileAt(Math.floor(x), Math.floor(z)));
}

// place the on-foot sprite at landPos, facing down
function showLandPerson() {
  landDir = 'down';
  landPerson.visible = true;
  landPerson.position.copy(landPos);
  updateLandPersonSprite();
}

function landOn() {
  // find an adjacent land tile to step onto
  for (const [ox, oz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = Math.floor(shipPos.x) + ox + 0.5, z = Math.floor(shipPos.z) + oz + 0.5;
    if (landAt(x, z)) {
      landPos.set(x, 0.4, z);
      scene = 'land';
      landExpedition = true;
      camDist = 16;
      showLandPerson();
      endBattle();   // pirates can't follow you ashore
      showBanner('Gone ashore<small>explore on foot — beware of wild beasts! Return to your ship and press L to re-board</small>');
      return true;
    }
  }
  showBanner('No place to land here');
  return false;
}

function reboard() {
  if (distT(landPos.x, landPos.z, shipPos.x, shipPos.z) > 2.5) {
    showBanner('Your ship is too far — walk back to it');
    return;
  }
  scene = 'sea';
  landExpedition = false;
  portReturnPos = null;
  camDist = 34;
  landPerson.visible = false;
  showBanner('Back aboard');
}

// ---------------------------------------------------------------------------
// Dragon-Quest style turn-based land battles
// ---------------------------------------------------------------------------
function startLandBattle() {
  // enemy tier scales with hero level
  const tier = Math.max(0, Math.min(LAND_MONSTERS.length - 1,
                 P.hero.lv - 1 + Math.floor(Math.random() * 3) - 1));
  const base = LAND_MONSTERS[tier];
  const lvScale = 1 + (P.hero.lv - 1) * 0.25;
  const enemy = {
    name: base.name, img: base.img,
    hp: Math.round(base.hp * lvScale), maxHp: Math.round(base.hp * lvScale),
    atk: Math.round(base.atk * lvScale), def: base.def,
    exp: Math.round(base.exp * lvScale), gold: Math.round(base.gold * lvScale),
  };
  landBattle = { enemy, log: [`A wild ${enemy.name} appears!`] };
  playMusic('./assets/music/battle.ogg');
  renderLandBattle();
}

function partyMembers() {
  const members = [{ kind: 'hero', name: CHARACTER_NAMES[P.character],
                     hp: P.hero.hp, maxHp: heroMaxHp(), atk: heroAtk(), def: heroDef() }];
  for (const id of P.mates.slice(0, 3)) {
    members.push({ kind: 'mate', id, name: matesData[id].name,
                   hp: mateHpOf(id), maxHp: mateMaxHp(id), atk: mateAtk(id), def: mateDef(id) });
  }
  return members;
}

function landBattleTurn(action) {
  const bt = landBattle;
  if (!bt || bt.over) return;
  const e = bt.enemy;
  const members = partyMembers().filter(m => m.hp > 0);
  if (!members.length) return;

  if (action === 'run') {
    if (Math.random() < 0.65) {
      bt.log.push('Got away safely!');
      endLandBattle(false);
      return;
    }
    bt.log.push("Can't escape!");
  } else if (action === 'balm') {
    if (P.hero.balms <= 0) { bt.log.push('No balms left!'); renderLandBattle(); return; }
    P.hero.balms--;
    const target = members.reduce((a, b) => (a.hp / a.maxHp < b.hp / b.maxHp ? a : b));
    const heal = 30;
    applyMemberHeal(target, heal);
    bt.log.push(`Used a balm — ${target.name} recovers ${heal} HP.`);
  } else {
    // everyone attacks
    for (const m of members) {
      const dmg = Math.max(1, Math.round(m.atk * (0.85 + Math.random() * 0.3) - e.def / 2));
      e.hp -= dmg;
      bt.log.push(`${m.name} hits ${e.name} for ${dmg}!`);
      if (e.hp <= 0) break;
    }
  }

  if (e.hp <= 0) {
    bt.log.push(`${e.name} defeated! Gained ${e.exp} exp and ${e.gold}g.`);
    endLandBattle(true);
    return;
  }

  // enemy strikes back at a random alive member
  const alive = partyMembers().filter(m => m.hp > 0);
  const t = alive[Math.floor(Math.random() * alive.length)];
  const edmg = Math.max(1, Math.round(e.atk * (0.85 + Math.random() * 0.3) - t.def / 2));
  applyMemberDamage(t, edmg);
  bt.log.push(`${e.name} hits ${t.name} for ${edmg}!`);

  if (partyMembers().every(m => m.hp <= 0)) {
    bt.log.push('The party was wiped out…');
    endLandBattle(null);   // defeat
    return;
  }
  renderLandBattle();
}

function applyMemberDamage(m, dmg) {
  if (m.kind === 'hero') P.hero.hp = Math.max(0, P.hero.hp - dmg);
  else P.mateHp[m.id] = Math.max(0, mateHpOf(m.id) - dmg);
}
function applyMemberHeal(m, hp) {
  if (m.kind === 'hero') P.hero.hp = Math.min(heroMaxHp(), P.hero.hp + hp);
  else P.mateHp[m.id] = Math.min(mateMaxHp(m.id), mateHpOf(m.id) + hp);
}

function endLandBattle(won) {
  const bt = landBattle;
  if (won) {
    P.gold += bt.enemy.gold;
    P.hero.exp += bt.enemy.exp;
    const cb = bt.onEnd;
    // level ups
    heroLevelUps(bt.log);
    gainFame('navalFame', 1);
    bt.over = true;
    save();
    setTimeout(() => { closeLandBattle(); cb?.(true); }, 1600);
  } else if (won === null) {
    // defeated: wake up back at the ship
    bt.over = true;
    P.gold = Math.floor(P.gold * 0.9);
    P.hero.hp = 1;
    for (const id of P.mates) P.mateHp[id] = 1;
    save();
    setTimeout(() => {
      closeLandBattle();
      landPos.set(shipPos.x, 0.4, shipPos.z);
      reboard();
      showBanner('You barely made it back to the ship…<small>lost 10% of your gold</small>');
    }, 2000);
  } else {
    const cb = bt.onEnd;
    closeLandBattle();   // ran away
    cb?.(false);
  }
  renderLandBattle();
}

const landBattlePanel = document.getElementById('land-battle');
function renderLandBattle() {
  if (!landBattle) { landBattlePanel.style.display = 'none'; return; }
  const e = landBattle.enemy;
  landBattlePanel.style.display = 'block';
  document.getElementById('lb-enemy-name').textContent = `${e.name}`;
  document.getElementById('lb-enemy-hp').style.width = `${Math.max(0, e.hp) / e.maxHp * 100}%`;
  const cv = document.getElementById('lb-enemy-img');
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(discoveryImg, (e.img[0] - 1) * 49, (e.img[1] - 1) * 49, 49, 49, 0, 0, cv.width, cv.height);
  // party
  const pd = document.getElementById('lb-party');
  pd.innerHTML = '';
  for (const m of partyMembers()) {
    const row = document.createElement('div');
    row.className = 'lb-member';
    row.innerHTML = `<span>${m.name}</span>` +
      `<span class="bar"><i style="width:${Math.max(0, m.hp) / m.maxHp * 100}%"></i></span>` +
      `<span>${Math.max(0, m.hp)}/${m.maxHp}</span>`;
    pd.appendChild(row);
  }
  document.getElementById('lb-log').innerHTML = landBattle.log.slice(-8).map(l => `<div>${l}</div>`).join('');
  document.getElementById('lb-log').scrollTop = 1e6;
  document.getElementById('lb-balm-count').textContent = P.hero.balms;
}

function closeLandBattle() {
  landBattle = null;
  renderLandBattle();
  playMusic(seaMusicFor(portId ?? 1));
  encounterT = 4;   // brief peace after a fight
}

// ---------------------------------------------------------------------------
// Land towns & ruins: walk in, rest up, explore for treasure
// ---------------------------------------------------------------------------
const townPanel = document.getElementById('town-panel');
const ruinPanel = document.getElementById('ruin-panel');
let townOpen = false, ruin = null;

function nearestTown() {
  return scene === 'land' ? nearestOf(towns, landPos.x, landPos.z, 4) : null;
}

function nearestSeaTown() {
  return nearestOf(towns, shipPos.x, shipPos.z, 4);
}

function nearestSeaRuin() {
  return nearestOf(ruins, shipPos.x, shipPos.z, 4);
}

function nearestRuin() {
  return scene === 'land' ? nearestOf(ruins, landPos.x, landPos.z, 4) : null;
}

function openTown(t) {
  townOpen = true;
  document.getElementById('town-name').textContent = t.name;
  document.getElementById('town-text').textContent =
    `A quiet inland town. Merchants and travelers rest here.`;
  const acts = document.getElementById('town-actions');
  acts.innerHTML = '';
  const mk = (label, fn, disabled = false) => mkBtn(acts, label, fn, disabled);
  mk('Rest at the inn (10g)', () => {
    if (P.gold < 10) return;
    P.gold -= 10;
    P.fatigue = 0;
    P.hero.hp = heroMaxHp();
    for (const id of P.mates) P.mateHp[id] = mateMaxHp(id);
    onNewDay();
    document.getElementById('town-text').textContent = 'You spend a restful night. The party is fully refreshed.';
    save();
  }, P.gold < 10);
  mk('Buy water +25 (25g)', () => {
    if (P.gold < 25 || cargoSpace() < 1) return;
    const n = Math.min(25, cargoSpace());
    P.gold -= n; P.water += n;
    document.getElementById('town-text').textContent = 'Fresh water loaded onto the ship via the local caravans.';
    save();
  }, P.gold < 25 || cargoSpace() < 1);
  mk('Buy food +25 (25g)', () => {
    if (P.gold < 25 || cargoSpace() < 1) return;
    const n = Math.min(25, cargoSpace());
    P.gold -= n; P.food += n;
    document.getElementById('town-text').textContent = 'Rations stowed aboard the ship via the local caravans.';
    save();
  }, P.gold < 25 || cargoSpace() < 1);
  // a ship can only be boarded here if it is actually here (UW3-style);
  // otherwise buy a new one to set sail from this town
  const shipDist = Math.hypot(t.x - shipPos.x, t.z - shipPos.z);
  const coastal = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]
    .some(([dx, dz]) => sailableAt(t.x + dx, t.z + dz));
  if (coastal && shipDist > 6 && !landExpedition) {
    mk('Buy a ship & set sail (1000g)', () => {
      if (P.gold < 1000) return;
      P.gold -= 1000;
      const [x, z] = sailableNear(t.x, t.z);
      shipPos.set(x, 0.4, z);
      closeTown();
      landPerson.visible = false;
      scene = 'sea';
      camDist = 34;
      showBanner(`${t.name}<small>your new ship is ready — set sail!</small>`);
      save();
    }, P.gold < 1000);
  }
  mk('Hear rumors', () => {
    const unknown = villages.filter(v => !discoveriesFound.has(v.id));
    if (unknown.length) {
      const v = unknown[Math.floor(Math.random() * unknown.length)];
      document.getElementById('town-text').textContent =
        `"They say there's something strange at ${fmtLonLat(v.x, v.y)}…"`;
    } else {
      document.getElementById('town-text').textContent = '"You\'ve seen it all, captain!"';
    }
  });
  mk('Leave', () => closeTown());
  townPanel.style.display = 'block';
}
function closeTown() {
  if (!townOpen) return;
  townOpen = false;
  townPanel.style.display = 'none';
}

// --- ruin exploration: staged events ending in treasure ---
const RUIN_STAGES = 4;
function startRuin(r) {
  ruin = { data: r, stage: 0, log: [r.desc], loot: 0 };
  renderRuin();
}
function renderRuin() {
  if (!ruin) { ruinPanel.style.display = 'none'; return; }
  ruinPanel.style.display = 'block';
  document.getElementById('ruin-name').textContent = ruin.data.name;
  document.getElementById('ruin-stage').textContent =
    ruin.stage < RUIN_STAGES ? `stage ${ruin.stage + 1} / ${RUIN_STAGES + 1}` : 'the inner sanctum';
  document.getElementById('ruin-log').innerHTML = ruin.log.map(l => `<div>${l}</div>`).join('');
  document.getElementById('ruin-log').scrollTop = 1e6;
  document.getElementById('ruin-loot').textContent = ruin.loot ? `loot so far: ${ruin.loot}g` : '';
}

function ruinNext() {
  if (!ruin) return;
  const roll = Math.random();
  if (ruin.stage >= RUIN_STAGES) { ruinTreasure(); return; }
  ruin.stage++;
  if (roll < 0.45) {
    // monster!
    ruin.log.push('Something stirs in the dark…');
    renderRuin();
    startLandBattle();
    landBattle.onEnd = won => {
      if (won === true) { ruin && ruin.log.push('The way is clear.'); renderRuin(); }
      else if (won === false) { ruinFlee(); }
      // defeat handled by the usual wake-at-ship; ruin run just ends
      if (won === null) ruin = null, renderRuin();
    };
  } else if (roll < 0.7) {
    const dmg = Math.round(3 + Math.random() * (4 + P.hero.lv));
    P.hero.hp = Math.max(0, P.hero.hp - dmg);
    ruin.log.push(`A trap! ${CHARACTER_NAMES[P.character]} takes ${dmg} damage.`);
    if (P.hero.hp <= 0) {
      ruin.log.push('You collapse in the dark…');
      P.gold = Math.floor(P.gold * 0.9);
      P.hero.hp = 1;
      for (const id of P.mates) P.mateHp[id] = 1;
      ruin = null;
      renderRuin();
      landPos.set(shipPos.x, 0.4, shipPos.z);
      reboard();
      showBanner('You barely made it back to the ship…<small>lost 10% of your gold</small>');
      save();
      return;
    }
    save();
    renderRuin();
  } else {
    const g = Math.round(20 + Math.random() * 40 * (1 + P.hero.lv * 0.3));
    ruin.loot += g;
    P.gold += g;
    ruin.log.push(`You find a hidden cache — ${g}g!`);
    save();
    renderRuin();
  }
}

function ruinTreasure() {
  const r = ruin.data;
  const g = Math.round(150 + Math.random() * 150 * (1 + P.hero.lv * 0.3));
  const exp = 15 + P.hero.lv * 5;
  P.gold += g;
  P.hero.exp += exp;
  heroLevelUps(ruin.log);
  gainFame('adventureFame', 2);
  P.ruinCd = P.ruinCd ?? {};
  P.ruinCd[r.id] = P.days;
  ruin.log.push(`Deep in the sanctum you find the treasure of ${r.name}: ${g}g and ${exp} exp! fame +2`);
  ruin.loot += g;
  save();
  renderRuin();
  ruin = null;
  setTimeout(renderRuin, 2500);
}

function ruinFlee() {
  if (!ruin) return;
  ruin.log.push('You retreat from the ruins…');
  renderRuin();
  ruin = null;
  setTimeout(renderRuin, 1200);
}

const ruinCooldown = id => (P.ruinCd?.[id] ?? -99) + 7 > P.days;

// ---------------------------------------------------------------------------
// Player state (persisted to localStorage)
// ---------------------------------------------------------------------------
// 22 real ships from uw2ol's hash_ship_name_to_attributes, sorted by price
const SHIPS = Object.entries(shipData).map(([name, a]) => ({
  name,
  speed: 4 + a.power / 16,                          // ~7.8 - 10.3 tiles/s
  cargo: Math.max(10, Math.round(a.capacity / 10)),
  hull: a.durability * 2,
  guns: a.guns,
  minCrew: a.min_crew,
  maxCrew: a.max_crew,
  tacking: a.tacking ?? 70,
  price: a.price,
  row: a.capacity < 100 ? 0 : a.capacity < 300 ? 2 : a.capacity < 600 ? 1 : 3,
})).sort((x, y) => x.price - y.price);
const shipByName = n => SHIPS.find(s => s.name === n) ?? SHIPS[0];

const TITLES = [[50, 'Duke'], [40, 'Marquis'], [30, 'Earl'], [20, 'Viscount'],
                [15, 'Baron'], [10, 'Knight'], [5, 'Squire'], [0, '']];

const SAVE_KEY = 'uw-save-v1';
let P = {
  gold: 1000, water: 15, food: 15, fatigue: 0,
  navalFame: 0, tradeFame: 0, adventureFame: 0, notoriety: 0,   // split fame + infamy
  mateFame: {},                           // mateId -> {naval, trade, adventure} (each mate's fame)
  fleet: [{ ship: 'Balsa', hull: 60 }],   // up to 5 ships; [0] = flagship
  cargo: {}, cargoCost: {}, bank: 0,
  crew: 5, mates: [],
  cabins: { navigator: null, gunner: null, accountant: null,
            lookout: null, surgeon: null, boatswain: null },
  equipment: { sails: 0, cannons: 0, ram: false, figurehead: false, boarding: false, armor: false },
  character: 0,
  hero: { lv: 1, exp: 0, hp: 28, sp: 20, weapon: 0, armor: 0, balms: 0 },
  mateSp: {},                           // mateId -> current sp
  supplyRatio: 50,                      // harbor resupply water:food ratio (water %)
  lastPort: null,                       // last port visited (for no-ship reload)
  school: null,                         // Isabella's 3-year school phase {month, stress, money, attrs}
  mateHp: {},                       // mate id -> current hp (land battles)
  telescope: false, discoveryQuest: null, deliveryQuest: null,
  palaceMilestone: 0, days: 0, discoveries: [], portsFound: [],
  portDev: {},                        // portId -> {dev, mine}
  pirateRate: 25,                     // auto-spawn interval (0 = none)
  devSpeed: null,                 // developer-mode ship speed override
  story: { step: 0 },                 // main storyline progress (per hero)
  shipsSunk: 0, treasuresDug: 0,      // storyline counters
};
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && typeof s === 'object') P = { ...P, ...s };
} catch { /* fresh game */ }
// with no ship the player can't be at sea — restore to the last port instead
if (P.fleet.length === 0 && P.lastPort) {
  const lp = ports.find(p => p.id === P.lastPort);
  if (lp) {
    const [sx, sz] = sailableNear(lp.x, lp.y);
    shipPos.set(sx, 0.4, sz);
    enterPort(P.lastPort);
    landExpedition = true;
    portReturnPos = { x: lp.x + 0.5, z: lp.y + 0.5 };
  }
}
// randomizer injections for a fresh randomized game
if (randoSummary?.mapStructure) {
  // towns & ruins must sit on the new land
  const rr = mulberry32(hashSeed(randoSeedStr || '1') ^ 0x51ab3f);
  for (const t of towns) { const [x, z] = snapLand(rr); t.x = x; t.z = z; }
  for (const r of ruins) { const [x, z] = snapLand(rr); r.x = x; r.z = z; }
}
if (randoSummary) {
  if (!localStorage.getItem(SAVE_KEY)) {
    if (randoSummary.portDev) P.portDev = { ...randoPortDev };
    try {
      const ro2 = JSON.parse(localStorage.getItem(RANDO_KEY));
      if (ro2 && ro2.pirateRate !== undefined) P.pirateRate = ro2.pirateRate;
    } catch {}
    if (randoSummary.startShip) {
      P.fleet = [{ ship: randoSummary.startShip, hull: shipByName(randoSummary.startShip).hull }];
    }
  }
  P.randoSeed = randoSeedStr;
}
// migrate saves from the 3-tier ship system
if (P.shipTier !== undefined) {
  P.ship = ['Sloop', 'Caravela Redonda', 'Galleon'][P.shipTier] ?? 'Balsa';
  delete P.shipTier;
  P.hull = Math.min(P.hull, shipByName(P.ship).hull);
}
// migrate single-ship saves to the fleet
if (!P.fleet) {
  P.fleet = [{ ship: P.ship ?? 'Balsa', hull: P.hull ?? 60 }];
}
delete P.ship;
delete P.hull;
P.cargoCost = P.cargoCost ?? {};
if (P.character > CHARACTER_NAMES.length - 1) P.character = 0;
// migrate storyline fields
P.story = P.story ?? { step: 0 };
P.shipsSunk = P.shipsSunk ?? 0;
P.treasuresDug = P.treasuresDug ?? 0;
// migrate provisions -> water/food (split into two cargo-shared resources)
if (P.provisions !== undefined) {
  if (P.water === undefined) P.water = Math.ceil(P.provisions / 2);
  if (P.food === undefined) P.food = Math.floor(P.provisions / 2);
  delete P.provisions;
}
P.water = P.water ?? 15;
P.food = P.food ?? 15;
// backward-compat alias: P.provisions = min(water, food) (tests/HUD use it)
Object.defineProperty(P, 'provisions', {
  get: () => Math.min(P.water, P.food),
  set: v => { P.water = v; P.food = v; },
  configurable: true,
});

// migrate fame -> naval/trade/adventure (split into three fame types)
if (P.fame !== undefined) {
  if (P.adventureFame === undefined) P.adventureFame = P.fame;   // old single fame -> adventure
  delete P.fame;
}
P.navalFame = P.navalFame ?? 0;
P.tradeFame = P.tradeFame ?? 0;
P.adventureFame = P.adventureFame ?? 0;
P.notoriety = P.notoriety ?? 0;
P.mateFame = P.mateFame ?? {};
P.hero.sp = P.hero.sp ?? heroMaxSp();
P.mateSp = P.mateSp ?? {};
P.supplyRatio = P.supplyRatio ?? 50;
P.school = P.school ?? null;
// backward-compat alias: P.fame = naval + trade + adventure (storyline/fameTitle/tests use it)
Object.defineProperty(P, 'fame', {
  get: () => P.navalFame + P.tradeFame + P.adventureFame,
  set: v => { P.adventureFame = v; P.navalFame = 0; P.tradeFame = 0; },
  configurable: true,
});


const flag = () => P.fleet[0] ?? { ship: 'Balsa', hull: 0 };   // flagship (or a dummy if no ship)
const curShip = () => shipByName(flag().ship);      // flagship's type

// effective stats of a fleet ship, including refit mods
function shipStats(f) {
  const base = shipByName(f.ship);
  const m = f.mods ?? { guns: 0, hull: 0, cargo: 0, speed: 0 };
  return {
    ...base,
    guns: Math.round(base.guns * (1 + 0.2 * m.guns)),
    hull: Math.round(base.hull * (1 + 0.2 * m.hull)),
    cargo: Math.round(base.cargo * (1 + 0.2 * m.cargo)),
    speed: +(base.speed + 0.3 * m.speed).toFixed(2),
  };
}
const flagStats = () => shipStats(flag());
const REFIT_CATS = [['guns', 'Extra cannons', '+20% guns / lv'],
                    ['hull', 'Reinforced hull', '+20% hull / lv'],
                    ['cargo', 'Expanded hold', '+20% cargo / lv'],
                    ['speed', 'Streamlined hull', '+0.3 speed / lv']];
const REFIT_MAX_LV = 3;
const refitCost = (f, cat) => Math.round(shipByName(f.ship).price * 0.2);

const fleetCargoCap = () => P.fleet.length ? P.fleet.reduce((a, f) => a + shipStats(f).cargo, 0) : 10;   // no ship -> small hold for provisions
const fleetGuns = () => P.fleet.reduce((a, f) => a + shipStats(f).guns, 0);
const fleetMinCrew = () => P.fleet.reduce((a, f) => a + shipByName(f.ship).minCrew, 0);
const fleetMaxCrew = () => P.fleet.reduce((a, f) => a + shipByName(f.ship).maxCrew, 0);
const fleetSpeed = () => Math.min(...P.fleet.map(f => shipStats(f).speed));

// --- UW4 cabins: each ship has refittable cabin slots; mates are assigned ---
const CABIN_TYPES = {
  captain:    { label: 'Captain',   stat: 'leadership', desc: '+1% melee / pt' },
  navigation: { label: 'Navigator', stat: 'navigation', desc: '+5% speed / pt' },
  deck:       { label: 'Deck',      stat: 'seamanship', desc: '+2% speed / pt' },
  gunnery:    { label: 'Gunnery',   stat: 'gunnery',    desc: '+10% damage / pt' },
  accounting: { label: 'Purser',    stat: 'accounting', desc: '+5% sell / pt' },
  lookout:    { label: 'Lookout',   stat: 'intuition',  desc: '+0.5 sight / pt' },
  sickbay:    { label: 'Sick bay',  stat: 'knowledge',  desc: '-5% fatigue / pt' },
  kitchen:    { label: 'Kitchen',   stat: 'seamanship', desc: '-5% food / pt' },
  chapel:     { label: 'Chapel',    stat: 'luck',       desc: '-3% fatigue / pt' },
};
const CABIN_COUNT = cargo => (cargo <= 12 ? 2 : cargo <= 25 ? 3 : cargo <= 60 ? 4 : 5);
const CABIN_DEFAULTS = ['deck', 'navigation', 'gunnery', 'lookout', 'kitchen'];

function cabinsOf(i) {
  const f = P.fleet[i];
  const n = CABIN_COUNT(shipByName(f.ship).cargo);
  if (!f.cabins) f.cabins = CABIN_DEFAULTS.slice(0, n);
  return f.cabins;
}
P.fleet.forEach((f, i) => cabinsOf(i));   // make sure every ship has its cabins

P.shipCabins = P.shipCabins ?? {};                    // mateId -> "shipIdx:slotIdx"
const cabinKey = (i, j) => `${i}:${j}`;
const assignedMate = (i, j) =>
  Object.entries(P.shipCabins).find(([, k]) => k === cabinKey(i, j))?.[0] ?? null;
const mateCabin = id => P.shipCabins[id] ?? null;

function assignMate(id, key) {
  delete P.shipCabins[id];
  if (key) {
    for (const [other, k] of Object.entries(P.shipCabins)) {
      if (k === key && +other !== id) delete P.shipCabins[other];   // one mate per cabin
    }
    P.shipCabins[id] = key;
  }
  save();
}
// --- UWO-style mate skills: levels 1-10, grow with use ----------------------
// cabin type -> skill key
const CABIN_SKILL = {
  captain: 'leadership', navigation: 'navigation', deck: 'steering',
  gunnery: 'gunnery', accounting: 'accounting', lookout: 'lookout',
  sickbay: 'surgery', kitchen: 'cooking', chapel: 'fortune',
};
const SKILL_LABEL = {
  leadership: 'Command', navigation: 'Navigation', steering: 'Steering',
  gunnery: 'Gunnery', accounting: 'Accounting', lookout: 'Lookout',
  surgery: 'Surgery', cooking: 'Cooking', fortune: 'Fortune', swordplay: 'Swordplay',
};
P.mateSkills = P.mateSkills ?? {};   // mateId -> {skill: lv}
P.mateSkillXp = P.mateSkillXp ?? {}; // mateId -> {skill: xp}

// initial skills from base stats (stat/25 + special skill bonus)
function initMateSkills(id) {
  P.mateSkills = P.mateSkills ?? {};
  P.mateSkillXp = P.mateSkillXp ?? {};
  if (P.mateSkills[id]) return P.mateSkills[id];
  const m = matesData[id];
  const lv = (stat, special) => Math.max(1, Math.min(10, Math.floor(stat / 25) + (special ?? 0)));
  P.mateSkills[id] = {
    leadership: lv(m.leadership), steering: lv(m.seamanship), surgery: lv(m.knowledge),
    lookout: lv(m.intuition), swordplay: lv(m.swordplay), fortune: lv(m.luck),
    navigation: lv(m.navigation, m.navigation), gunnery: lv(m.gunnery, m.gunnery),
    accounting: lv(m.accounting, m.accounting), cooking: lv(m.seamanship),
  };
  P.mateSkillXp[id] = {};
  return P.mateSkills[id];
}
// lazily initialize for all hired mates
const mateSkill = (id, skill) => (initMateSkills(id), P.mateSkills[id][skill] ?? 1);
P.mates.forEach(initMateSkills);

function gainSkillXp(id, skill, xp) {
  if (!P.mates.includes(id)) return;
  initMateSkills(id);
  P.mateSkillXp[id][skill] = (P.mateSkillXp[id][skill] ?? 0) + xp;
  const lv = P.mateSkills[id][skill];
  if (lv < 10 && P.mateSkillXp[id][skill] >= lv * 10) {
    P.mateSkillXp[id][skill] = 0;
    P.mateSkills[id][skill] = lv + 1;
    showBanner(`${matesData[id].name}'s ${SKILL_LABEL[skill]} reached Lv${lv + 1}!`);
    save();
  }
}

// best skill level among mates assigned to cabins of `type`
function bestInCabins(type, skill) {
  let best = 0;
  for (const id of P.mates) initMateSkills(id);   // keep every hired mate initialized
  for (const [idStr, key] of Object.entries(P.shipCabins)) {
    const [i, j] = key.split(':').map(Number);
    if (P.fleet[i] && cabinsOf(i)[j] === type) {
      best = Math.max(best, mateSkill(+idStr, CABIN_SKILL[type] ?? skill));
    }
  }
  return best;
}

// grant skill xp to every mate posted in a cabin of `type`
function xpInCabins(type, skill, xp) {
  for (const [idStr, key] of Object.entries(P.shipCabins)) {
    const [i, j] = key.split(':').map(Number);
    if (P.fleet[i] && cabinsOf(i)[j] === type) gainSkillXp(+idStr, skill, xp);
  }
}

const navBonus = () => 1 + bestInCabins('navigation', 'navigation') * 0.012
                        + bestInCabins('deck', 'steering') * 0.005;
const accBonus = () => 1 + bestInCabins('accounting', 'accounting') * 0.02;
const lookoutRange = () => bestInCabins('lookout', 'lookout') * 1;
const surgeonFactor = () => 1 - bestInCabins('sickbay', 'surgery') * 0.02;
const boatswainFactor = () => 1 - bestInCabins('kitchen', 'cooking') * 0.02;
const chapelFactor = () => 1 - bestInCabins('chapel', 'fortune') * 0.015;

// --- port development & share (UW2-style) ----------------------------------
const CAPITAL_PORTS = ['Lisbon', 'Seville', 'London', 'Marseille', 'Amsterdam', 'Venice', 'Istanbul'];
function portDevOf(pid) {
  if (!P.portDev[pid]) {
    const p = ports.find(x => x.id === pid);
    const dev = pid === 131 ? 150
              : pid === 132 ? 200
              : CAPITAL_PORTS.includes(p?.name) ? 500
              : pid > 101 ? 100 : 200;
    P.portDev[pid] = { dev, mine: 0 };
  }
  return P.portDev[pid];
}
const portShare = pid => {
  const d = portDevOf(pid);
  return d.dev > 0 ? d.mine / d.dev : 0;   // 0..1
};

// migrate global cabins (pre-UW4) into per-ship assignments
if (P.cabins) {
  const MAP = { navigator: 'navigation', gunner: 'gunnery', accountant: 'accounting',
                lookout: 'lookout', surgeon: 'sickbay', boatswain: 'kitchen' };
  P.shipCabins = P.shipCabins ?? {};
  const used = new Set();
  for (const [slot, id] of Object.entries(P.cabins)) {
    if (!id || !P.fleet.length) continue;
    const type = MAP[slot] ?? slot;
    const cabins = cabinsOf(0);
    let j = cabins.findIndex((t, k) => t === type && !used.has(k));
    if (j < 0) j = cabins.findIndex((_, k) => !used.has(k));   // any free slot, retype it
    if (j < 0) continue;                                       // flagship full — leave unassigned
    cabins[j] = type;
    used.add(j);
    P.shipCabins[id] = cabinKey(0, j);
  }
  delete P.cabins;
}
const sailBonus = () => 1 + [0, 0.05, 0.1, 0.15][P.equipment.sails];
const CANNON_MULT = [1, 1.3, 1.6, 2];
const gunBonus = () => (1 + bestInCabins('gunnery', 'gunnery') * 0.04) * CANNON_MULT[P.equipment.cannons];
const crewOk = () => P.crew >= fleetMinCrew();
const battleDmg = () => fleetGuns() / 4 * gunBonus() * (crewOk() ? 1 : 0.5);

// figure portrait: 65x81 cell from figures.png
const figuresImg = new Image();
figuresImg.src = './assets/figures.png';
const figureCache = new Map();
function figureUrl(x, y) {
  const key = x + ',' + y;
  if (figureCache.has(key)) return figureCache.get(key);
  const c = document.createElement('canvas');
  c.width = 65; c.height = 81;
  c.getContext('2d').drawImage(figuresImg, (x - 1) * 65 + 3, (y - 1) * 81 + 3, 59, 75,
                             0, 0, 65, 81);
  const url = c.toDataURL();
  figureCache.set(key, url);
  return url;
}

// mate portrait: custom `portrait` URL (e.g. waifulabs) if present, else figures.png cell
function matePortraitUrl(m) {
  return m.portrait ? m.portrait : figureUrl(...m.image);
}

// NPC dialog portrait: front-facing sprite cropped from npc_atlas.png (Jephed pack)
const npcAtlasImg = new Image();
npcAtlasImg.src = './assets/npc_atlas.png';
const npcPortraitCache = new Map();
function npcPortraitUrl(charIdx) {
  if (npcPortraitCache.has(charIdx)) return npcPortraitCache.get(charIdx);
  const c = document.createElement('canvas');
  c.width = 60; c.height = 90;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  // front ('down') walk frame 0: 20x32 at ((charIdx%8)*64, floor(charIdx/8)*128)
  const sx = (charIdx % 8) * 64, sy = Math.floor(charIdx / 8) * 128;
  g.drawImage(npcAtlasImg, sx, sy, 20, 32, 0, 0, 60, 90);
  const url = c.toDataURL();
  npcPortraitCache.set(charIdx, url);
  return url;
}

// discoveries / found ports live in Sets, mirrored into P on save
const discoveriesFound = new Set(P.discoveries);
const discovered = new Set(P.portsFound);

function save() {
  P.discoveries = [...discoveriesFound];
  P.portsFound = [...discovered];
  localStorage.setItem(SAVE_KEY, JSON.stringify(P));
}

const cargoUsed = () => Object.values(P.cargo).reduce((a, b) => a + b, 0) + Math.ceil((P.water + P.food) / 10);   // goods + water/food (10:1) share the hold
const cargoSpace = () => fleetCargoCap() - cargoUsed();
const fameTitle = () => TITLES.find(([n]) => P.fame >= n)[1];

function speedFactor() {
  if (flag().hull <= 0) return 0.25;
  if ((P.water <= 0 || P.food <= 0) || P.fatigue >= 90) return 0.5;
  return 1;
}

// UW3-style terrain bands by latitude (land expeditions)
function terrainAt(z) {
  const lat = Math.abs(-0.13063 * z + 85.84);
  if (lat > 55) return 'snow';
  if (lat < 15) return 'jungle';
  if (lat < 32) return 'desert';
  return 'plains';
}

// consumption settlement: runs TWICE per game day (midday + midnight),
// each at half the daily rate
function settleConsumption() {
  if (scene === 'land') {
    // expeditions eat and tire like in UW3
    const terrain = terrainAt(landPos.z);
    const drain = (terrain === 'snow' ? 4 : terrain === 'plains' ? 6 : 10) / 2;
    P.water = Math.max(0, P.water - drain / 2 * boatswainFactor());
    P.food = Math.max(0, P.food - drain / 2 * boatswainFactor());
    P.fatigue = Math.min(100, P.fatigue + (terrain === 'snow' ? 18 : 10) / 2 * (P.equipment.figurehead ? 0.5 : 1) * surgeonFactor());
    if (P.water <= 0 || P.food <= 0) {
      P.hero.hp = Math.max(1, P.hero.hp - 3);
      showBanner('Out of water and rations!<small>the expedition is starving — find a town or your ship</small>');
    }
  }
  if (scene === 'sea') {
    // water & rations: more mouths to feed -> faster drain; each drains at half rate
    const drain = (4 + P.crew * 0.25) / 2 * boatswainFactor();
    P.water = Math.max(0, P.water - drain / 2);
    P.food = Math.max(0, P.food - drain / 2);
    const starving = P.water <= 0 || P.food <= 0;
    // a starving crew tires far faster
    P.fatigue = Math.min(100, P.fatigue + 6 * (starving ? 3 : 1)
                 * (P.equipment.figurehead ? 0.5 : 1) * surgeonFactor() * chapelFactor());
    if (starving) {
      showBanner('Out of water and rations!<small>the crew is starving — fatigue soars; find a port</small>');
    }
    if (P.fatigue >= 100) {
      // exhaustion kills: 10 + random(5%, 25%) of the crew per settlement (twice a day)
      const dead = Math.min(P.crew, 10 + Math.ceil(P.crew * (0.05 + Math.random() * 0.2)));
      P.crew = Math.max(0, P.crew - dead);
      if (P.crew <= 0) { gameOver('exhaustion'); return; }
      showBanner(`${dead} sailors died of exhaustion!<small>lower fatigue — rest at an inn, lime juice, chapel</small>`);
    }
  }
}

function onNewDay() {
  P.days++;
  P.bank = Math.floor(P.bank * 1.02);          // 2% daily interest
  // mates train their posted skills daily (UWO-style growth)
  for (const [idStr, key] of Object.entries(P.shipCabins)) {
    const [i, j] = key.split(':').map(Number);
    const type = P.fleet[i] && cabinsOf(i)[j];
    if (type) gainSkillXp(+idStr, CABIN_SKILL[type], 1);
  }
  // SP regenerates daily (hero + mates)
  P.hero.sp = Math.min(heroMaxSp(), P.hero.sp + 1);
  for (const id of P.mates) P.mateSp[id] = Math.min(mateMaxSp(id), (P.mateSp[id] ?? mateMaxSp(id)) + 1);
  if (scene === 'sea') flag().hull = Math.max(0, flag().hull - 1);   // daily wear
  settleConsumption();
  save();
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
const buildingPanel = document.getElementById('building-panel');
const buildingText = document.getElementById('building-text');
const buildingActions = document.getElementById('building-actions');
const BUILDING_FLAVOR = {
  market: 'Spices, fabrics and goods from distant lands fill the stalls.',
  bar: 'Sailors raise their mugs and swap tales of the sea.',
  dry_dock: 'Shipwrights hammer away at hulls new and old.',
  harbor: 'Your ship rides at anchor, ready to set sail.',
  inn: 'A warm bed and a hot meal await the weary traveler.',
  palace: 'The governor receives you beneath gilded ceilings.',
  job_house: 'Notices and contracts are pinned to the board.',
  msc: 'Scholars and merchants murmur over charts and ledgers.',
  bank: 'Your gold is safe behind these heavy doors.',
  item_shop: 'Charts, tools and curiosities line the shelves.',
  church: 'A quiet place to give thanks for safe passage.',
  fortune_house: 'The cards and stars may reveal your fortune.',
};

// --- building action helpers -------------------------------------------------
let pendingHire = null;   // mate id being chatted up in the bar
function setBuildingText(t) { buildingText.innerHTML = t; }

// append one menu button (label, onclick, disabled) to a container
function mkBtn(container, label, fn, disabled = false) {
  const b = document.createElement('button');
  b.textContent = label; b.disabled = disabled; b.onclick = fn;
  container.appendChild(b);
}

function renderActions(menu) {
  buildingActions.innerHTML = '';
  for (const item of menu) {
    const btn = document.createElement('button');
    btn.textContent = item.label + (item.cost ? ` (${item.cost}g)` : '');
    btn.disabled = !!item.disabled || (!!item.cost && P.gold < item.cost);
    btn.onclick = () => {
      const keep = item.action();
      save();
      if (!keep) renderActions(buildingMenu(inBuilding));   // action may render its own submenu
    };
    buildingActions.appendChild(btn);
  }
}

const FORTUNES = [
  'A fair wind fills your sails this week.',
  'Beware the calm — patience rewards the waiting captain.',
  'Gold spent on friends is never wasted.',
  'A discovery awaits you in distant waters.',
  'The stars favor the bold. Sail far.',
  'Storm clouds gather, but your ship is sturdy.',
];

function buildingMenu(b) {
  if (!b) return [];
  const ship = curShip();
  switch (b.name) {
    // --- Isabella prologue (Faro) ---
    case 'cemetery': {
      if (P.character === 6 && P.prologue && P.prologue.step === 0) {
        return [{ label: 'Lay flowers at your mother\'s grave', action() {
          P.prologue.step = 1;
          showDialog(CHARACTER_NAMES[6],
            'You kneel and lay fresh flowers on the grave. <i>Mother…</i><br><br>' +
            '<b>— flashback —</b><br>Word of your mother\'s passing reached Duke Leon Franco in Lisbon. ' +
            'Grieving, he resolved to bring his daughter home: "Isabella will come to Lisbon, where I can watch over her."<br><br>' +
            'In the distance, a blonde girl (Eudora) watches you quietly from behind a tree.',
            DOS_PORTRAIT[6]);
          save();
        } }];
      }
      return [{ label: 'A quiet cemetery. The graves are well-tended.', disabled: true, action() {} }];
    }
    case 'teacher': {
      if (P.character === 6 && P.prologue && P.prologue.step === 1) {
        return [{ label: 'Say goodbye to your teacher', action() {
          P.prologue.step = 2;
          showDialog('Teacher',
            '"So you\'re going to Lisbon, Isabella — your father the Duke has called for you.<br>' +
            'Take my research with you. And Eudora, my daughter, will go with you. Watch over each other."',
            DOS_PORTRAIT[6]);
          save();
        } }];
      }
      return [{ label: 'Your teacher\'s study, lined with ancient texts.', disabled: true, action() {} }];
    }
    case 'home': {
      if (P.character === 6 && P.prologue && P.prologue.step === 2) {
        return [{ label: 'Sleep', action() {
          P.prologue.step = 3;
          onNewDay();   // advance to the next day
          showDialog(CHARACTER_NAMES[6],
            'You pack your few belongings and lie down, heart pounding. Tomorrow you sail for Lisbon — ' +
            'a new life with your father, the Duke.<br><br><i>(Next: board the merchant ship at the harbor.)</i>',
            DOS_PORTRAIT[6]);
          save();
        } }];
      }
      return [{ label: 'Your modest home in Faro.', disabled: true, action() {} }];
    }
    case 'harbor': {
      const menu = [
        { label: 'Resupply (fill up)', disabled: P.fleet.length === 0, action() { openPanel('supply'); } },
        { label: 'Buy water +50 (50g)', cost: 50, disabled: P.fleet.length === 0 || cargoSpace() < 1,
          action() { const n = Math.min(50, cargoSpace()); P.gold -= n; P.water += n;
                     setBuildingText(`Fresh water loaded (+${n}). The crew is ready.`); } },
        { label: 'Buy food +50 (50g)', cost: 50, disabled: P.fleet.length === 0 || cargoSpace() < 1,
          action() { const n = Math.min(50, cargoSpace()); P.gold -= n; P.food += n;
                     setBuildingText(`Rations stowed aboard (+${n}). The crew is ready.`); } },
      ];
      // Isabella prologue: board the merchant ship to Lisbon
      if (P.character === 6 && P.prologue && P.prologue.step === 3) {
        menu.unshift({ label: 'Board the merchant ship to Lisbon', action() {
          P.prologue.step = 4;   // next: greet the Duke at the MSC
          hideBuildingPanel();   // close the Harbor UI
          landExpedition = false;
          const faro = ports.find(p => p.id === 132);
          const lisbon = ports.find(p => p.id === 1);
          merchantShipAnimation(faro, lisbon, () => {
            const [sx, sz] = sailableNear(lisbon.x, lisbon.y);
            shipPos.set(sx, 0, sz);
            enterPort(1);   // arrive in Lisbon
            showBanner('To Lisbon!<small>go to the Duke\'s mansion (MSC) to greet your father</small>');
            save();
          });
        } });
      }
      // board a merchant ship (for players with no ship — travel between ports)
      if (P.fleet.length === 0 && !(P.character === 6 && P.prologue && P.prologue.step < 4)) {
        const here = ports.find(p => p.id === portId);
        const nearby = ports.filter(p => p.id !== portId && (p.id <= 101 || p.id === 132) &&
          Math.hypot(p.x - here.x, p.y - here.y) < 120).slice(0, 4);
        for (const dest of nearby) {
          menu.push({ label: `Board a merchant ship to ${dest.name}`, action() {
            hideBuildingPanel();
            merchantShipAnimation(here, dest, () => {
              const [sx, sz] = sailableNear(dest.x, dest.y);
              shipPos.set(sx, 0, sz);
              enterPort(dest.id);   // arrive at the destination port by sea (not on foot)
              save();
            });
          } });
        }
      }
      if (landExpedition) {
        menu.push({ label: 'Leave the city (on foot)', action() { exitPortToLand(); } });
      } else {
        const here = ports.find(p => p.id === portId);
        const shipHere = here && Math.hypot(shipPos.x - here.x, shipPos.z - here.y) <= 6;
        if (shipHere) {
          menu.push({ label: 'Set sail', action() { setSail(); } });
        } else {
          menu.push({ label: 'Buy a new ship & set sail', cost: 1000, action() {
            P.gold -= 1000;
            const [x, z] = sailableNear(here.x, here.y);
            shipPos.set(x, 0.4, z);
            setSail();
          } });
        }
      }
      return menu;
    }
    case 'market': return [
      { label: 'Trade goods', action() { openPanel('market'); } },
    ];
    case 'inn': return [
      { label: 'Rest until morning', cost: 10, action() {
        P.gold -= 10; P.fatigue = 0;
        P.hero.hp = heroMaxHp();
        for (const id of P.mates) P.mateHp[id] = mateMaxHp(id);
        onNewDay();
        setBuildingText('You sleep soundly. Fatigue and wounds washed away — a new day begins.');
      } },
    ];
    case 'bar': {
      const ship = curShip();
      const menu = [
        { label: 'Ask for rumors', cost: 25, action() {
          P.gold -= 25;
          const unknown = villages.filter(v => !discoveriesFound.has(v.id));
          if (!unknown.length) { setBuildingText('"You\'ve seen it all, captain!"'); return; }
          const v = unknown[Math.floor(Math.random() * unknown.length)];
          setBuildingText(`"I heard there's something interesting at ${fmtLonLat(v.x, v.y)}… worth a look, captain."`);
        } },
        { label: `Resupply sailors (${P.crew}/${fleetMaxCrew()})`,
          action() { openPanel('crew'); } },
      ];
      // this port's mate (uw2ol: even 1-based port id -> mate id = portId/2)
      const mateId = portId <= 100 && portId % 2 === 0 ? portId / 2 : null;
      if (mateId && !P.mates.includes(mateId)) {
        const m = matesData[mateId];
        const cost = 100 * (1 + m.navigation + m.gunnery + m.accounting);
        if (pendingHire === mateId) {
          menu.unshift({ label: `Hire ${m.name}`, cost, action() {
            P.gold -= cost;
            P.mates.push(mateId);
            pendingHire = null;
            setBuildingText(`<b>${m.name}</b> joins your crew! Assign them a cabin via Manage mates & cabins.`);
          } });
        } else {
          menu.push({ label: `Meet ${m.name}`, action() {
            pendingHire = mateId;
            setBuildingText(
              `<img src="${matePortraitUrl(m)}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
              `<b>${m.name}</b> · ${m.nation} · lv ${m.lv}<br>` +
              `leadership ${m.leadership} · seamanship ${m.seamanship} · luck ${m.luck}<br>` +
              `navigation ${m.navigation} · gunnery ${m.gunnery} · accounting ${m.accounting}<br>` +
              `"I miss the high seas. Take me with you, captain — for ${cost}g."`);
          } });
        }
      }
      // this port's bar maid (uw2ol hash_maids)
      const maidId = portMeta[Math.min(portId, 101)].maid;
      if (maidId && maidsData[maidId]) {
        menu.push({ label: `Talk to the waitress`, action() { return talkToMaid(maidId); } });
      }
      menu.push({ label: "Play Texas Hold'em (德州扑克)", action() { openPoker(); } });
      menu.push({ label: 'Play blackjack (21点)', action() { openBlackjack(); } });
      menu.push({ label: 'Manage mates & cabins', action() { openPanel('mates'); } });
      return menu;
    }
    case 'dry_dock': {
      const dmg = flagStats().hull - flag().hull;
      return [
        { label: `Repair hull (${flag().hull}/${flagStats().hull})`, cost: dmg * 2, disabled: dmg <= 0,
          action() { P.gold -= dmg * 2; flag().hull = flagStats().hull;
                     setBuildingText('Hull patched and caulked. She\'s seaworthy again.'); } },
        { label: 'Buy a new ship', action() { openPanel('shipyard'); } },
        { label: 'Outfit ship', action() { openPanel('outfit'); } },
      ];
    }
    case 'palace': {
      const next = P.palaceMilestone + 5;
      const pd = portDevOf(portId);
      const share = (portShare(portId) * 100).toFixed(1);
      const investMenu = [100, 1000, 10000].map(amt => ({
        label: `Invest ${amt}g in development`,
        cost: amt, disabled: P.gold < amt,
        action() {
          P.gold -= amt;
          const gain = Math.max(1, Math.round(amt / 100));
          pd.dev += gain;
          pd.mine += gain;
          setBuildingText(
            `Your investment of ${amt}g bears fruit.<br>` +
            `${ports.find(x => x.id === portId)?.name} development: <b>${pd.dev}</b><br>` +
            `Your share here: <b>${(portShare(portId) * 100).toFixed(1)}%</b> ` +
            `(buy prices -${(portShare(portId) * 10).toFixed(0)}%, sell +${(portShare(portId) * 10).toFixed(0)}% in this port)`);
        },
      }));
      return [
        { label: `Development ${pd.dev} · your share ${share}%`, disabled: true, action() {} },
        ...investMenu,
        { label: `Request audience (${discoveriesFound.size}/${next} discoveries)`, disabled: discoveriesFound.size < next,
          action() {
            P.palaceMilestone = next;
            const reward = next * 100;
            P.gold += reward; gainFame('adventureFame', 2);
            setBuildingText(`The governor commends your voyages: <b>${fameTitle()}</b>! Royal reward: ${reward}g.`);
          } },
        { label: 'Pay respects', action() {
          setBuildingText(P.fame >= 5
            ? `"Ah, ${fameTitle()} — we've heard of your deeds." (fame ${P.fame})`
            : '"Come back when you\'ve made a name for yourself, sailor."');
        } },
      ];
    }
    case 'job_house': {
      // migrate legacy delivery quest
      if (P.deliveryQuest) { P.jobQuest = { type: 'delivery', ...P.deliveryQuest }; delete P.deliveryQuest; }
      const q = P.jobQuest;
      if (q?.type === 'delivery') {
        const target = ports.find(p => p.id === q.port);
        if (q.port === portId) return [
          { label: `Deliver the letter (+${q.reward}g)`, action() {
            P.gold += q.reward; gainFame('tradeFame', 3); P.jobQuest = null;
            setBuildingText(`Letter delivered! Payment: ${q.reward}g. The guild thanks you.`);
          } },
        ];
        return [{ label: `Deliver letter to ${target.name} (${fmtLonLat(target.x, target.y)})`, disabled: true,
                  action() {} }];
      }
      if (q?.type === 'cargo') {
        const have = P.cargo[q.good] ?? 0;
        if (have >= q.qty) return [
          { label: `Hand over ${q.qty} ${q.good} (+${q.reward}g)`, action() {
            P.cargo[q.good] -= q.qty;
            P.cargoCost[q.good] = (P.cargoCost[q.good] ?? 0) * P.cargo[q.good] / have;
            if (!P.cargo[q.good]) { delete P.cargo[q.good]; delete P.cargoCost[q.good]; }
            P.gold += q.reward; gainFame('tradeFame', 3); P.jobQuest = null;
            setBuildingText(`The guild inspects the ${q.good} and pays ${q.reward}g on the spot.`);
          } },
        ];
        return [{ label: `Bring ${q.qty} ${q.good} (have ${have}) — reward ${q.reward}g`, disabled: true, action() {} }];
      }
      if (q?.type === 'treasure') {
        return [{ label: `Treasure map: dig at ${fmtLonLat(q.x, q.z)}${q.done ? ' (done)' : ''}`,
                  disabled: true, action() {} }];
      }
      if (q?.type === 'bounty') {
        if (q.done) return [
          { label: `Collect the bounty (+${q.reward}g)`, action() {
            P.gold += q.reward; gainFame('navalFame', 5); P.jobQuest = null;
            setBuildingText(`"${q.name} is finished? Fine work, captain." The guild counts out ${q.reward}g.`);
          } },
        ];
        return [{ label: `Sink ${q.name} (${q.ship}) near ${fmtLonLat(q.x, q.z)} — bounty ${q.reward}g`,
                  disabled: true, action() {} }];
      }
      const here = ports.find(p => p.id === portId);
      return [
        { label: 'Take a delivery job', action() {
          const others = ports.filter(p => {
            if (p.id === portId) return false;
            const m = portMeta[Math.min(p.id, 101)];
            return m.buildings && m.buildings[7];
          });
          const t = others[Math.floor(Math.random() * others.length)];
          const dist = Math.hypot(t.x - here.x, t.y - here.y);
          const reward = 200 + Math.min(800, Math.floor(dist / 2));
          P.jobQuest = { type: 'delivery', port: t.id, reward };
          setBuildingText(`Deliver this letter to the job house in <b>${t.name}</b> (${fmtLonLat(t.x, t.y)}). Reward: ${reward}g.`);
        } },
        { label: 'Take a cargo request', action() {
          // a good this region does NOT sell (must be fetched from abroad)
          const region = (portMeta[portId] ?? portMeta[Math.min(portId, 101)]).region;
          const table = region && goodsData.regions[region];
          const names = Object.keys(table?.prices ?? {}).filter(n => !table.available[n]);
          const good = names.length ? names[Math.floor(Math.random() * names.length)] : 'Wine';
          const qty = 5 + Math.floor(Math.random() * 11);
          const base = table?.prices[good]?.[1] ?? 50;
          const reward = Math.round(qty * base * 1.5);
          P.jobQuest = { type: 'cargo', good, qty, reward };
          setBuildingText(`The guild needs <b>${qty} ${good}</b> — goods we can't get here. ` +
            `Bring them back to this job house. Reward: <b>${reward}g</b>.`);
        } },
        { label: 'Take a treasure hunt', action() {
          // a remote spot on the map (60-240 tiles away)
          let x = 0, z = 0;
          for (let tries = 0; tries < 40; tries++) {
            const ang = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 180;
            x = Math.round(here.x + Math.cos(ang) * dist);
            z = Math.round(here.y + Math.sin(ang) * dist);
            if (x > 5 && x < COLS - 5 && z > 5 && z < ROWS - 5) break;
          }
          const gold = Math.round((800 + Math.random() * 1200) * (1 + P.fame * 0.02));
          P.jobQuest = { type: 'treasure', x, z, gold, guarded: Math.random() < 0.5, done: false };
          setBuildingText(`An old map surfaces in the guild archives — <b>${fmtLonLat(x, z)}</b>. ` +
            `The guild's cut is already taken. Dig there, captain.` +
            (P.jobQuest.guarded ? ' <i>Rumor says someone is watching it…</i>' : ''));
        } },
        { label: 'Take a bounty hunt', action() {
          const ang = Math.random() * Math.PI * 2;
          const dist = 40 + Math.random() * 60;
          const x = Math.round(here.x + Math.cos(ang) * dist);
          const z = Math.round(here.y + Math.sin(ang) * dist);
          const shipName = PIRATE_SHIPS[Math.floor(Math.random() * PIRATE_SHIPS.length)];
          const names = ['Dread Captain Redhand', 'Black Bart', 'Red Zahra', 'Sea Wolf Ortiz',
                         'Crimson Jack', 'Madame Storm'];
          const name = names[Math.floor(Math.random() * names.length)];
          const reward = Math.round((500 + Math.random() * 500) * (1 + P.fame * 0.02));
          P.jobQuest = { type: 'bounty', name, ship: shipName, x, z, reward, done: false };
          setBuildingText(`<b>${name}</b> and their ${shipName} have been raiding our convoys near ` +
            `<b>${fmtLonLat(x, z)}</b>. Sink or capture them. Bounty: <b>${reward}g</b>.`);
        } },
      ];
    }
    case 'msc': {
      // Isabella: continue the 3-year school phase
      if (P.character === 6 && P.school) {
        return [{ label: `Continue school (month ${P.school.month}/36)`, action() { openPanel('school'); } }];
      }
      // Isabella prologue: greet the Duke (her father)
      if (P.character === 6 && P.prologue && P.prologue.step === 4) {
        return [{ label: 'Greet your father, Duke Leon Franco', action() {
          P.prologue.step = 5;   // prologue done
          showDialog('Duke Leon Franco',
            '"Isabella… my daughter. You\'ve grown so much since I last saw you as a child.<br><br>' +
            'I heard about your mother. I\'m so sorry — I should have been there for you both.<br><br>' +
            '<i>(You want to tell him how he neglected you and mother all these years… but you hold your tongue.)</i><br><br>' +
            '"Now — you will study here in Lisbon for three years. Make me proud."',
            './assets/dos/duke.png');
          // Chapter 1: 3-year school phase (PM2-style)
          P.school = { month: 0, stress: 0, money: 500, attrs: { ...HERO_ATTRS[6] } };
          save();
          setTimeout(() => openPanel('school'), 4800);   // open the school panel after the dialog
        } }];
      }
      if (P.discoveryQuest) {
        if (discoveriesFound.has(P.discoveryQuest)) {
          const v = villages.find(x => x.id === P.discoveryQuest);
          return [
            { label: `Report: ${v.name} (+600g)`, action() {
              P.gold += 600; gainFame('adventureFame', 5); P.discoveryQuest = null;
              setBuildingText(`Astounding — ${v.name}, confirmed! Reward: 600g. The society applauds you.`);
            } },
          ];
        }
        const v = villages.find(x => x.id === P.discoveryQuest);
        return [{ label: `Find: ${v.name} (${fmtLonLat(v.x, v.y)})`, disabled: true, action() {} }];
      }
      return [
        { label: 'Take a research quest', action() {
          const unknown = villages.filter(v => !discoveriesFound.has(v.id));
          if (!unknown.length) { setBuildingText('"Nothing left to discover, my friend!"'); return; }
          const v = unknown[Math.floor(Math.random() * unknown.length)];
          P.discoveryQuest = v.id;
          setBuildingText(`"I heard there's something interesting at <b>${fmtLonLat(v.x, v.y)}</b>. Would you investigate? Return to any of our halls when you find it."`);
        } },
      ];
    }
    case 'bank': {
      return [
        { label: 'Deposit 100g', action() { const a = Math.min(100, P.gold); P.gold -= a; P.bank += a;
          setBuildingText(`Balance: ${P.bank}g (2% daily interest).`); }, disabled: P.gold <= 0 },
        { label: 'Deposit all', action() { P.bank += P.gold; P.gold = 0;
          setBuildingText(`Balance: ${P.bank}g (2% daily interest).`); }, disabled: P.gold <= 0 },
        { label: 'Withdraw 100g', action() { const a = Math.min(100, P.bank); P.bank -= a; P.gold += a;
          setBuildingText(`Balance: ${P.bank}g. Gold in hand: ${P.gold}g.`); }, disabled: P.bank <= 0 },
        { label: 'Withdraw all', action() { P.gold += P.bank; P.bank = 0;
          setBuildingText(`Balance: 0g. Gold in hand: ${P.gold}g.`); }, disabled: P.bank <= 0 },
      ];
    }
    case 'item_shop': return [
      { label: 'Cutlass (+4 hero atk)', cost: 500, disabled: P.hero.weapon >= 1,
        action() { P.gold -= 500; P.hero.weapon = 1;
                   setBuildingText('A fine cutlass for your expeditions ashore. (+4 attack)'); } },
      { label: 'Rapier (+8 hero atk)', cost: 2000, disabled: P.hero.weapon >= 2,
        action() { P.gold -= 2000; P.hero.weapon = 2;
                   setBuildingText('An elegant rapier. (+8 attack)'); } },
      { label: 'Saber (+14 hero atk)', cost: 8000, disabled: P.hero.weapon >= 3,
        action() { P.gold -= 8000; P.hero.weapon = 3;
                   setBuildingText('A masterwork saber. (+14 attack)'); } },
      { label: 'Leather armor (+2 hero def)', cost: 400, disabled: P.hero.armor >= 1,
        action() { P.gold -= 400; P.hero.armor = 1;
                   setBuildingText('Sturdy leather armor. (+2 defense)'); } },
      { label: 'Chain mail (+5 hero def)', cost: 1500, disabled: P.hero.armor >= 2,
        action() { P.gold -= 1500; P.hero.armor = 2;
                   setBuildingText('Rings of steel. (+5 defense)'); } },
      { label: 'Plate armor (+9 hero def)', cost: 6000, disabled: P.hero.armor >= 3,
        action() { P.gold -= 6000; P.hero.armor = 3;
                   setBuildingText('A knight\'s plate. (+9 defense)'); } },
      { label: 'Balm (heal 30 HP in battle)', cost: 100,
        action() { P.gold -= 100; P.hero.balms++;
                   setBuildingText(`A fragrant healing balm. (you have ${P.hero.balms})`); } },
      { label: 'Telescope (spot discoveries from afar)', cost: 2000, disabled: P.telescope,
        action() { P.gold -= 2000; P.telescope = true;
                   setBuildingText('With the telescope you can spot interesting sites from much farther away.'); } },
      { label: 'Water (+50, 50g)', cost: 50, disabled: cargoSpace() < 1,
        action() { const n = Math.min(50, cargoSpace()); P.gold -= n; P.water += n;
                   setBuildingText('Fresh water stowed aboard.'); } },
      { label: 'Rations (+50 food, 50g)', cost: 50, disabled: cargoSpace() < 1,
        action() { const n = Math.min(50, cargoSpace()); P.gold -= n; P.food += n;
                   setBuildingText('Hardtack and salted pork stowed aboard.'); } },
      { label: 'Lime juice (-50 fatigue)', cost: 300, disabled: P.fatigue <= 0,
        action() { P.gold -= 300; P.fatigue = Math.max(0, P.fatigue - 50);
                   setBuildingText('The crew gulps it down. Scurvy kept at bay.'); } },
    ];
    case 'church': return [
      { label: 'Make a donation', cost: 20, action() {
        P.gold -= 20;
        const roll = Math.random();
        if (roll < 0.3) { gainFame('adventureFame', 1); setBuildingText('Your generosity is remembered. (fame +1)'); }
        else if (roll < 0.6) { P.water += 10; P.food += 10;
          setBuildingText('The sisters share bread and water with your crew. (water +10, food +10)'); }
        else setBuildingText('Peace settles over you. Safe travels, captain.');
      } },
    ];
    case 'fortune_house': return [
      { label: 'Hear your fortune', cost: 10, action() {
        P.gold -= 10;
        if (Math.random() < 0.1) { P.gold += 100;
          setBuildingText('"Great fortune! A benefactor smiles upon you." (+100g!)'); }
        else setBuildingText('"' + FORTUNES[Math.floor(Math.random() * FORTUNES.length)] + '"');
      } },
    ];
    default: return [];
  }
}

function openBuilding(b) {
  inBuilding = b;
  document.getElementById('building-name').textContent =
    b.name.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  document.getElementById('building-img').src = `./assets/buildings/${b.name}.png`;
  setBuildingText(BUILDING_FLAVOR[b.name] ?? 'Welcome!');
  renderActions(buildingMenu(b));
  buildingPanel.style.display = 'block';
  if (['bar', 'church', 'palace', 'msc'].includes(b.name)) {
    playMusic(`./assets/music/building/${b.name}.mp3`);
  }
}

function hideBuildingPanel() {
  buildingPanel.style.display = 'none';
  pendingHire = null;
  closeBlackjack();
  closePoker();
  closeBuildingSubPanels();
  if (inBuilding && ['bar', 'church', 'palace'].includes(inBuilding.name)) {
    playMusic(portMusicFor(portId));
  }
  inBuilding = null;
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------
const marketPanel = document.getElementById('market-panel');

// --- goods icons: colored category badges with a monogram -------------------
const GOOD_CATS = {
  spice:  { color: '#c0392b', goods: ['Clove','Cinnamon','Pepper','Nutmeg','Pimento','Ginger','Musk'] },
  food:   { color: '#27ae60', goods: ['Sugar','Cheese','Fish','Grain','Olive Oil','Wine','Rock Salt'] },
  fabric: { color: '#8e44ad', goods: ['Silk','Cotton','Wool','Flax'] },
  cloth:  { color: '#2980b9', goods: ['Cotton Cloth','Silk Cloth','Wool Cloth','Velvet','Linen Cloth','Carpet'] },
  special:{ color: '#8b5a2b', goods: ['Tobacco','Tea','Coffee','Cacao'] },
  arms:   { color: '#7f1d1d', goods: ['Arms'] },
  gem:    { color: '#16a3a3', goods: ['Amber','Coral','Pearl','Ivory','Tortoise Shell','Art','Porcelain','Glassware','Glass Beads'] },
  metal:  { color: '#6b7280', goods: ['Copper Ore','Iron Ore','Tin Ore','Gold','Silver'] },
};
const goodCat = {};
for (const c of Object.values(GOOD_CATS)) for (const g of c.goods) goodCat[g] = c.color;
const iconCache = {};
function goodIcon(name) {
  if (iconCache[name]) return iconCache[name];
  const c = document.createElement('canvas');
  c.width = c.height = 22;
  const g = c.getContext('2d');
  g.fillStyle = goodCat[name] ?? '#a08040';
  g.beginPath();
  g.roundRect(0, 0, 22, 22, 4);
  g.fill();
  g.fillStyle = '#fff';
  g.font = 'bold 13px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name[0], 11, 12);
  return iconCache[name] = c.toDataURL();
}

// average purchase price of a held good (0 = unknown / gift)
const avgBuy = name => (P.cargo[name] ?? 0) > 0 ? (P.cargoCost[name] ?? 0) / P.cargo[name] : 0;

function marketRows() {
  const meta = portMeta[portId] ?? portMeta[Math.min(portId, 101)];
  const region = meta.region;
  const table = region ? goodsData.regions[region] : null;
  const share = portShare(portId);   // your share: buy -10%, sell +10% at 100%
  const rows = [];
  if (table) {
    for (const [name, [buy, sell]] of Object.entries(table.prices)) {
      rows.push({
        name,
        buy: table.available[name]?.[0] != null
          ? Math.max(1, Math.round(table.available[name][0] * (1 - share * 0.1))) : null,
        sell: Math.round(sell * (1 + share * 0.1)),
      });
    }
  }
  const spec = goodsData.specialties[portId];
  if (spec && !rows.find(r => r.name === spec.name)) {
    const sell = table?.prices[spec.name]?.[1] ?? Math.floor(spec.price * 1.5);
    rows.push({ name: spec.name, buy: Math.max(1, Math.round(spec.price * (1 - share * 0.1))),
                sell: Math.round(sell * (1 + share * 0.1)), special: true });
  } else if (spec) {
    const r = rows.find(r => r.name === spec.name);
    r.buy = Math.max(1, Math.round(spec.price * (1 - share * 0.1)));
    r.special = true;
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// small helper: append an action button to a table row cell
function rowButton(td, label, disabled, onclick, title = '') {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.disabled = disabled;
  btn.title = title;
  btn.onclick = onclick;
  td.appendChild(btn);
  return btn;
}

function renderMarket(msg = '') {
  document.getElementById('market-info').innerHTML =
    `gold: <b>${P.gold}g</b> &nbsp;·&nbsp; cargo space: <b>${cargoSpace()}</b> / ${curShip().cargo}` +
    (msg ? ` &nbsp;·&nbsp; ${msg}` : '');
  const div = document.getElementById('market-table');
  // only goods sold here, plus whatever the player holds and can sell
  const rows = marketRows().filter(r => r.buy != null || (P.cargo[r.name] ?? 0) > 0);
  let html = '<table><tr><th>goods</th><th>buy</th><th>sell</th><th>hold</th><th></th></tr>';
  for (const r of rows) {
    const hold = P.cargo[r.name] ?? 0;
    // profit per unit vs average purchase price (green gain / red loss)
    const effSell = Math.ceil(r.sell * accBonus());
    let sellCell = `${effSell}`;
    if (hold > 0 && avgBuy(r.name) > 0) {
      const pl = effSell - avgBuy(r.name);
      sellCell += pl > 0 ? ` <span class="pos">(+${pl.toFixed(0)})</span>`
               : pl < 0 ? ` <span class="neg">(${pl.toFixed(0)})</span>` : '';
    }
    html += `<tr${r.special ? ' class="specialty"' : ''}>` +
      `<td><img class="good-icon" src="${goodIcon(r.name)}" alt="">${r.name}${r.special ? ' ★' : ''}</td>` +
      `<td class="num">${r.buy ?? '—'}</td><td class="num">${sellCell}</td><td class="num">${hold}</td><td></td></tr>`;
  }
  div.innerHTML = html + '</table>';
  const trs = div.querySelectorAll('tr');
  const buyN = (r, n) => {
    P.gold -= r.buy * n;
    P.cargo[r.name] = (P.cargo[r.name] ?? 0) + n;
    P.cargoCost[r.name] = (P.cargoCost[r.name] ?? 0) + r.buy * n;
    save(); renderMarket(`Bought ${n} ${r.name} (-${r.buy * n}g)`);
  };
  const sellN = (r, n) => {
    xpInCabins('accounting', 'accounting', 1);
    const hold = P.cargo[r.name];
    n = Math.min(n, hold);
    const revenue = Math.ceil(r.sell * accBonus()) * n;
    const costCut = (P.cargoCost[r.name] ?? 0) * n / hold;
    const pl = revenue - costCut;
    P.gold += revenue;
    P.cargo[r.name] -= n;
    P.cargoCost[r.name] = (P.cargoCost[r.name] ?? 0) - costCut;
    if (!P.cargo[r.name]) { delete P.cargo[r.name]; delete P.cargoCost[r.name]; }
    save();
    const plTxt = costCut > 0
      ? (pl >= 0 ? ` <span class="pos">profit +${pl.toFixed(0)}g</span>`
                 : ` <span class="neg">loss ${pl.toFixed(0)}g</span>`) : '';
    renderMarket(`Sold ${n} ${r.name} (+${revenue}g)${plTxt}`);
  };
  rows.forEach((r, i) => {
    const td = trs[i + 1].lastChild;
    if (r.buy != null) {
      rowButton(td, '+1', P.gold < r.buy || cargoSpace() < 1, () => buyN(r, 1));
      rowButton(td, '+10', P.gold < r.buy * 10 || cargoSpace() < 10, () => buyN(r, 10));
    }
    const hold = P.cargo[r.name] ?? 0;
    if (hold > 0) {
      rowButton(td, '-1', false, () => sellN(r, 1));
      rowButton(td, 'all', false, () => sellN(r, hold));
    }
  });
}

definePanel('market', marketPanel, { building: true, render: renderMarket });

// ---------------------------------------------------------------------------
// Shipyard (buy one of the 22 ship types at the dry dock)
// ---------------------------------------------------------------------------
const shipyardPanel = document.getElementById('shipyard-panel');

function renderShipyard() {
  document.getElementById('shipyard-info').innerHTML =
    `gold: <b>${P.gold}g</b> &nbsp;·&nbsp; fleet: <b>${P.fleet.length}/5</b> ships`;
  const div = document.getElementById('shipyard-table');

  if (refitIdx !== null) { renderRefit(div); return; }

  // --- your fleet (instances; duplicates allowed) ---
  let html = `<h3 style="color:#ffd94d;margin:4px 0">Your fleet</h3>` +
    '<table><tr><th></th><th>ship</th><th>hull</th><th>guns</th><th>cargo</th><th>speed</th><th>mods</th><th></th></tr>';
  P.fleet.forEach((f, i) => {
    const s = shipStats(f);
    const m = f.mods ?? {};
    const modStr = ['guns', 'hull', 'cargo', 'speed'].filter(c => m[c]).map(c => `${c}+${m[c]}`).join(' ');
    html += `<tr><td><img class="ship-img" src="./assets/ships/${s.name.toLowerCase()}.png" alt=""></td>` +
      `<td>${s.name}</td><td class="num">${Math.ceil(f.hull)}/${s.hull}</td>` +
      `<td class="num">${s.guns}</td><td class="num">${s.cargo}</td><td class="num">${s.speed.toFixed(1)}</td>` +
      `<td class="num">${modStr || '—'}</td><td></td></tr>`;
  });
  html += `</table><h3 style="color:#ffd94d;margin:8px 0 4px">Buy ships</h3>` +
    '<table><tr><th></th><th>ship</th><th>speed</th><th>tack</th><th>cargo</th><th>hull</th><th>guns</th><th>crew</th><th>price</th><th></th></tr>';
  for (const s of SHIPS) {
    html += `<tr><td><img class="ship-img" src="./assets/ships/${s.name.toLowerCase()}.png" alt=""></td>` +
      `<td>${s.name}</td>` +
      `<td class="num">${s.speed.toFixed(1)}</td><td class="num">${s.tacking}</td><td class="num">${s.cargo}</td>` +
      `<td class="num">${s.hull}</td><td class="num">${s.guns}</td>` +
      `<td class="num">${s.minCrew}-${s.maxCrew}</td>` +
      `<td class="num">${s.price}</td><td></td></tr>`;
  }
  div.innerHTML = html + '</table>';

  // fleet instance buttons
  const fleetRows = div.querySelectorAll('table')[0].querySelectorAll('tr');
  P.fleet.forEach((f, i) => {
    const td = fleetRows[i + 1].lastChild;
    rowButton(td, i === 0 ? 'flagship' : 'make flagship', i === 0, () => {
      const [x] = P.fleet.splice(i, 1);
      P.fleet.unshift(x);
      save(); renderShipyard();
    });
    rowButton(td, 'refit', false, () => { refitIdx = i; renderShipyard(); });
    const capWithout = fleetCargoCap() - shipStats(f).cargo;
    rowButton(td, 'sell', P.fleet.length <= 1 || cargoUsed() > capWithout, () => {
      P.gold += Math.floor(shipByName(f.ship).price / 2);
      P.fleet.splice(i, 1);
      save(); renderShipyard();
    }, P.fleet.length <= 1 ? 'your last ship' : cargoUsed() > capWithout ? 'cargo would not fit' : `+${Math.floor(shipByName(f.ship).price / 2)}g`);
  });
  // buy buttons (duplicates allowed — fleet just needs room)
  const buyRows = div.querySelectorAll('table')[1].querySelectorAll('tr');
  SHIPS.forEach((s, i) => {
    rowButton(buyRows[i + 1].lastChild, 'buy',
      P.gold < s.price || P.fleet.length >= 5 || cargoUsed() > fleetCargoCap() + s.cargo,
      () => {
        P.gold -= s.price;
        P.fleet.push({ ship: s.name, hull: s.hull,
                       cabins: CABIN_DEFAULTS.slice(0, CABIN_COUNT(s.cargo)) });
        save(); renderShipyard();
      }, P.fleet.length >= 5 ? 'fleet is full (5 ships)' : '');
  });
}

// --- refit view for one fleet ship ---
let refitIdx = null;
function renderRefit(div) {
  const f = P.fleet[refitIdx];
  const base = shipByName(f.ship);
  const s = shipStats(f);
  f.mods = f.mods ?? { guns: 0, hull: 0, cargo: 0, speed: 0 };
  let html = `<h3 style="color:#ffd94d;margin:4px 0">Refit — ${f.ship}</h3>` +
    '<table><tr><th>stat</th><th>base</th><th>now</th><th>upgrade</th><th></th></tr>';
  const rows = [
    ['guns', 'guns', base.guns, s.guns],
    ['hull', 'hull (max)', base.hull, s.hull],
    ['cargo', 'cargo', base.cargo, s.cargo],
    ['speed', 'speed', base.speed.toFixed(1), s.speed.toFixed(1)],
  ];
  for (const [cat, label, bv, nv] of rows) {
    const lv = f.mods[cat];
    html += `<tr><td>${label}</td><td class="num">${bv}</td><td class="num"><b>${nv}</b></td>` +
      `<td class="num">${lv >= REFIT_MAX_LV ? 'max' : `lv ${lv} → ${lv + 1} (${refitCost(f, cat)}g)`}</td><td></td></tr>`;
  }
  div.innerHTML = html + '</table>';
  const trs = div.querySelectorAll('tr');
  rows.forEach(([cat], i) => {
    const lv = f.mods[cat];
    rowButton(trs[i + 1].lastChild, 'upgrade',
      lv >= REFIT_MAX_LV || P.gold < refitCost(f, cat),
      () => {
        P.gold -= refitCost(f, cat);
        f.mods[cat]++;
        if (cat === 'hull') f.hull += Math.round(shipByName(f.ship).hull * 0.2);   // reinforced hull also adds current hp
        save(); renderShipyard();
      });
  });
  // --- cabin refit (UW4): change this ship's cabin types ---
  const cabins = cabinsOf(refitIdx);
  let chtml = '<h3 style="color:#ffd94d;margin:8px 0 4px">Cabins</h3>' +
    '<table><tr><th>cabin</th><th>type</th><th></th></tr>';
  cabins.forEach((type, j) => {
    chtml += `<tr><td>#${j + 1}</td><td>${CABIN_TYPES[type].label} <small>(${CABIN_TYPES[type].desc})</small></td><td></td></tr>`;
  });
  div.innerHTML += chtml + '</table>';
  const ctrs = div.querySelectorAll('table')[1].querySelectorAll('tr');
  cabins.forEach((type, j) => {
    const td = ctrs[j + 1].lastChild;
    const sel = document.createElement('select');
    sel.innerHTML = Object.entries(CABIN_TYPES)
      .map(([k, t]) => `<option value="${k}"${k === type ? ' selected' : ''}>${t.label}</option>`).join('');
    sel.value = type;
    td.appendChild(sel);
    rowButton(td, `refit 500g`, P.gold < 500, () => {
      if (sel.value === type) return;
      // unassign any mate in that cabin when its type changes? keep them — UW4 keeps crew
      P.gold -= 500;
      cabins[j] = sel.value;
      save(); renderShipyard();
    });
  });

  // back row
  const back = document.createElement('button');
  back.textContent = '← back to shipyard';
  back.onclick = () => { refitIdx = null; renderShipyard(); };
  div.appendChild(back);
}

definePanel('shipyard', shipyardPanel, { building: true, render: renderShipyard,
  onClose: () => { refitIdx = null; } });

// ---------------------------------------------------------------------------
// Mates & cabins panel
// ---------------------------------------------------------------------------
const matesPanel = document.getElementById('mates-panel');
function renderMates() {
  document.getElementById('mates-info').innerHTML =
    `sailors: <b>${P.crew}</b>/${fleetMaxCrew()} &nbsp;·&nbsp; mates: <b>${P.mates.length}</b>`;

  // --- cabins by ship (UW4) ---
  const cab = document.getElementById('mates-cabins');
  cab.innerHTML = '';
  P.fleet.forEach((f, i) => {
    cabinsOf(i).forEach((type, j) => {
      const t = CABIN_TYPES[type];
      const mid = assignedMate(i, j);
      const m = mid != null ? matesData[mid] : null;
      const div = document.createElement('div');
      div.className = 'cabin';
      div.innerHTML = `<small>${i === 0 ? '★ ' : ''}${f.ship}</small><br><b>${t.label}</b><br>` +
        `${m ? `${m.name} <small>(${t.stat} ${m[t.stat]})</small>` : '—'}<br><small>${t.desc}</small>`;
      if (m) {
        const b = document.createElement('button');
        b.textContent = '×';
        b.title = 'unassign';
        b.onclick = () => { assignMate(+mid, null); renderMates(); };
        div.appendChild(b);
      }
      cab.appendChild(div);
    });
  });

  // --- mate cards with cabin assignment dropdown ---
  const div = document.getElementById('mates-table');
  div.innerHTML = '';
  if (!P.mates.length) {
    div.innerHTML = '<p>No mates yet — meet them in bars around the world.</p>';
    return;
  }
  const cabinOptions = exceptId => {
    const opts = ['<option value="">—</option>'];
    P.fleet.forEach((f, i) => {
      cabinsOf(i).forEach((type, j) => {
        const occ = assignedMate(i, j);
        if (occ != null && +occ !== exceptId) return;   // occupied by someone else
        const sel = mateCabin(exceptId) === cabinKey(i, j) ? ' selected' : '';
        opts.push(`<option value="${i}:${j}"${sel}>${f.ship} · ${CABIN_TYPES[type].label}</option>`);
      });
    });
    return opts.join('');
  };
  for (const id of P.mates) {
    const m = matesData[id];
    const card = document.createElement('div');
    card.className = 'mate-card';
    const sk = initMateSkills(id);
    const skStr = Object.entries(sk)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([s, l]) => `${SKILL_LABEL[s]} Lv${l}`).join(' · ');
    const a = mateAttrs(id);
    card.innerHTML = `<img src="${matePortraitUrl(m)}" alt="">` +
      `<div class="mate-stats"><b>${m.name}</b> · ${m.nation} · lv ${m.lv}<br>` +
      `<span style="color:#7fd4ff">${skStr}</span><br>` +
      `str ${a.str} · agi ${a.agi} · con ${a.con} · int ${a.int} · per ${a.per} · cha ${a.cha}</div>`;
    const sel = document.createElement('select');
    sel.innerHTML = cabinOptions(id);
    sel.value = mateCabin(id) ?? '';
    sel.onchange = () => { assignMate(id, sel.value || null); renderMates(); };
    sel.title = 'assign to a cabin';
    const dismiss = document.createElement('button');
    dismiss.textContent = '\u2715';
    dismiss.title = 'dismiss';
    dismiss.onclick = () => {
      assignMate(id, null);
      P.mates = P.mates.filter(x => x !== id);
      save(); renderMates();
    };
    const btns = document.createElement('div');
    btns.appendChild(sel);
    btns.appendChild(dismiss);
    card.appendChild(btns);
    div.appendChild(card);
  }
}

definePanel('mates', matesPanel, { building: true, render: renderMates });

// ---------------------------------------------------------------------------
// Outfit panel: sails / cannons / ram / figurehead / boarding / armor
// ---------------------------------------------------------------------------
const outfitPanel = document.getElementById('outfit-panel');
const OUTFIT_ITEMS = [
  { key: 'sails', tiers: [
    { name: 'Studding Sails', cost: 1500, desc: '+5% speed' },
    { name: 'Skysails', cost: 4000, desc: '+10% total' },
    { name: 'Moonrakers', cost: 9000, desc: '+15% total' } ] },
  { key: 'cannons', tiers: [
    { name: 'Cannon Pedrero', cost: 2000, desc: 'broadside x1.3' },
    { name: 'Demicannon', cost: 5000, desc: 'broadside x1.6' },
    { name: 'Demiculverin', cost: 12000, desc: 'broadside x2.0' } ] },
  { key: 'ram', name: 'Ram', cost: 2500, desc: 'contact deals 15 hull/s in battle' },
  { key: 'figurehead', name: 'Figurehead', cost: 4000, desc: 'fatigue -50%, loot +25%' },
  { key: 'boarding', name: 'Boarding Planks', cost: 3500, desc: '+25% melee power in boarding' },
  { key: 'armor', name: 'Armor Plating', cost: 5000, desc: 'damage taken -25%' },
];

function renderOutfit() {
  document.getElementById('outfit-info').innerHTML = `gold: <b>${P.gold}g</b>`;
  const div = document.getElementById('outfit-table');
  let html = '<table><tr><th>equipment</th><th>effect</th><th>price</th><th></th></tr>';
  const rows = [];
  for (const item of OUTFIT_ITEMS) {
    if (item.tiers) {
      item.tiers.forEach((t, i) => rows.push({
        name: t.name, desc: t.desc, cost: t.cost,
        owned: P.equipment[item.key] > i, locked: P.equipment[item.key] < i,
        buy() { P.equipment[item.key] = i + 1; },
      }));
    } else {
      rows.push({
        name: item.name, desc: item.desc, cost: item.cost,
        owned: !!P.equipment[item.key], locked: false,
        buy() { P.equipment[item.key] = true; },
      });
    }
  }
  for (const r of rows) {
    html += `<tr><td>${r.name}${r.owned ? ' ★' : ''}</td><td>${r.desc}</td>` +
      `<td class="num">${r.owned ? '—' : r.cost}</td><td></td></tr>`;
  }
  div.innerHTML = html + '</table>';
  const trs = div.querySelectorAll('tr');
  rows.forEach((r, i) => {
    rowButton(trs[i + 1].lastChild, r.owned ? 'owned' : 'buy',
              r.owned || r.locked || P.gold < r.cost,
              () => { P.gold -= r.cost; r.buy(); save(); renderOutfit(); },
              r.locked ? 'buy the previous tier first' : '');
  });
}

definePanel('outfit', outfitPanel, { building: true, render: renderOutfit });

// --- Sailors (tavern sub-panel): one-click resupply to min / max crew ---
const crewPanel = document.getElementById('crew-panel');
function renderCrew() {
  const minC = fleetMinCrew(), maxC = fleetMaxCrew();
  document.getElementById('crew-info').innerHTML =
    `crew: <b>${P.crew}</b> / ${maxC} &nbsp;·&nbsp; minimum: <b>${minC}</b> &nbsp;·&nbsp; 100g per sailor`;
  const div = document.getElementById('crew-actions');
  div.innerHTML = '';
  const hireTo = (target, label) => {
    const need = target - P.crew;
    mkBtn(div, `${label}${need > 0 ? ` (+${need})` : ''}`, () => {
      const k = Math.min(target - P.crew, Math.floor(P.gold / 100));
      if (k > 0) { P.gold -= k * 100; P.crew += k; save(); }
      renderCrew();
    }, need <= 0 || P.gold < 100);
  };
  hireTo(minC, 'Hire to minimum (必要水手)');
  hireTo(maxC, 'Hire to maximum (最大水手)');
  mkBtn(div, 'Dismiss to minimum (必要水手)', () => {
    const k = P.crew - minC;
    if (k > 0) { P.crew -= k; save(); }
    renderCrew();
  }, P.crew <= minC);
}
definePanel('crew', crewPanel, { building: true, render: renderCrew });

// --- Resupply (harbor sub-panel): fill water/food to the cargo limit with an adjustable ratio ---
const supplyPanel = document.getElementById('supply-panel');
function renderSupply() {
  const goodsQty = Object.values(P.cargo).reduce((a, b) => a + b, 0);
  const maxProv = Math.max(0, (fleetCargoCap() - goodsQty) * 10);   // hold limit - goods, in provisions
  const ratio = P.supplyRatio ?? 50;
  const targetWater = Math.floor(maxProv * ratio / 100);
  const targetFood = Math.floor(maxProv * (100 - ratio) / 100);
  const addWater = Math.max(0, targetWater - Math.floor(P.water));
  const addFood = Math.max(0, targetFood - Math.floor(P.food));
  const cost = addWater + addFood;
  document.getElementById('supply-info').innerHTML =
    `water: <b>${Math.floor(P.water)}</b> · food: <b>${Math.floor(P.food)}</b> &nbsp;·&nbsp; ` +
    `hold limit: <b>${maxProv}</b> &nbsp;·&nbsp; fill cost: <b>${cost}g</b>`;
  const rdiv = document.getElementById('supply-ratio');
  rdiv.innerHTML = `water:food ratio — <b>${ratio}% : ${100 - ratio}%</b> `;
  const mkR = (label, d) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = () => { P.supplyRatio = Math.max(0, Math.min(100, (P.supplyRatio ?? 50) + d)); renderSupply(); };
    rdiv.appendChild(b);
  };
  mkR('-10%', -10); mkR('-5%', -5); mkR('+5%', 5); mkR('+10%', 10);
  const adiv = document.getElementById('supply-actions');
  adiv.innerHTML = '';
  mkBtn(adiv, `Fill up (${targetWater} water, ${targetFood} food)`, () => {
    if (P.gold < cost) return;
    P.gold -= cost;
    P.water = targetWater;
    P.food = targetFood;
    save();
    renderSupply();
  }, cost <= 0 || P.gold < cost);
}
definePanel('supply', supplyPanel, { building: true, render: renderSupply });

// --- Chapter 1: Isabella's 3-year school phase (PM2-style) ---
const schoolPanel = document.getElementById('school-panel');
const SCHOOL_ACTIVITIES = [
  { key: 'study', label: '📖 Study (-50g)', cost: 50, stress: 10, attrs: { int: 1, per: 1 } },
  { key: 'work', label: '🧹 Work (+30g)', cost: -30, stress: 15, attrs: { str: 1, con: 1 } },
  { key: 'rest', label: '🌿 Rest (free)', cost: 0, stress: -20, attrs: { cha: 1 } },
  { key: 'train', label: '⚔️ Warrior training (-30g)', cost: 30, stress: 15, attrs: { str: 1, agi: 1 } },
];
function renderSchool() {
  const s = P.school;
  if (!s) { closePanel('school'); return; }
  const div = document.getElementById('school-body');
  const a = s.attrs;
  div.innerHTML =
    `<div class="school-main">` +
    `<div class="school-left">` +
    `<img class="school-portrait" src="./assets/waifu/isabella.png" alt="Isabella">` +
    `<div class="school-name">Isabella</div>` +
    `<div class="school-age">month <b>${s.month}</b> / 36</div>` +
    `<div class="school-money"><b>${s.money}</b> G</div>` +
    `</div>` +
    `<div class="school-mid"><h3>📅 Schedule this month</h3></div>` +
    `<div class="school-right">` +
    `<h3>Status</h3><div class="school-stat">stress: <b>${s.stress}</b></div>` +
    `<h3>Attributes</h3><div class="school-stat">str ${a.str} · agi ${a.agi} · con ${a.con}<br>int ${a.int} · per ${a.per} · cha ${a.cha}</div>` +
    `</div></div>` +
    `<div class="school-result" id="school-result">${s.lastResult ?? 'Choose an activity for this month.'}</div>`;
  const mid = div.querySelector('.school-mid');
  for (const act of SCHOOL_ACTIVITIES) {
    mkBtn(mid, act.label, () => schoolActivity(act), s.money < act.cost);
  }
  mkBtn(mid, '⏩ Skip school (graduate now)', () => schoolGraduate(true), false);
}
function schoolActivity(act) {
  const s = P.school;
  if (!s) return;
  s.money -= act.cost;
  s.stress = Math.max(0, s.stress + act.stress);
  let result;
  if (s.stress >= 100) {
    s.stress = Math.max(0, s.stress - 30);
    result = 'Isabella fell ill from overwork and had to rest. (no gain this month)';
  } else {
    for (const [k, v] of Object.entries(act.attrs)) s.attrs[k] += v;
    result = `${act.label.split(' ')[0]} — ${Object.entries(act.attrs).map(([k, v]) => `${k} +${v}`).join(', ')}`;
  }
  s.month++;
  s.lastResult = result;
  if (s.month >= 36) { schoolGraduate(false); return; }
  save();
  renderSchool();
}
function schoolGraduate(skip) {
  const s = P.school;
  if (!skip && s) HERO_ATTRS[6] = { ...s.attrs };   // set Isabella's initial attributes
  P.school = null;
  closePanel('school');
  showDialog(CHARACTER_NAMES[6],
    (skip ? 'You decide to skip the formal schooling and set out on your own.<br><br>' :
      'Three years have passed. You\'ve grown into a capable young woman, ready to make your own way in the world.<br><br>') +
    `<b>Final attributes:</b> str ${HERO_ATTRS[6].str} · agi ${HERO_ATTRS[6].agi} · con ${HERO_ATTRS[6].con} · ` +
    `int ${HERO_ATTRS[6].int} · per ${HERO_ATTRS[6].per} · cha ${HERO_ATTRS[6].cha}<br><br>` +
    '<i>(Chapter 1 complete — your journey begins!)</i>',
    DOS_PORTRAIT[6]);
  save();
}
definePanel('school', schoolPanel, { render: renderSchool });

// ---------------------------------------------------------------------------
// Captain's Log (I): fleet / crew / outfit / hero / cargo / discoveries / quests
// ---------------------------------------------------------------------------
const menuPanel = document.getElementById('menu-panel');
let menuTab = 'fleet';
const MENU_TABS = [['fleet', 'Fleet'], ['crew', 'Crew'], ['outfit', 'Outfit'],
                   ['party', 'Party'], ['hero', 'Hero'], ['cargo', 'Cargo'], ['discoveries', 'Discoveries'],
                   ['quests', 'Quests']];

const MENU_RENDER = {
  party() {
    // character selector: protagonist + mates. Click to select, view full stats.
    const sel = window._partySel;
    const btn = (key, label, imgUrl) =>
      `<button class="${sel === key ? 'active' : ''}" style="display:flex;align-items:center;gap:6px;width:100%;margin:2px 0;text-align:left" onclick="selectParty('${key}')">` +
      `<img src="${imgUrl}" style="width:32px;height:32px;object-fit:cover;border-radius:3px;image-rendering:pixelated;border:1px solid var(--bronze)">` +
      `<span>${label}</span></button>`;
    // 4 fame values on one line, boxed, labeled 名声
    const fameBox = (naval, trade, adventure, notoriety) =>
      `<div style="border:1px solid var(--bronze);border-radius:6px;padding:4px 10px;margin:4px 0">` +
      `<small style="color:var(--gold)">名声</small> naval: ${naval} · trade: ${trade} · adventure: ${adventure} · ` +
      `<span style="color:#f87171">notoriety: ${notoriety}</span></div>`;
    let html = '<div style="display:flex;gap:16px;text-align:left"><div style="min-width:180px">';
    html += btn('hero', CHARACTER_NAMES[P.character], DOS_PORTRAIT[P.character]);
    P.mates.forEach(id => { html += btn('mate' + id, matesData[id].name, matePortraitUrl(matesData[id])); });
    html += '</div><div style="flex:1">';
    if (sel === 'hero') {
      const a = HERO_ATTRS[P.character];
      html += `<p><b>${CHARACTER_NAMES[P.character]}</b> · ${HERO_NATION[P.character]}${fameTitle() ? ' · ' + fameTitle() : ''}</p>` +
        fameBox(P.navalFame, P.tradeFame, P.adventureFame, P.notoriety) +
        `<p>str ${a.str} · agi ${a.agi} · con ${a.con} · int ${a.int} · per ${a.per} · cha ${a.cha}</p>` +
        `<p style="white-space:nowrap">hp${hudBar(P.hero.hp / heroMaxHp(), '#5bff8c')} ${P.hero.hp}/${heroMaxHp()} · sp${hudBar(P.hero.sp / heroMaxSp(), '#5b8cff')} ${P.hero.sp}/${heroMaxSp()}</p>`;
    } else {
      const id = +sel.slice(4);
      const m = matesData[id];
      const a = mateAttrs(id);
      const f = P.mateFame[id] ?? { naval: 0, trade: 0, adventure: 0, notoriety: 0 };
      const hp = mateHpOf(id), maxHp = mateMaxHp(id);
      const sp = P.mateSp[id] ?? mateMaxSp(id), maxSp = mateMaxSp(id);
      html += `<p><b>${m.name}</b> · ${m.nation} · lv ${m.lv}</p>` +
        fameBox(f.naval, f.trade, f.adventure, f.notoriety ?? 0) +
        `<p>str ${a.str} · agi ${a.agi} · con ${a.con} · int ${a.int} · per ${a.per} · cha ${a.cha}</p>` +
        `<p style="white-space:nowrap">hp${hudBar(hp / maxHp, '#5bff8c')} ${hp}/${maxHp} · sp${hudBar(sp / maxSp, '#5b8cff')} ${sp}/${maxSp}</p>`;
    }
    return html + '</div></div>';
  },
  fleet() {
    let html = '<table><tr><th></th><th>ship</th><th>hull</th><th>cargo</th><th>guns</th><th>crew</th><th>role</th></tr>';
    P.fleet.forEach((f, i) => {
      const s = shipByName(f.ship);
      html += `<tr><td><img class="ship-img" src="./assets/ships/${s.name.toLowerCase()}.png" alt=""></td>` +
        `<td>${s.name}</td><td class="num">${Math.ceil(f.hull)}/${s.hull}</td>` +
        `<td class="num">${s.cargo}</td><td class="num">${s.guns}</td>` +
        `<td class="num">${s.minCrew}-${s.maxCrew}</td><td>${i === 0 ? 'flagship ★' : ''}</td></tr>`;
    });
    return html + `</table><p>total cargo: ${fleetCargoCap()} · total guns: ${fleetGuns()} · ` +
           `sailors: ${P.crew}/${fleetMaxCrew()} (min ${fleetMinCrew()}) · fleet: ${P.fleet.length}/5</p>`;
  },
  crew() {
    let html = `<p>sailors: <b>${P.crew}</b>/${fleetMaxCrew()} (minimum ${fleetMinCrew()})</p><p>` +
      P.fleet.map((f, i) => cabinsOf(i).map((type, j) => {
        const mid = assignedMate(i, j);
        return `${i === 0 ? '★' : ''}${f.ship}/${CABIN_TYPES[type].label}: <b>${mid != null ? matesData[mid].name : '—'}</b>`;
      }).join(' · ')).join('<br>') + '</p>';
    if (!P.mates.length) return html + '<p>No mates yet — meet them in bars.</p>';
    for (const id of P.mates) {
      const m = matesData[id];
      const a = mateAttrs(id);
      html += `<div class="mate-card"><img src="${matePortraitUrl(m)}" alt="">` +
        `<div class="mate-stats"><b>${m.name}</b> · ${m.nation} · lv ${m.lv}<br>` +
        `str ${a.str} · agi ${a.agi} · con ${a.con} · int ${a.int} · per ${a.per} · cha ${a.cha}</div></div>`;
    }
    return html;
  },
  outfit() {
    let rows = '';
    for (const item of OUTFIT_ITEMS) {
      if (item.tiers) {
        item.tiers.forEach((t, i) => {
          if (P.equipment[item.key] > i) rows += `<tr><td>${t.name}</td><td>${t.desc}</td></tr>`;
        });
      } else if (P.equipment[item.key]) {
        rows += `<tr><td>${item.name}</td><td>${item.desc}</td></tr>`;
      }
    }
    return rows ? `<table><tr><th>equipment</th><th>effect</th></tr>${rows}</table>`
                : '<p>No equipment yet — visit a dry dock to outfit your ship.</p>';
  },
  hero() {
    const a = HERO_ATTRS[P.character];
    const fameBox = (naval, trade, adventure, notoriety) =>
      `<div style="border:1px solid var(--bronze);border-radius:6px;padding:4px 10px;margin:4px 0">` +
      `<small style="color:var(--gold)">名声</small> naval: ${naval} · trade: ${trade} · adventure: ${adventure} · ` +
      `<span style="color:#f87171">notoriety: ${notoriety}</span></div>`;
    return `<p><b>${CHARACTER_NAMES[P.character]}</b> · ${HERO_NATION[P.character]}${fameTitle() ? ' · ' + fameTitle() : ''}</p>` +
      fameBox(P.navalFame, P.tradeFame, P.adventureFame, P.notoriety) +
      `<p>str ${a.str} · agi ${a.agi} · con ${a.con} · int ${a.int} · per ${a.per} · cha ${a.cha}</p>` +
      `<p style="white-space:nowrap">hp${hudBar(P.hero.hp / heroMaxHp(), '#5bff8c')} ${P.hero.hp}/${heroMaxHp()} · sp${hudBar(P.hero.sp / heroMaxSp(), '#5b8cff')} ${P.hero.sp}/${heroMaxSp()}</p>` +
      `<p>gold: ${P.gold}g · bank: ${P.bank}g · days: ${P.days} · water: ${Math.floor(P.water)} · food: ${Math.floor(P.food)} · vigor: ${100 - Math.floor(P.fatigue)}</p>` +
      `<h3 style="color:#ffd94d;margin:8px 0 2px">hero</h3>` +
      `<p>lv ${P.hero.lv} · atk ${heroAtk()} · def ${heroDef()} · weapon t${P.hero.weapon} · armor t${P.hero.armor} · balms ${P.hero.balms}</p>` +
      `<h3 style="color:#ffd94d;margin:8px 0 2px">personal items</h3>` +
      `<p>${P.telescope ? '★ Telescope — discovery sight x2' : 'no special items yet (try the item shop)'}</p>`;
  },
  cargo() {
    const names = Object.keys(P.cargo);
    if (!names.length) return '<p>Cargo hold is empty — buy goods at a market.</p>';
    let html = `<p>space: ${cargoUsed()}/${fleetCargoCap()}</p>` +
      '<table><tr><th>goods</th><th>qty</th><th>avg cost</th></tr>';
    for (const n of names) {
      html += `<tr><td><img class="good-icon" src="${goodIcon(n)}" alt="">${n}</td>` +
        `<td class="num">${P.cargo[n]}</td><td class="num">${avgBuy(n).toFixed(0)}</td></tr>`;
    }
    return html + '</table>';
  },
  discoveries() {
    const SUBJECT_LABEL = { archaeology: '考古', geography: '地理', treasure: '财宝',
                            religion: '宗教', biology: '生物', art: '艺术' };
    const found = villages.filter(v => discoveriesFound.has(v.id));
    let html = `<p>${found.length} / ${villages.length} discovered</p>`;
    if (!found.length) return html + '<p>Nothing yet — go ashore where things seem interesting.</p>';
    // group discoveries by subject (6 disciplines)
    const groups = {};
    for (const v of found) (groups[v.subject] = groups[v.subject] ?? []).push(v);
    for (const [subj, label] of Object.entries(SUBJECT_LABEL)) {
      const list = groups[subj];
      if (!list) continue;
      html += `<h3 style="color:#ffd94d;margin:8px 0 2px">${label} (${list.length})</h3>`;
      for (const v of list) {
        html += `<div class="mate-card"><canvas class="disc-thumb" data-img="${v.img[0]},${v.img[1]}" ` +
          `width="49" height="49" style="image-rendering:pixelated;border:1px solid #8a6d3b;border-radius:3px"></canvas>` +
          `<div class="mate-stats"><b>${v.name}</b> · ${fmtLonLat(v.x, v.y)}<br>${v.desc.slice(0, 90)}…</div></div>`;
      }
    }
    return html;
  },
  quests() {
    let html = '';
    // Isabella prologue progress (Faro -> Lisbon)
    if (P.character === 6 && P.prologue && P.prologue.step < 5) {
      const PROLOGUE_STEPS = [
        'Lay flowers at your mother\'s grave (cemetery)',
        'Say goodbye to your teacher',
        'Go home and sleep',
        'Board the merchant ship to Lisbon (harbor)',
        'Greet your father, the Duke (MSC in Lisbon)',
      ];
      html += `<div class="story-box"><h3>⚑ Prologue — Faro</h3>`;
      PROLOGUE_STEPS.forEach((name, i) => {
        if (i < P.prologue.step) html += `<p class="story-done">✓ ${name}</p>`;
        else if (i === P.prologue.step) html += `<p class="story-current">▶ ${name}</p>`;
        else html += `<p class="story-future">· ${name}</p>`;
      });
      html += `</div><hr style="border-color:#2a3444">`;
    }
    // main storyline progress (per hero)
    const s = STORYLINES[P.character];
    if (s) {
      html += `<div class="story-box"><h3>⚑ ${s.title}</h3>`;
      s.steps.forEach((st, i) => {
        if (i < P.story.step) html += `<p class="story-done">✓ ${st.name}</p>`;
        else if (i === P.story.step)
          html += `<p class="story-current">▶ ${st.name} — ${st.goal} <span class="story-prog">(${st.progress()})</span></p>`;
        else html += `<p class="story-future">· ${st.name}</p>`;
      });
      if (P.story.step >= s.steps.length) html += `<p class="story-done"><b>— Storyline complete! —</b></p>`;
      html += `</div><hr style="border-color:#2a3444">`;
    }
    if (P.discoveryQuest) {
      const v = villages.find(x => x.id === P.discoveryQuest);
      html += `<p><b>Research quest (MSC)</b>: find <b>${v.name}</b> at ${fmtLonLat(v.x, v.y)}, ` +
              `then report to any MSC. Reward: 600g</p>`;
    }
    if (P.jobQuest?.type === 'delivery') {
      const t = ports.find(p => p.id === P.jobQuest.port);
      html += `<p><b>Delivery (job house)</b>: letter to <b>${t.name}</b> ` +
              `(${fmtLonLat(t.x, t.y)}). Reward: ${P.jobQuest.reward}g</p>`;
    } else if (P.jobQuest?.type === 'cargo') {
      const q = P.jobQuest;
      html += `<p><b>Cargo request (job house)</b>: bring <b>${q.qty} ${q.good}</b> ` +
              `(have ${P.cargo[q.good] ?? 0}). Reward: ${q.reward}g</p>`;
    } else if (P.jobQuest?.type === 'treasure') {
      const q = P.jobQuest;
      html += `<p><b>Treasure hunt (job house)</b>: dig at <b>${fmtLonLat(q.x, q.z)}</b>` +
              `${q.guarded ? ' (guarded!)' : ''}. Est. ${q.gold}g</p>`;
    } else if (P.jobQuest?.type === 'bounty') {
      const q = P.jobQuest;
      html += `<p><b>Bounty (job house)</b>: ${q.done ? 'COLLECT READY — ' : ''}sink <b>${q.name}</b> ` +
              `(${q.ship}) near ${fmtLonLat(q.x, q.z)}. Reward: ${q.reward}g</p>`;
    }
    if (!html) html = '<p>No active quests — visit an MSC or a job house.</p>';
    html += `<hr style="border-color:#2a3444">` +
      `<p><b>Royal favor</b>: ${discoveriesFound.size}/${P.palaceMilestone + 5} discoveries to next audience</p>` +
      `<p><b>Ports</b>: ${discovered.size} / ${ports.length} discovered · ` +
      `<b>Discoveries</b>: ${discoveriesFound.size} / ${villages.length}</p>`;
    return html;
  },
};

// draw 49px discovery-sheet thumbnails into every .disc-thumb canvas under `root`
function drawDiscThumbs(root) {
  root.querySelectorAll('.disc-thumb').forEach(cv => {
    const [ix, iy] = cv.dataset.img.split(',').map(Number);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(discoveryImg, (ix - 1) * 49, (iy - 1) * 49, 49, 49, 0, 0, 49, 49);
  });
}

function renderMenu() {
  const tabs = document.getElementById('menu-tabs');
  mkTabs(tabs, MENU_TABS, menuTab, id => { menuTab = id; renderMenu(); });
  const div = document.getElementById('menu-content');
  div.innerHTML = MENU_RENDER[menuTab]();
  // draw discovery thumbnails (49px cells from the discoveries sheet)
  drawDiscThumbs(div);
}
// party tab: select a character (hero or mate) to view (global so onclick can reach it)
window._partySel = window._partySel ?? 'hero';
window.selectParty = key => { window._partySel = key; renderMenu(); };

definePanel('menu', menuPanel, { render: renderMenu });
const toggleMenu = () => PANELS.menu.open ? closePanel('menu') : openPanel('menu');

// ---------------------------------------------------------------------------
// Naval battles: pirates hunt at sea; SPACE fires a broadside
// ---------------------------------------------------------------------------
const battleHud = document.getElementById('battle-hud');
const PIRATE_SHIPS = ['Brigantine', 'Nao', 'Galleon', 'Carrack'];
let pirates = [];             // overworld NPC ships hunting the player
let battle = null;            // {enemy, balls, cd}
let pirateTimer = 30;         // seconds until next spawn check
const pirateInterval = () =>
  P.pirateRate === 0 ? Infinity : (P.pirateRate ?? 25);
let noAutoSpawn = false;      // test hook: disable random pirate spawns

const ballGeo = new THREE.PlaneGeometry(0.5, 0.5);
const ballMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });

function makeShipMesh(row) {
  const mesh = makeSprite(shipTex, 1 / 8, 1 / 4);
  mesh.material.map.offset.set(0, (3 - row) / 4);
  return mesh;
}

// animate a small merchant ship sailing from one port to another (camera follows)
function merchantShipAnimation(fromPort, toPort, onDone) {
  scene = 'sea';   // show the world map
  const mesh = makeShipMesh(0);   // a small ship
  mesh.position.set(fromPort.x, 0.4, fromPort.y);
  seaScene.add(mesh);
  const start = performance.now();
  const duration = 3000;
  (function animate() {
    const t = Math.min(1, (performance.now() - start) / duration);
    mesh.position.x = fromPort.x + (toPort.x - fromPort.x) * t;
    mesh.position.z = fromPort.y + (toPort.y - fromPort.y) * t;
    shipPos.set(mesh.position.x, 0, mesh.position.z);   // camera follows the ship
    if (t < 1) requestAnimationFrame(animate);
    else { seaScene.remove(mesh); onDone(); }
  })();
}

function spawnPirate(x, z, name, bountyName = null) {
  const ship = shipByName(name ?? PIRATE_SHIPS[Math.floor(Math.random() * PIRATE_SHIPS.length)]);
  const mesh = makeShipMesh(ship.row);
  seaScene.add(mesh);
  const p = { mesh, pos: new THREE.Vector3(x, 0.4, z), dir: 'down', ship,
              hull: ship.hull,
              crew: ship.minCrew + Math.floor(Math.random() * ship.minCrew),
              cooldown: 2, boardCd: 8, fleeing: false, frame: 0, animT: 0 };
  p.bountyName = bountyName;
  mesh.position.copy(p.pos);
  pirates.push(p);
  return p;
}

function removePirate(p) {
  seaScene.remove(p.mesh);
  const i = pirates.indexOf(p);
  if (i >= 0) pirates.splice(i, 1);
}

function startBattle(p) {
  if (battle) return;
  battle = { enemy: p, balls: [], cd: 0 };
  showBanner(`Pirates — ${p.ship.name}!<small>SPACE to fire · sink them or outrun them (25 tiles)</small>`);
  playSfx('./assets/sounds/engage.ogg');
}

function endBattle() {
  if (battle) {
    for (const b of battle.balls) seaScene.remove(b.mesh);
  }
  battle = null;
}

function fireBall(fromPos, targetPos, dmg, fromPlayer) {
  const dir = new THREE.Vector3(targetPos.x - fromPos.x, 0, targetPos.z - fromPos.z).normalize();
  const mesh = new THREE.Mesh(ballGeo, ballMat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(fromPos.x, 0.5, fromPos.z);
  seaScene.add(mesh);
  battle.balls.push({ mesh, dir, dmg, fromPlayer, life: 1.5 });
  playSfx('./assets/sounds/shoot.ogg');
}

// best swordplay among assigned cabin mates drives melee power
const meleeFactor = () => {
  let sw = 0;
  for (const id of Object.keys(P.shipCabins)) sw = Math.max(sw, mateSkill(+id, 'swordplay'));
  return 1 + sw * 0.04 + bestInCabins('captain', 'leadership') * 0.01;
};

function canBoard() {
  return battle && shipPos.distanceTo(battle.enemy.pos) < 2.5 && !(battle.boardLock > 0);
}

function captureEnemy() {
  const e = battle.enemy;
  markBountyDone(e);
  playSfx('./assets/sounds/explosion.ogg');
  if (P.fleet.length < 5) {
    P.fleet.push({ ship: e.ship.name, hull: Math.floor(e.ship.hull * 0.5) });
    gainFame('navalFame', 5);
    save();
    showBanner(`${e.ship.name} captured!<small>she joins your fleet · fame +5</small>`);
  } else {
    const loot = Math.floor((300 + e.ship.price / 10) * (P.equipment.figurehead ? 1.25 : 1));
    P.gold += loot;
    gainFame('navalFame', 5);
    save();
    showBanner(`${e.ship.name} captured!<small>sold for ${loot}g · fame +5</small>`);
  }
  removePirate(e);
  endBattle();
}

// crew-vs-crew melee; initiated by the player (B) or by a much stronger enemy
function boardingMelee(byPlayer) {
  const e = battle.enemy;
  const pFactor = meleeFactor() * (P.equipment.boarding ? 1.25 : 1);
  let rounds = 0;
  let pStart = P.crew, eStart = e.crew;
  while (P.crew > 0 && e.crew > 0 && rounds < 8) {
    rounds++;
    e.crew = Math.max(0, e.crew - Math.max(1, Math.round(P.crew * 0.2 * pFactor * (0.8 + Math.random() * 0.4))));
    if (e.crew <= 0) break;
    P.crew = Math.max(0, P.crew - Math.max(1, Math.round(e.crew * 0.2 * (0.8 + Math.random() * 0.4))));
  }
  for (const id of Object.keys(P.shipCabins)) {
    gainSkillXp(+id, 'swordplay', 5);
    gainSkillXp(+id, 'leadership', 2);
  }
  save();
  if (e.crew <= 0) {
    showBanner(`Boarding victory!<small>their crew is finished (${eStart} → 0); you lost ${pStart - P.crew} sailors</small>`);
    captureEnemy();
  } else if (P.crew <= 0) {
    gameOver('massacre');
  } else {
    // stalemate: both sides disengage and cannot re-board for a while
    battle.boardLock = 6;
    showBanner(`Melee stalemate<small>you lost ${pStart - P.crew} sailors, they lost ${eStart - e.crew}</small>`);
  }
}

function tryBoard() {
  if (!canBoard() || scene !== 'sea') return;
  playSfx('./assets/sounds/engage.ogg');
  boardingMelee(true);
}

function fireCannon() {
  if (!battle || battle.cd > 0 || !started || scene !== 'sea') return;
  xpInCabins('gunnery', 'gunnery', 2);
  if (shipPos.distanceTo(battle.enemy.pos) > 10) return;
  battle.cd = 2;
  fireBall(shipPos, battle.enemy.pos, battleDmg(), true);
}

function digTreasure(q) {
  q.done = true;
  P.treasuresDug++;
  P.gold += q.gold;
  gainFame('adventureFame', 3);
  let extra = '';
  if (Math.random() < 0.5 && cargoSpace() >= 5) {
    const names = Object.keys(goodsData.regions['Iberia']?.prices ?? {});
    const good = names[Math.floor(Math.random() * names.length)];
    P.cargo[good] = (P.cargo[good] ?? 0) + 5;
    extra = ` and 5 ${good}`;
  }
  save();
  playSfx('./assets/sounds/discover.ogg');
  showBanner(`Treasure found!<small>${q.gold}g${extra} · fame +3</small>`);
  P.jobQuest = null;
}

function markBountyDone(p) {
  const q = P.jobQuest;
  if (q?.type === 'bounty' && p.bountyName === q.name) {
    q.done = true;
    showBanner(`${q.name} eliminated!<small>return to any job house to collect the bounty</small>`);
  }
}

function sinkEnemy() {
  const p = battle.enemy;
  P.shipsSunk++;
  xpInCabins('captain', 'leadership', 5);
  markBountyDone(p);
  removePirate(p);
  const loot = Math.floor((150 + Math.random() * 400 + p.ship.price / 100) * (P.equipment.figurehead ? 1.25 : 1));
  P.gold += loot;
  gainFame('navalFame', 3);
  save();
  playSfx('./assets/sounds/explosion.ogg');
  showBanner(`Enemy ship sunk!<small>loot: ${loot}g · fame +3</small>`);
  endBattle();
}

// find a sailable tile near (bx, by); returns [x, z]
function sailableNear(bx, by) {
  for (let r = 2; r < 12; r++) {
    for (const [ox, oz] of [[-r, 0], [r, 0], [0, -r], [0, r], [-r, -r], [-r, r], [r, -r], [r, r]]) {
      if (sailableAt(bx + ox, by + oz)) return [bx + ox, by + oz];
    }
  }
  return [bx, by];
}

function gameOver(reason) {
  endBattle();
  ruin = null; landBattle = null;
  const texts = {
    exhaustion: 'With no water or rations, exhaustion swept the fleet. Every last sailor perished at sea — and your voyage ends here, adrift on an empty ocean.',
    massacre:   'Your crew was wiped out to the last sailor. With no hands left at the oars, your voyage ends here.',
  };
  document.getElementById('gameover-text').textContent = texts[reason] ?? reason;
  document.getElementById('gameover-overlay').style.display = 'flex';
  gameover = true;
  save();
}

function shipwreck(reason = 'battle') {
  P.gold = Math.floor(P.gold / 2);
  P.cargo = {};
  P.cargoCost = {};
  flag().hull = Math.floor(flagStats().hull * 0.3);
  P.crew = Math.max(P.crew, fleetMinCrew());
  // limp to the nearest discovered port
  const ids = discovered.size ? [...discovered] : [1];
  let best = ports[0], bd = 1e9;
  for (const pid of ids) {
    const p = ports.find(x => x.id === pid);
    if (!p) continue;
    const d = Math.hypot(p.x - shipPos.x, p.y - shipPos.z);
    if (d < bd) { bd = d; best = p; }
  }
  const [sx, sz] = sailableNear(best.x, best.y);
  shipPos.set(sx, 0.4, sz);
  showBanner(reason === 'massacre'
    ? `Your crew was wiped out!<small>half your gold and all cargo lost — you limped to ${best.name}</small>`
    : `Shipwreck!<small>half your gold and all cargo lost — you limped to ${best.name}</small>`);
  save();
  endBattle();
}

function updatePirates(dt) {
  // spawn new pirates over time
  pirateTimer -= dt;
  if (pirateTimer <= 0 && !noAutoSpawn) {
    pirateTimer = pirateInterval() * (0.8 + Math.random() * 0.4);
    if (pirates.length < 2 && Math.random() < 0.6) {
      for (let tries = 0; tries < 12; tries++) {
        const ang = Math.random() * Math.PI * 2;
        const d = 12 + Math.random() * 6;
        const x = shipPos.x + Math.cos(ang) * d, z = shipPos.z + Math.sin(ang) * d;
        if (sailableAt(x, z)) { spawnPirate(x, z); break; }
      }
    }
  }

  for (let i = pirates.length - 1; i >= 0; i--) {
    const p = pirates[i];
    const dx = shipPos.x - p.pos.x, dz = shipPos.z - p.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    let mvx = 0, mvz = 0;

    if (battle && battle.enemy === p) {
      // combat AI: flee when badly damaged, else close in and circle
      if (p.hull < p.ship.hull * 0.25) p.fleeing = true;
      if (p.fleeing) { mvx = -dx / dist; mvz = -dz / dist; }
      else if (dist > 5) { mvx = dx / dist; mvz = dz / dist; }
      else { mvx = -dz / dist * 0.6; mvz = dx / dist * 0.6; }
      // ram equipment: grinding contact tears the enemy hull
      if (P.equipment.ram && dist < 1.5 && battle) {
        p.hull -= 15 * dt;
        if (p.hull <= 0) { sinkEnemy(); continue; }
      }
      p.cooldown -= dt;
      if (p.cooldown <= 0 && dist < 10 && !p.fleeing) {
        p.cooldown = 2.5;
        fireBall(p.pos, shipPos, p.ship.guns / 4, false);
      }
      // aggressive crews grapple and board when they outnumber you
      if (battle) battle.boardLock = Math.max(0, (battle.boardLock ?? 0) - dt);
      p.boardCd -= dt;
      if (battle && !p.fleeing && dist < 2.5 && (battle.boardLock ?? 0) <= 0 &&
          p.boardCd <= 0 && p.crew > P.crew * 1.5) {
        p.boardCd = 10;
        showBanner('The enemy grapples and boards you!<small>deck fight!</small>');
        boardingMelee(false);
        if (!battle) continue;
      }
      if (p.fleeing && dist > 30) {
        showBanner('The pirates fled!');
        removePirate(p);
        endBattle();
        continue;
      }
      // player outran them
      if (dist > 25) {
        showBanner('You outran the pirates!');
        removePirate(p);
        endBattle();
        continue;
      }
    } else if (!battle && dist < 20) {
      mvx = dx / dist; mvz = dz / dist;
      if (dist < 3) startBattle(p);
    } else if (dist > 60) {
      removePirate(p);
      continue;
    }

    if (mvx || mvz) {
      const sp = 5 * dt;
      const nx = p.pos.x + mvx * sp, nz = p.pos.z + mvz * sp;
      if (sailableAt(nx, nz)) { p.pos.x = nx; p.pos.z = nz; }
      p.dir = mvz < -0.3 ? (mvx < -0.3 ? 'nw' : mvx > 0.3 ? 'ne' : 'up')
            : mvz > 0.3 ? (mvx < -0.3 ? 'sw' : mvx > 0.3 ? 'se' : 'down')
            : mvx < 0 ? 'left' : 'right';
      p.animT += dt;
      if (p.animT > 0.35) { p.animT = 0; p.frame ^= 1; }
    }
    p.mesh.position.copy(p.pos);
    shipFrame(p.mesh.material.map, p.dir, p.frame, p.ship.row);
  }
}

function updateBattle(dt) {
  if (!battle) { battleHud.style.display = 'none'; return; }
  battleHud.style.display = 'block';
  battle.cd -= dt;
  const e = battle.enemy;
  document.getElementById('battle-my-label').textContent =
    `${curShip().name} — hull ${Math.ceil(flag().hull)}/${flagStats().hull} · crew ${P.crew}`;
  document.getElementById('battle-my-bar').style.width = `${flag().hull / flagStats().hull * 100}%`;
  document.getElementById('battle-enemy-label').textContent =
    `${e.ship.name} — hull ${Math.ceil(e.hull)}/${e.ship.hull} · crew ${e.crew}`;
  document.getElementById('battle-enemy-bar').style.width = `${Math.max(0, e.hull) / e.ship.hull * 100}%`;

  for (let i = battle.balls.length - 1; i >= 0; i--) {
    const b = battle.balls[i];
    b.life -= dt;
    const target = b.fromPlayer ? e.pos : shipPos;
    // homing: steer the ball toward the target's current position
    b.dir.set(target.x - b.mesh.position.x, 0, target.z - b.mesh.position.z).normalize();
    b.mesh.position.addScaledVector(b.dir, 18 * dt);
    const d = Math.hypot(target.x - b.mesh.position.x, target.z - b.mesh.position.z);
    let remove = b.life <= 0;
    if (d < 1.2 && battle) {
      remove = true;
      playSfx('./assets/sounds/explosion.ogg');
      if (b.fromPlayer) {
        e.hull -= b.dmg;
        e.crew = Math.max(0, e.crew - Math.max(1, Math.round(b.dmg * 0.3)));
        if (e.hull <= 0) sinkEnemy();
        else if (e.crew <= 0) captureEnemy();
      } else {
        flag().hull = Math.max(0, flag().hull - b.dmg * (P.equipment.armor ? 0.75 : 1));
        // crew casualties are gentler on the player (else 2 volleys wipe a small crew)
        P.crew = Math.max(0, P.crew - Math.max(1, Math.round(b.dmg * (P.equipment.armor ? 0.75 : 1) * 0.1)));
        if (flag().hull <= 0) shipwreck('battle');
        else if (P.crew <= 0) gameOver('massacre');
      }
    }
    if (remove) {
      seaScene.remove(b.mesh);
      if (battle) battle.balls.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Villages / discoveries
// ---------------------------------------------------------------------------
const discoveryPanel = document.getElementById('discovery-panel');
const discoveryImg = new Image();
discoveryImg.src = './assets/discoveries.png';

function nearestVillage() {
  let best = null, bestD = (P.telescope ? 8 : 4) + lookoutRange();
  for (const v of villages) {
    const d = Math.hypot(v.x - shipPos.x, v.y - shipPos.z);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

function goAshore(v) {
  discoveriesFound.add(v.id);
  xpInCabins('lookout', 'lookout', 10);
  gainFame('adventureFame', 1);
  save();
  playSfx('./assets/sounds/discover.ogg');
  document.getElementById('discovery-name').textContent = v.name;
  document.getElementById('discovery-text').textContent = v.desc;
  // crop 49px cell from the discoveries sheet (16 cols x 8 rows)
  const cv = document.getElementById('discovery-img');
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(discoveryImg, (v.img[0] - 1) * 49, (v.img[1] - 1) * 49, 49, 49,
              0, 0, cv.width, cv.height);
  discoveryPanel.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Minimap (2D canvas overlay)
// ---------------------------------------------------------------------------
const mm = document.getElementById('minimap');
const mmCtx = mm.getContext('2d');
const mmBase = document.createElement('canvas');

function buildWorldMinimap() {
  mmBase.width = mm.width; mmBase.height = mm.height;
  const g = mmBase.getContext('2d');
  const img = g.createImageData(mm.width, mm.height);
  for (let y = 0; y < mm.height; y++) {
    for (let x = 0; x < mm.width; x++) {
      const t = tileAt(Math.floor(x / mm.width * COLS), Math.floor(y / mm.height * ROWS));
      const i = (y * mm.width + x) * 4;
      const sea = SAILABLE.has(t);
      img.data[i]     = sea ? 25 : 96;
      img.data[i + 1] = sea ? 55 : 132;
      img.data[i + 2] = sea ? 128 : 70;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // ports in gold, towns in blue, ruins in purple
  const plot = (list, color, getZ = it => it.z) => {
    g.fillStyle = color;
    for (const it of list) g.fillRect(it.x / COLS * mm.width - 1, getZ(it) / ROWS * mm.height - 1, 2, 2);
  };
  plot(ports, '#ffd94d', p => p.y);
  plot(towns, '#60a5fa');
  plot(ruins, '#c084fc');
}
buildWorldMinimap();

// double-click the minimap to enlarge / shrink it
mm.addEventListener('dblclick', () => {
  const big = mm.dataset.big === '1';
  mm.dataset.big = big ? '0' : '1';
  mm.width = big ? 240 : 720;
  mm.height = big ? 120 : 360;
  buildWorldMinimap();
});

const mmPort = document.createElement('canvas');
mmPort.width = mmPort.height = PORT_SIZE;
function buildPortMinimap() {
  const g = mmPort.getContext('2d');
  const img = g.createImageData(PORT_SIZE, PORT_SIZE);
  for (let r = 0; r < PORT_SIZE; r++) {
    for (let c = 0; c < PORT_SIZE; c++) {
      const walk = portTileAt(c, r) <= portWalkMax;
      const i = (r * PORT_SIZE + c) * 4;
      img.data[i]     = walk ? 150 : 40;
      img.data[i + 1] = walk ? 120 : 70;
      img.data[i + 2] = walk ? 80 : 120;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#ffd94d';
  for (const b of portBuildings) g.fillRect(b.x - 1, b.y - 1, 3, 3);
}

function drawMinimap() {
  mmCtx.imageSmoothingEnabled = false;
  if (scene !== 'port') {
    mmCtx.drawImage(mmBase, 0, 0);
    const dotPos = scene === 'land' ? landPos : shipPos;
    mmCtx.fillStyle = '#ff4444';
    mmCtx.beginPath();
    mmCtx.arc(dotPos.x / COLS * mm.width, dotPos.z / ROWS * mm.height, 2.5, 0, 7);
    mmCtx.fill();
    // pirates show as dark red dots
    mmCtx.fillStyle = '#b91c1c';
    for (const p of pirates) {
      mmCtx.fillRect(p.pos.x / COLS * mm.width - 1.5, p.pos.z / ROWS * mm.height - 1.5, 3, 3);
    }

  } else {
    mmCtx.clearRect(0, 0, mm.width, mm.height);
    mmCtx.drawImage(mmPort, 0, 0, mm.width, mm.height);   // stretch to fit — show the whole port
    mmCtx.fillStyle = '#ff4444';
    mmCtx.beginPath();
    mmCtx.arc(personPos.x / PORT_SIZE * mm.width, personPos.z / PORT_SIZE * mm.height, 3, 0, 7);
    mmCtx.fill();
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
addEventListener('keydown', e => {
  if (gameover) return;             // voyage is over — only the overlay matters
  // typing in dev panel inputs: let Esc/` through (they close panels),
  // swallow only printable characters so they don't trigger hotkeys
  if (e.target.tagName === 'INPUT' && e.key.length === 1 && e.key !== '`') return;
  const k = e.key.toLowerCase();
  if (keys[k]) return;              // ignore auto-repeat for one-shot keys
  keys[k] = true;
  if (k === 'm') toggleMusic();
  if (k === '`') toggleDev();
  if (k === 'e') onUseKey();
  if (k === 'g') onAshoreKey();
  if (k === ' ') fireCannon();
  if (k === 'b') tryBoard();
  if (k === 'i') toggleMenu();
  if (k === 'l') {
    if (!started || inBuilding || anyPanelOpen()) return;
    if (landBattle) return;
    if (scene === 'sea') landOn();
    else if (scene === 'land') reboard();
  }
  if (k === 'escape') onEscapeKey();
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault();
});
addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);
addEventListener('wheel', e => {
  camDist = THREE.MathUtils.clamp(camDist + Math.sign(e.deltaY) * 3,
                                  scene === 'port' ? 8 : 12, scene === 'port' ? 40 : 90);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function nearestPort() {
  let best = null, bestD = 4;
  for (const p of ports) {
    const d = Math.hypot(p.x - shipPos.x, p.y - shipPos.z);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}

function onUseKey() {
  if (!started) return;
  if (discoveryPanel.style.display === 'block') { discoveryPanel.style.display = 'none'; return; }
  if (PANELS.dialog.open) { closeDialog(); return; }
  if (closeBuildingSubPanelOpen()) return;
  if (scene === 'port' && !inBuilding && !buildingNear) {
    const npc = nearestNpc();
    if (npc) { npcDialog(npc); return; }
  }
  if (scene === 'sea') {
    const q = P.jobQuest;
    if (q?.type === 'treasure' && !q.done && !battle &&
        shipDist2D(q.x, q.z) < 3) {
      digTreasure(q);
      return;
    }
    const tn = nearestSeaTown();
    const rn = nearestSeaRuin();
    const p = nearestPort();
    if (p) enterPort(p.id);
    else if (tn) openTown(tn);
    else if (rn && !ruinCooldown(rn.id)) startRuin(rn);
  } else if (inBuilding) {
    hideBuildingPanel();
  } else if (buildingNear) {
    openBuilding(buildingNear);
  } else if (scene === 'land') {
    const np = nearestOf(ports, landPos.x, landPos.z, 4, p => p.y);
    const t = nearestTown();
    const ru = nearestRuin();
    if (np) enterPort(np.id);
    else if (t) openTown(t);
    else if (ru && !ruinCooldown(ru.id)) startRuin(ru);
  }
}

function onAshoreKey() {
  if (!started || scene !== 'sea') return;
  if (discoveryPanel.style.display === 'block') { discoveryPanel.style.display = 'none'; return; }
  const v = nearestVillage();
  if (v) goAshore(v);
}

function onEscapeKey() {
  if (discoveryPanel.style.display === 'block') { discoveryPanel.style.display = 'none'; return; }
  if (bj) { closeBlackjack(); return; }
  if (pk) { closePoker(); return; }
  if (townOpen) { closeTown(); return; }
  if (closeTopPanel()) return;
  if (scene === 'port') {
    if (inBuilding) hideBuildingPanel();
    else if (landExpedition) exitPortToLand();
    else setSail();
  }
}

// ---------------------------------------------------------------------------
// Developer mode (` to toggle): set gold and ship speed
// ---------------------------------------------------------------------------
const devPanel = document.getElementById('dev-panel');

const DEV_TABS = [['cheats', 'Cheats'], ['monsters', 'Monsters'], ['mates', 'Mates'],
                  ['discoveries', 'Discoveries'], ['teleport', 'Teleport']];
let devTab = 'cheats';

function refreshDevPanel() {
  document.getElementById('dev-gold').value = P.gold;
  document.getElementById('dev-speed').value = P.devSpeed ?? curShip().speed;
  document.getElementById('dev-status').textContent =
    `flagship: ${curShip().name} · fleet: ${P.fleet.length}/5 · speed override: ${P.devSpeed ?? 'off'}` +
    (P.randoSeed ? ` · seed: ${P.randoSeed}` : '') + (mdMode ? ' · MD palette' : '');
  // tabs
  const tabs = document.getElementById('dev-tabs');
  mkTabs(tabs, DEV_TABS, devTab, id => { devTab = id; refreshDevPanel(); });
  const cheats = document.getElementById('dev-cheats');
  const content = document.getElementById('dev-content');
  if (devTab === 'cheats') {
    cheats.style.display = 'block';
    content.style.display = 'none';
    return;
  }
  cheats.style.display = 'none';
  content.style.display = 'block';
  content.innerHTML = DEV_RENDER[devTab]();
  // draw discovery/monster thumbnails
  drawDiscThumbs(content);
  // teleport wiring: prefix filter + go (double-click a port to jump instantly)
  const tpSel = document.getElementById('dev-tp-port');
  if (tpSel) tpSel.ondblclick = () => document.getElementById('dev-tp-go').click();
  const tpFilter = document.getElementById('dev-tp-filter');
  if (tpFilter) {
    tpFilter.oninput = () => {
      const q = tpFilter.value.trim().toLowerCase();
      const sel = document.getElementById('dev-tp-port');
      sel.innerHTML = ports
        .filter(p => p.name.toLowerCase().startsWith(q))
        .map(p => `<option value="${p.id}">${p.name} (${fmtLonLat(p.x, p.y)})</option>`)
        .join('');
    };
  }
  const tp = document.getElementById('dev-tp-go');
  if (tp) tp.onclick = () => {
    const pid = +document.getElementById('dev-tp-port').value;
    const p = ports.find(x => x.id === pid);
    if (!p) return;
    endBattle();                       // teleporting shakes off any pursuers
    landExpedition = false;            // dev teleport abandons the expedition
    portReturnPos = null;
    if (scene === 'port') setSail();
    closeAllDevPanels();
    const [x, z] = sailableNear(p.x, p.y);
    shipPos.set(x, 0.4, z);
    if (scene === 'land') { landPerson.visible = false; scene = 'sea'; camDist = 34; }
    showBanner(`Teleported to ${p.name}`);
    save();
  };
}
function closeAllDevPanels() { for (const n in PANELS) closePanel(n); }

const DEV_RENDER = {
  monsters() {
    let html = `<p>${LAND_MONSTERS.length} wild monsters (strength scales with hero level)</p>`;
    for (const m of LAND_MONSTERS) {
      html += `<div class="mate-card"><canvas class="disc-thumb" data-img="${m.img[0]},${m.img[1]}" ` +
        `width="49" height="49" style="image-rendering:pixelated;border:1px solid #8a6d3b;border-radius:3px"></canvas>` +
        `<div class="mate-stats"><b>${m.name}</b><br>hp ${m.hp} · atk ${m.atk} · def ${m.def} · ` +
        `exp ${m.exp} · gold ${m.gold}</div></div>`;
    }
    return html;
  },
  mates() {
    let html = `<p>50 mates — found in the bar of their home port</p>`;
    for (const [id, m] of Object.entries(matesData)) {
      const home = ports.find(p => p.id === id * 2);
      const hired = P.mates.includes(+id);
      html += `<div class="mate-card"><img src="${matePortraitUrl(m)}" alt="">` +
        `<div class="mate-stats"><b>${m.name}</b>${hired ? ' ★' : ''} · ${m.nation} · lv ${m.lv} · ` +
        `${home ? home.name : '?'}<br>` +
        `lead ${m.leadership} seam ${m.seamanship} know ${m.knowledge} int ${m.intuition} ` +
        `cour ${m.courage} sword ${m.swordplay} luck ${m.luck} · nav ${m.navigation} ` +
        `gun ${m.gunnery} acc ${m.accounting}</div></div>`;
    }
    return html;
  },
  discoveries() {
    const SUBJECT_LABEL = { archaeology: '考古', geography: '地理', treasure: '财宝',
                            religion: '宗教', biology: '生物', art: '艺术' };
    let html = `<p>${discoveriesFound.size} / ${villages.length} discovered</p>`;
    // group discoveries by subject (6 disciplines)
    const groups = {};
    for (const v of villages) (groups[v.subject] = groups[v.subject] ?? []).push(v);
    for (const [subj, label] of Object.entries(SUBJECT_LABEL)) {
      const list = groups[subj];
      if (!list) continue;
      html += `<h3 style="color:#ffd94d;margin:8px 0 2px">${label} (${list.length})</h3>`;
      for (const v of list) {
        const found = discoveriesFound.has(v.id);
        html += `<div class="mate-card"><canvas class="disc-thumb" data-img="${v.img[0]},${v.img[1]}" ` +
          `width="49" height="49" style="image-rendering:pixelated;border:1px solid #8a6d3b;border-radius:3px"></canvas>` +
          `<div class="mate-stats"><b>${v.name}</b>${found ? ' ★' : ''} · ${fmtLonLat(v.x, v.y)}<br>` +
          `${v.desc.slice(0, 90)}…</div></div>`;
      }
    }
    return html;
  },
  teleport() {
    const opt = p => `<option value="${p.id}">${p.name} (${fmtLonLat(p.x, p.y)})</option>`;
    return `<p>Teleport your fleet to any port's coast — type to filter by name prefix.</p>` +
      `<p><input id="dev-tp-filter" placeholder="e.g. lis…" style="width:100%;box-sizing:border-box;` +
      `font-size:15px;background:#1a2a4a;color:#ffe9a8;border:1px solid #8a6d3b;border-radius:6px;padding:6px"></p>` +
      `<p><select id="dev-tp-port" size="8" style="width:100%;font-size:15px;background:#1a2a4a;color:#ffe9a8;` +
      `border:1px solid #8a6d3b;border-radius:6px;padding:6px">${ports.map(opt).join('')}</select></p>` +
      `<p><button id="dev-tp-go">Teleport</button></p>`;
  },
};

definePanel('dev', devPanel, { render: refreshDevPanel, onClose: save });
const toggleDev = () => PANELS.dev.open ? closePanel('dev') : openPanel('dev');

document.getElementById('dev-gold-set').onclick = () => {
  P.gold = Math.max(0, Math.floor(+document.getElementById('dev-gold').value || 0));
  save(); refreshDevPanel();
};
document.getElementById('dev-gold-1m').onclick = () => {
  P.gold += 1000000;
  save(); refreshDevPanel();
};
document.getElementById('dev-speed-set').onclick = () => {
  const v = +document.getElementById('dev-speed').value;
  P.devSpeed = v > 0 ? v : null;
  save(); refreshDevPanel();
};
document.getElementById('dev-speed-reset').onclick = () => {
  P.devSpeed = null;
  save(); refreshDevPanel();
};

// ---------------------------------------------------------------------------
// Music (region-based, following uw2ol's mapping in gui.py)
// ---------------------------------------------------------------------------
const PORTS_WITH_OWN_THEME = ['Lisbon', 'Seville', 'London', 'Marseille', 'Amsterdam', 'Venice', 'Faro'];
const PORT_MUSIC_BY_REGION = {
  'North Africa': 'African Town.mp3', 'East Africa': 'African Town.mp3', 'West Africa': 'African Town.mp3',
  'Middle East': 'Middle Eastern Town.mp3', 'Ottoman Empire': 'Middle Eastern Town.mp3',
  'Northern Europe': 'Northern Europe Town.mp3',
  'The Mediterranean': 'Southern Europe Town.mp3', 'Iberia': 'Southern Europe Town.mp3',
  'Central America': 'Central America Town.mp3', 'South America': 'South America Town.mp3',
  'India': 'Indian Town.mp3',
  'Southeast Asia': 'Southeast Asian Town.ogg',
};
const SEA_MUSIC_BY_REGION = {
  'East Africa': 'African Sea.mp3', 'West Africa': 'African Sea.mp3',
  'Middle East': 'Mediterranean.mp3', 'Ottoman Empire': 'Mediterranean.mp3',
  'Northern Europe': 'North Sea.mp3',
  'The Mediterranean': 'Mediterranean.mp3', 'Iberia': 'Mediterranean.mp3', 'North Africa': 'Mediterranean.mp3',
  'Central America': 'American Sea.mp3', 'South America': 'American Sea.mp3',
  'India': 'Indian Ocean.mp3',
  'Southeast Asia': 'Southeast Asian Sea.ogg',
  'Far East': 'East Asia Sea.mp3',
};

function portMusicFor(pid) {
  const meta = portMeta[Math.min(pid, 101)];
  const name = ports.find(p => p.id === pid)?.name ?? meta.name;
  if (PORTS_WITH_OWN_THEME.includes(name)) return `./assets/music/port/${name}.mp3`;
  const r = pid <= 101 ? meta.region : null;      // supply ports have no economy
  if (r && PORT_MUSIC_BY_REGION[r]) return `./assets/music/port/${PORT_MUSIC_BY_REGION[r]}`;
  if ([95, 96, 98, 131].includes(pid)) return './assets/music/port/China Town.mp3';
  if ([99, 100].includes(pid)) return './assets/music/port/Japan Town.mp3';
  if (pid === 120) return './assets/music/port/Oceania Town.mp3';
  return './assets/music/port.ogg';
}

function seaMusicFor(pid) {
  const r = (portMeta[pid] ?? portMeta[Math.min(pid, 101)])?.region;
  if (r && SEA_MUSIC_BY_REGION[r]) return `./assets/music/sea/${SEA_MUSIC_BY_REGION[r]}`;
  return Math.random() < 0.5 ? './assets/music/sea.ogg' : './assets/music/sea_1.ogg';
}

const audio = new Audio();
audio.volume = 0.5;
audio.loop = true;
const sfx = new Audio();
let musicOn = true;
function playMusic(src) {
  if (audio.dataset.cur === src) return;
  audio.dataset.cur = src;
  audio.src = src;
  if (musicOn) audio.play().catch(() => {});
}
function playSfx(src) {
  sfx.src = src;
  sfx.play().catch(() => {});
}
function toggleMusic() {
  musicOn = !musicOn;
  if (musicOn) audio.play().catch(() => {}); else audio.pause();
}

// --- rando seed tag (HUD corner, shown when a seed is active) ---
const seedTag = document.createElement('div');
seedTag.className = 'hud';
seedTag.id = 'seed-tag';
if (P.randoSeed) seedTag.textContent = `seed: ${P.randoSeed}`;
document.body.appendChild(seedTag);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hudTop = document.getElementById('hud-top');
const hudRight = document.getElementById('hud-right');
const banner = document.getElementById('banner');
const hint = document.getElementById('hint');
let bannerTimer = 0;

function fmtLonLat(x, z) {
  // fitted from the uw2ol port positions vs. real-world coordinates
  const lon = 0.1622 * x - 145.34;
  const lat = -0.13063 * z + 85.84;
  const lonS = `${Math.abs(lon).toFixed(1)}° ${lon >= 0 ? 'E' : 'W'}`;
  const latS = `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}`;
  return `${latS}  ${lonS}`;
}

function showBanner(html, ms = 3500) {
  banner.innerHTML = html;
  banner.style.opacity = 1;
  bannerTimer = ms / 1000;
}

function showHint(html) {
  if (html) { hint.innerHTML = html; hint.style.opacity = 1; }
  else hint.style.opacity = 0;
}

// small inline meter bar for the HUD (frac filled, optional threshold marker)
function hudBar(frac, color, markFrac = null) {
  const w = 90, h = 8;
  const mark = markFrac == null ? '' :
    `<div style="position:absolute;left:${Math.min(100, markFrac * 100)}%;top:-2px;width:2px;height:${h + 4}px;background:#ffd94d"></div>`;
  return `<div style="display:inline-block;position:relative;width:${w}px;height:${h}px;` +
         `background:#222;border:1px solid #8a6d3b;vertical-align:middle;margin:0 4px">` +
         `<div style="width:${Math.min(100, Math.max(0, frac * 100))}%;height:100%;background:${color}"></div>${mark}</div>`;
}

// chase camera: hover above and behind `pos` at the current zoom
function camFollow(pos) {
  camera.position.set(pos.x, camDist * Math.cos(CAM_TILT), pos.z + camDist * Math.sin(CAM_TILT));
  camera.lookAt(pos.x, 0, pos.z);
}

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let gameTime = DAY_LENGTH_SEC * 0.3;   // start mid-morning
let currentPhase = 'day';
let started = false;
let gameover = false;
document.getElementById('gameover-newgame').onclick = () => {
  localStorage.removeItem(SAVE_KEY);
  location.reload();
};

// debug hook
window.UW = {
  setTime: t => { gameTime = t; },
  getGameTime: () => gameTime,
  shipPos, personPos, landPos,
  setZoom: d => { camDist = d; },
  enterPort: id => enterPort(id),
  getScene: () => scene,
  getPortId: () => portId,
  getBuildings: () => portBuildings,
  getInBuilding: () => inBuilding,
  getDiscovered: () => [...discoveriesFound],
  addDiscovery: id => discoveriesFound.add(id),
  getPortsFound: () => [...discovered],
  teleport: (x, z) => { shipPos.x = x; shipPos.z = z; },
  walkTo: (x, z) => { personPos.x = x; personPos.z = z; },
  landTo: (x, z) => { landPos.x = x; landPos.z = z; },
  getLandPos: () => ({ x: landPos.x, z: landPos.z }),
  getMusic: () => audio.dataset.cur,
  getSfx: () => sfx.src,
  P,                                        // player state (gold, cargo, ...)
  save,
  openBuilding: b => openBuilding(b),
  toggleMenu,
  spawnPirate: (x, z, name) => spawnPirate(x ?? shipPos.x + 4, z ?? shipPos.z, name),
  fireCannon,
  getBattle: () => battle && { name: battle.enemy.ship.name, enemyHull: battle.enemy.hull,
                               balls: battle.balls.length,
                               ex: battle.enemy.pos.x, ez: battle.enemy.pos.z },
  getPirates: () => pirates.length,
  getNpcs: () => ({ wanderers: npcs.length, static: staticNpcs.length }),
  mapProbe: (x, z) => ({ tile: tileAt(Math.floor(x), Math.floor(z)),
                         sailable: sailableAt(x, z), land: isLandTile(x, z) }),
  newDay: () => onNewDay(),
  gameOver,
  isGameOver: () => gameover,
  getData: () => ({ ports, villages, towns, ruins }),
  debugNpcDir: dir => {
    const n = npcs[0];
    if (!n) return null;
    n.mvx = 0; n.mvz = 0; n.moveT = 999; n.dir = dir; n.frame = 0;
    setPackNpcFrame(n.mesh, n.charIdx, dir, 0);
    return n.charIdx;
  },
  nearestNpc, npcDialog,
  getNpcDebug: () => ({
    w: npcs.map(n => ({ x: n.pos.x, z: n.pos.z, col: NPC_FRAMES[n.kind][n.dir] + n.frame,
                        visible: n.mesh.visible })),
    s: staticNpcs.map(s => ({ visible: s.mesh.visible })),
  }),
  canBoard,
  tryBoard,
  // test-only helpers (deterministic checks in slow headless environments)
  debugHit: dmg => {
    const before = flag().hull;
    flag().hull = Math.max(0, flag().hull - dmg * (P.equipment.armor ? 0.75 : 1));
    return before - flag().hull;
  },
  hurtEnemy: n => { if (battle) battle.enemy.hull -= n; },
  setNoAutoSpawn: v => { noAutoSpawn = v; },
  landOn, reboard, startLandBattle, landBattleTurn,
  openTown, startRuin, ruinNext,
  openBlackjack, bjDeal, bjHit, bjStand, getBj: () => bj && { state: bj.state, player: bjTotal(bj.player), msg: bj.msg },
  openPoker, pkAction, evalHand, cmpHands,
  getPk: () => pk && { stage: pk.stage, state: pk.state, pot: pk.pot, toCall: pk.toCall,
                       board: pk.board.length, msg: pk.msg },
  getTown: () => nearestTown(), getRuin: () => nearestRuin(),
  getRuinRun: () => ruin,
  getScene2: () => scene,
  getLandBattle: () => landBattle && { name: landBattle.enemy.name, hp: landBattle.enemy.hp },
  hurtEnemyCrew: n => { if (battle) battle.enemy.crew -= n; },
  getEnemyCrew: () => battle?.enemy.crew,
  reset: () => { localStorage.removeItem(SAVE_KEY); location.reload(); },
};

// character selection on the start overlay (DOS large portraits from OPGRAPH)
{
  const picker = document.getElementById('char-select');
  CHARACTER_NAMES.forEach((name, ci) => {
    let c;
    if (DOS_PORTRAIT[ci]) {
      c = document.createElement('img');
      c.src = DOS_PORTRAIT[ci];
      c.alt = name;
    } else {
      c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(heroesTex.image, 4 * 68, ci * 68, 68, 68, 0, 0, 64, 64);
    }
    c.className = 'char-portrait' + (ci === P.character ? ' selected' : '');
    c.title = name;
    c.onclick = () => {
      P.character = ci;
      picker.querySelectorAll('.char-portrait').forEach(x => x.classList.remove('selected'));
      c.classList.add('selected');
      document.getElementById('char-name').textContent = name;
    };
    picker.appendChild(c);
  });
  document.getElementById('char-name').textContent = CHARACTER_NAMES[P.character];
}

document.getElementById('ruin-continue').onclick = () => ruinNext();
document.getElementById('ruin-leave').onclick = () => ruinFlee();
document.getElementById('lb-attack').onclick = () => landBattleTurn('attack');
document.getElementById('lb-balm').onclick = () => landBattleTurn('balm');
document.getElementById('lb-run').onclick = () => landBattleTurn('run');

{
  const mdBox = document.getElementById('md-mode');
  mdBox.checked = mdMode;
  mdBox.onchange = () => {
    localStorage.setItem(MD_KEY, mdBox.checked ? '1' : '0');
    location.reload();
  };
  // clicking the label must not start the game
  mdBox.parentElement.addEventListener('click', e => e.stopPropagation());
}

document.getElementById('rando-start').addEventListener('click', e => {
  e.stopPropagation();
  const seed = document.getElementById('rando-seed').value.trim() ||
               String(Math.floor(Math.random() * 1e9));
  localStorage.setItem(RANDO_KEY, JSON.stringify({
    seed,
    markets: document.getElementById('ro-markets').checked,
    specialties: document.getElementById('ro-specialties').checked,
    startShip: document.getElementById('ro-startship').checked,
    portDev: document.getElementById('ro-portdev').checked,
    portLocations: document.getElementById('ro-portloc').checked,
    discoveries: document.getElementById('ro-disc').checked,
    mapStructure: document.getElementById('ro-mapstruct').checked,
    landPct: +document.getElementById('ro-landpct').value,
    continents: document.getElementById('ro-cont').value,
    riverCount: +document.getElementById('ro-rivers').value,
    mountCount: +document.getElementById('ro-mount').value,
    polar: document.getElementById('ro-polar').checked,
    coastSmoothing: document.getElementById('ro-coast').checked,
    pirateRate: +document.getElementById('ro-pirates').value,
  }));
  localStorage.removeItem(SAVE_KEY);
  location.reload();
});

document.getElementById('start-overlay').addEventListener('click', function (e) {
  if (e.target.closest('#char-select') || e.target.closest('#rando-box') || started) return;   // picking a hero / using randomizer panel
  this.style.display = 'none';
  started = true;
  // Isabella starts with her party of 4 companions (Eudora, Mita, Sophia, Barbara)
  if (P.character === 6 && !P.mates.length) {
    P.mates = [51, 52, 53, 54];
    for (const id of P.mates) { initMateSkills(id); P.mateHp[id] = mateMaxHp(id); }
  }
  // Isabella starts inside the Faro port with her prologue
  if (P.character === 6 && !P.prologue) {
    P.prologue = { step: 0 };
    P.fleet = [];   // Isabella starts with no ship — she travels by boarding merchant ships
    const faro = ports.find(p => p.id === 132);
    const [sx, sz] = sailableNear(faro.x, faro.y);
    shipPos.set(sx, 0, sz);
    enterPort(132);   // start inside the Faro port
    landExpedition = true;
    portReturnPos = { x: faro.x + 0.5, z: faro.y + 0.5 };   // land tile near Faro (for exiting on foot)
    save();
    playMusic(portMusicFor(132));
    showBanner(`Faro, Portugal<small>February 1522 — ${CHARACTER_NAMES[P.character]}'s story begins</small>`);
    showDialog(CHARACTER_NAMES[P.character],
      'Faro, Portugal. Every week you visit your mother\'s grave in the cemetery outside the city, ' +
      'tending it with fresh flowers.<br><br><i>(Prologue — visit the cemetery to lay flowers. ' +
      'Or head to the harbor to skip ahead to Lisbon.)</i>',
      DOS_PORTRAIT[P.character]);
    return;
  }
  save();
  playMusic(seaMusicFor(1));   // Lisbon -> Mediterranean
  showBanner(`Lisbon, Portugal<small>February 1522 — ${CHARACTER_NAMES[P.character]}'s voyage begins</small>`);
});

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  // main storyline: check progress about once a second
  storyT += dt;
  if (storyT > 1) { storyT = 0; if (started && !gameover) checkStory(); }

  // --- movement input (read first: sailing speeds up the calendar) ---
  let dx = 0, dz = 0;
  const panelOpen = discoveryPanel.style.display === 'block' || inBuilding || anyPanelOpen() || !!landBattle || townOpen || !!ruin || !!bj || !!pk;
  if (started && !gameover && !panelOpen) {
    if (keys['w'] || keys['arrowup']) dz -= 1;
    if (keys['s'] || keys['arrowdown']) dz += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
  }
  const moving = dx !== 0 || dz !== 0;
  if (moving) {
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    animTimer += dt;
    if (animTimer > 0.35) { animTimer = 0; animFrame ^= 1; }
  }

  // --- day/night cycle: time runs faster while sailing (voyages cost days) ---
  const sailing = scene === 'sea' && moving;
  const prevGameTime = gameTime;
  gameTime = (gameTime + dt * (sailing ? SAIL_DAY_SCALE : 1)) % DAY_LENGTH_SEC;
  if (started && !gameover) {
    if (gameTime < prevGameTime) onNewDay();          // midnight: new day + settlement
    else if (prevGameTime < DAY_LENGTH_SEC / 2 && gameTime >= DAY_LENGTH_SEC / 2)
      settleConsumption();                            // midday: second settlement
  }
  const t = gameTime / DAY_LENGTH_SEC;            // 0..1
  const seg = Math.floor(t * 4);                  // current phase
  const segT = t * 4 - seg;
  const FADE = 0.25;                              // last 25% of a phase fades to next
  const a = phaseNames[seg];
  currentPhase = a;
  const b = phaseNames[(seg + 1) % 4];
  const blend = segT > 1 - FADE ? (segT - (1 - FADE)) / FADE : 0;
  world.uniforms.tilesA.value = phaseTex[a];
  world.uniforms.tilesB.value = phaseTex[b];
  world.uniforms.blend.value = blend;
  if (portWorld) {
    portWorld.uniforms.tilesA.value = portWorld.chips[a];
    portWorld.uniforms.tilesB.value = portWorld.chips[b];
    portWorld.uniforms.blend.value = blend;
  }

  if (scene === 'sea') {
    // --- ship movement (slide along coasts) ---
    const curSpeed = (P.devSpeed ?? fleetSpeed() * sailBonus() * navBonus()) * speedFactor() * (crewOk() ? 1 : 0.7);
    if (moving) {
      const step = curSpeed * dt;
      const nx = shipPos.x + dx * step, nz = shipPos.z + dz * step;
      if (sailableAt(nx, nz)) { shipPos.x = nx; shipPos.z = nz; }
      else if (sailableAt(nx, shipPos.z)) shipPos.x = nx;
      else if (sailableAt(shipPos.x, nz)) shipPos.z = nz;

      shipDir = dz < 0 ? (dx < 0 ? 'nw' : dx > 0 ? 'ne' : 'up')
              : dz > 0 ? (dx < 0 ? 'sw' : dx > 0 ? 'se' : 'down')
              : dx < 0 ? 'left' : 'right';
    }
    shipPos.x = wrapX(shipPos.x);          // toroidal world: wrap, don't clamp
    shipPos.z = wrapZ(shipPos.z);
    ship.visible = P.fleet.length > 0;   // hide own ship when riding someone else's (no ship)
    ship.position.copy(shipPos);
    updateShipSprite();

    camFollow(shipPos);

    // --- treasure quest: guardian spawns at the site ---
    {
      const q = P.jobQuest;
      if (q?.type === 'treasure' && q.guarded && !q.done && !battle &&
          !pirates.some(p => p.bountyName === 'treasure guard') &&
          shipDist2D(q.x, q.z) < 15) {
        spawnPirate(q.x + 1, q.z + 1, PIRATE_SHIPS[Math.floor(Math.random() * PIRATE_SHIPS.length)],
                    'treasure guard');
      }
    }

    // --- hints: boarding / nearby port / village ---
    const p = battle ? null : nearestPort();
    const v = p || battle ? null : nearestVillage();
    const tq = P.jobQuest;
    const nearTreasure = !battle && tq?.type === 'treasure' && !tq.done &&
                         shipDist2D(tq.x, tq.z) < 3;
    const tn = battle ? null : nearestSeaTown();
    const rn = battle || tn ? null : nearestSeaRuin();
    showHint(nearTreasure ? `<span class="key">E</span> dig for treasure!`
             : canBoard() ? `<span class="key">B</span> board them — melee fight!`
             : p ? `<span class="key">E</span> enter ${p.name}`
             : tn ? `<span class="key">E</span> enter ${tn.name}`
             : rn ? (ruinCooldown(rn.id) ? `${rn.name} — already explored`
                   : `<span class="key">E</span> explore ${rn.name}`)
             : v ? `<span class="key">G</span> go ashore — something seems interesting here`
             : null);

    // --- pirates & battle ---
    if (started && !gameover && !panelOpen) {
      updatePirates(dt);
      // bounty target lurks near its posted area
      const q = P.jobQuest;
      if (q?.type === 'bounty' && !q.done && !pirates.some(p => p.bountyName === q.name) &&
          shipDist2D(q.x, q.z) < 40) {
        spawnPirate(q.x + 2, q.z + 2, q.ship, q.name);
      }
    }
    updateBattle(dt);

    // --- HUD ---
    const dailyDrain = (4 + P.crew * 0.25) * boatswainFactor();
    const halfDrain = dailyDrain / 2;   // water & food each drain this per day
    const waterDays = P.water > 0 ? Math.floor(P.water / halfDrain) : 0;
    const foodDays = P.food > 0 ? Math.floor(P.food / halfDrain) : 0;
    const daysLeft = Math.min(waterDays, foodDays);
    const minC = fleetMinCrew(), maxC = fleetMaxCrew();
    const crewLow = P.crew < minC;
    const crewTxt = crewLow ? `<span style="color:#ff5b4d;font-weight:bold">${P.crew}</span>` : `${P.crew}`;
    hudTop.innerHTML =
      `<b>${fmtLonLat(shipPos.x, shipPos.z)}</b> · day ${P.days}<br>` +
      `time: ${a} · speed: ${moving ? (curSpeed * 1.8).toFixed(1) : '0.0'} kn · gold: ${P.gold}g · ${P.fleet.length ? `hull: ${Math.ceil(flag().hull)}` : 'no ship'}<br>` +
      `water: ${Math.floor(P.water)} · food: ${Math.floor(P.food)} (${daysLeft}d)${daysLeft <= 2 ? ' <span style="color:#ff5b4d">⚠</span>' : ''}<br>` +
      `fatigue${hudBar(P.fatigue / 100, P.fatigue >= 90 ? '#ff5b4d' : P.fatigue >= 60 ? '#e6a23c' : '#5b8cff')} ${Math.floor(P.fatigue)}<br>` +
      `crew${hudBar(P.crew / maxC, crewLow ? '#ff5b4d' : '#5bff8c', minC / maxC)} ${crewTxt}/${maxC}`;
  } else if (scene === 'port') {
    // --- walk in port ---
    if (moving) {
      const step = WALK_SPEED * (keys['shift'] ? 2 : 1) * dt;
      const nx = personPos.x + dx * step, nz = personPos.z + dz * step;
      if (walkableAt(nx, nz)) { personPos.x = nx; personPos.z = nz; }
      else if (walkableAt(nx, personPos.z)) personPos.x = nx;
      else if (walkableAt(personPos.x, nz)) personPos.z = nz;

      personDir = dz < 0 ? 'up' : dz > 0 ? 'down' : dx < 0 ? 'left' : 'right';
    }
    personPos.x = THREE.MathUtils.clamp(personPos.x, 1, PORT_SIZE - 2);
    personPos.z = THREE.MathUtils.clamp(personPos.z, 1, PORT_SIZE - 2);
    person.position.copy(personPos);
    updatePersonSprite();
    updateNpcs(dt, a);

    camFollow(personPos);

    // --- standing next to a building? (building tiles are unwalkable;
    //     the player stops in front of the door, like in uw2ol) ---
    buildingNear = null;
    let bestD = 2;
    for (const b of portBuildings) {
      const d = Math.hypot(b.x + 0.5 - personPos.x, b.y + 0.5 - personPos.z);
      if (d < bestD) { bestD = d; buildingNear = b; }
    }
    quickbar.style.display =
      (inBuilding || PANELS.dialog.open || panelOpen) ? 'none' : 'flex';
    if (!inBuilding && !PANELS.dialog.open) {
      if (buildingNear) {
        showHint(`<span class="key">E</span> enter ${buildingNear.name.replace(/_/g, ' ')}`);
      } else {
        const npc = nearestNpc();
        showHint(npc ? `<span class="key">E</span> talk to ${npc.label ?? 'sailor'}` : null);
      }
    } else {
      showHint(null);
    }

    // --- HUD ---
    const portName = ports.find(p => p.id === portId)?.name ?? '';
    hudTop.innerHTML =
      `<b>${portName}</b> · day ${P.days}<br>` +
      `time: ${a} · gold: ${P.gold}g<br>` +
      `fame: ${P.fame}${fameTitle() ? ' · ' + fameTitle() : ''} · ${P.fleet.length ? curShip().name + (P.fleet.length > 1 ? ' +' + (P.fleet.length - 1) : '') : 'no ship'}`;
  }

  else {
    // --- walk on land (Dragon-Quest expeditions) ---
    if (moving && !landBattle) {
      const step = WALK_SPEED * (keys['shift'] ? 2 : 1) * dt;
      const nx = landPos.x + dx * step, nz = landPos.z + dz * step;
      if (landAt(nx, nz)) { landPos.x = nx; landPos.z = nz; }
      else if (landAt(nx, landPos.z)) landPos.x = nx;
      else if (landAt(landPos.x, nz)) landPos.z = nz;

      landDir = dz < 0 ? 'up' : dz > 0 ? 'down' : dx < 0 ? 'left' : 'right';

      // random encounters while walking
      encounterT -= dt;
      if (encounterT <= 0) {
        encounterT = 6 + Math.random() * 8;
        if (Math.random() < 0.4) startLandBattle();
      }

      // discover sites by walking to them
      for (const v of villages) {
        if (discoveriesFound.has(v.id)) continue;
        if (distT(v.x, v.y, landPos.x, landPos.z) < 1.5) {
          goAshore(v);
          break;
        }
      }
    }
    landPos.x = wrapX(landPos.x);
    landPos.z = wrapZ(landPos.z);
    landPerson.position.copy(landPos);
    updateLandPersonSprite();

    camFollow(landPos);

    const nearShip = distT(landPos.x, landPos.z, shipPos.x, shipPos.z) <= 2.5;
    const nearPortLand = nearestOf(ports, landPos.x, landPos.z, 4, p => p.y);
    const t = nearestTown(), ru = nearestRuin();
    showHint(landBattle || townOpen || ruin ? null
             : nearPortLand ? `<span class="key">E</span> enter ${nearPortLand.name}`
             : t ? `<span class="key">E</span> enter ${t.name}`
             : ru ? (ruinCooldown(ru.id)
                     ? `${ru.name} — already explored (returns in ${Math.ceil((P.ruinCd[ru.id] + 7) - P.days)}d)`
                     : `<span class="key">E</span> explore ${ru.name}`)
             : nearShip ? `<span class="key">L</span> re-board your ship`
             : null);

    hudTop.innerHTML =
      `<b>${CHARACTER_NAMES[P.character]}</b> lv ${P.hero.lv} · hp ${P.hero.hp}/${heroMaxHp()}<br>` +
      `exp ${P.hero.exp}/${P.hero.lv * 20} · day ${P.days}<br>` +
      `<b>${fmtLonLat(landPos.x, landPos.z)}</b> · on foot · ${terrainAt(landPos.z)} · water ${Math.floor(P.water)} · food ${Math.floor(P.food)}`;
  }

  // --- banner fade ---
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) banner.style.opacity = 0;
  }

  // --- port discovery (sea) ---
  if (started && moving && scene === 'sea' && !landBattle) {
    for (const p of ports) {
      if (discovered.has(p.id)) continue;
      const d = Math.hypot(p.x - shipPos.x, p.y - shipPos.z);
      if (d < 5) {
        discovered.add(p.id);
        showBanner(`${p.name}<small>port discovered — ${discovered.size} of ${ports.length}</small>`);
      }
    }
  }

  hudRight.innerHTML =
    `ports discovered<br><b>${discovered.size} / ${ports.length}</b><br>` +
    `discoveries<br><b>${discoveriesFound.size} / ${villages.length}</b>`;
  drawMinimap();

  renderer.render(scene === 'port' ? portScene : seaScene, camera);
}

tick();
