import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants (from uw2ol: code/common/constants.py)
// ---------------------------------------------------------------------------
const COLS = 2160;            // world map width  in tiles
const ROWS = 1080;            // world map height in tiles
const TILESET_COLS = 16;      // tiles per row in the tileset image
const TILESET_ROWS = 8;
const SAILABLE = new Set(Array.from({ length: 32 }, (_, i) => i + 1)); // ids 1..32
const DAY_LENGTH_SEC = 180;   // one full in-game day
const SHIP_SPEED = 7;         // tiles per second
const PORT_SIZE = 96;         // port maps are 96x96 tiles
const PORT_WALK_MAX = 39;     // walkable port tile ids: 1..39
const PORT_WALK_MAX_ASIA = 46;
const WALK_SPEED = 6;         // tiles per second in port

// ---------------------------------------------------------------------------
// Boot: load all assets, then init
// ---------------------------------------------------------------------------
const [mapBuf, portMapBuf, ports, portMeta, buildingNames, villages, shipTex, personTex] =
  await Promise.all([
    fetch('./assets/world_map.bin').then(r => r.arrayBuffer()),
    fetch('./assets/portmaps.bin').then(r => r.arrayBuffer()),
    fetch('./assets/ports.json').then(r => r.json()),
    fetch('./assets/port_meta.json').then(r => r.json()),
    fetch('./assets/building_names.json').then(r => r.json()),
    fetch('./assets/villages.json').then(r => r.json()),
    loadTex('./assets/ship-tileset.png'),
    loadTex('./assets/person-tileset.png'),
  ]);
const mapData = new Uint8Array(mapBuf);
const portMaps = new Uint8Array(portMapBuf);   // 101 maps of 96*96

const phaseNames = ['dawn', 'day', 'dusk', 'night'];
const phaseTex = {};
await Promise.all(phaseNames.map(async n => {
  phaseTex[n] = await loadTex(`./assets/tiles_${n}.png`);
}));

function loadTex(url) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    res(t);
  }, undefined, rej));
}

const tileAt = (col, row) => mapData[row * COLS + col];
const sailableAt = (x, z) => {
  const c = Math.floor(x), r = Math.floor(z);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return SAILABLE.has(tileAt(c, r));
};

// ---------------------------------------------------------------------------
// Renderer / camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('app').appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 2000);
let camDist = 34;                       // zoom level (wheel)
const CAM_TILT = 0.35;                  // radians from vertical

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
    uniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D mapData, tilesA, tilesB;
      uniform float blend;
      uniform vec2 mapSize, tilesetSize;
      varying vec2 vUv;

      vec3 sampleTileset(sampler2D ts, vec2 tileXY, vec2 frac) {
        float t = texture2D(mapData, vec2((tileXY.x + 0.5) / mapSize.x,
                                          1.0 - (tileXY.y + 0.5) / mapSize.y)).r * 255.0;
        float idx = t - 1.0;                       // tile ids start at 1
        float tx = mod(idx, tilesetSize.x);
        float ty = floor(idx / tilesetSize.x);     // row from top
        // exact texel lookup (nearest), tileset is 16px tiles, flipY = true
        vec2 texel = vec2(tx * 16.0 + floor(frac.x * 16.0) + 0.5,
                          ty * 16.0 + floor((1.0 - frac.y) * 16.0) + 0.5);
        vec2 uv = vec2(texel.x / (tilesetSize.x * 16.0),
                       1.0 - texel.y / (tilesetSize.y * 16.0));
        return texture2D(ts, uv).rgb;
      }

      void main() {
        vec2 pos = vUv * mapSize;
        vec2 tileXY = floor(pos);
        vec2 frac = fract(pos);
        vec3 a = sampleTileset(tilesA, tileXY, frac);
        vec3 b = sampleTileset(tilesB, tileXY, frac);
        gl_FragColor = vec4(mix(a, b, blend), 1.0);
      }`,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cols / 2, 0, rows / 2);
  return { mesh, uniforms };
}

// ---------------------------------------------------------------------------
// Sea scene
// ---------------------------------------------------------------------------
const seaScene = new THREE.Scene();
seaScene.background = new THREE.Color(0x020a14);

const world = makeTilemapMesh(mapData, COLS, ROWS, phaseTex.day, phaseTex.day);
seaScene.add(world.mesh);

// --- ship: flat quad just above the map, UV window into the sprite sheet ---
// Sprite sheet: 8 cols x 4 rows of 32px; row 1 (from top) = player ship.
// cols: up 0-1, right 2-3, down 4-5, left 6-7 (two frames each)
const shipMap = shipTex.clone();
shipMap.needsUpdate = true;
shipMap.repeat.set(1 / 8, 1 / 4);
const ship = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.MeshBasicMaterial({ map: shipMap, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }),
);
ship.rotation.x = -Math.PI / 2;
ship.rotation.z = Math.PI;            // sprite 'up' should face -z (north)
seaScene.add(ship);

const DIRECTION_COL = { up: 0, right: 2, down: 4, left: 6,
                        ne: 2, se: 2, nw: 6, sw: 6 };
let shipDir = 'down';
let animFrame = 0, animTimer = 0;

function updateShipSprite() {
  const col = DIRECTION_COL[shipDir] + animFrame;
  shipMap.offset.set(col / 8, 0.5);   // row 1 from top -> v offset 0.5
}

// start position: just off Lisbon (port tile 840,358 is land; sea to the west)
const shipPos = new THREE.Vector3(834, 0.4, 360);

// --- port markers ---
const markerTex = makeDotTexture();
const portGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(ports.length * 3);
  ports.forEach((p, i) => { pos.set([p.x + 0.5, 0.6, p.y + 0.5], i * 3); });
  portGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const portPoints = new THREE.Points(portGeo, new THREE.PointsMaterial({
  map: markerTex, size: 2.2, transparent: true, depthWrite: false,
  color: 0xffd94d, sizeAttenuation: true,
}));
seaScene.add(portPoints);

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

// ---------------------------------------------------------------------------
// Port scene (built on demand when entering a port)
// ---------------------------------------------------------------------------
const portScene = new THREE.Scene();
portScene.background = new THREE.Color(0x020a14);

// person sprite: 32 cols x 1 row of 32px; cols: up 0-1, right 2-3, down 4-5, left 6-7
const personMap = personTex.clone();
personMap.needsUpdate = true;
personMap.repeat.set(1 / 32, 1);
const person = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.MeshBasicMaterial({ map: personMap, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide }),
);
person.rotation.x = -Math.PI / 2;
person.rotation.z = Math.PI;
portScene.add(person);

const personPos = new THREE.Vector3(48, 0.4, 48);
let personDir = 'down';

function updatePersonSprite() {
  const col = DIRECTION_COL[personDir] + animFrame;
  personMap.offset.set(col / 32, 0);
}

// port state
let scene = 'sea';              // 'sea' | 'port'
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

async function enterPort(pid) {
  const meta = portMeta[Math.min(pid, 101)];
  const mapIdx = Math.min(pid - 1, 100);
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
  portWorld = makeTilemapMesh(portData, PORT_SIZE, PORT_SIZE, chips.day, chips.day, 16, 15);
  portWorld.chips = chips;
  portScene.add(portWorld.mesh);

  portId = pid;
  portWalkMax = mapIdx >= 94 ? PORT_WALK_MAX_ASIA : PORT_WALK_MAX;
  portBuildings = Object.entries(meta.buildings)
    .map(([id, [x, y]]) => ({ id: +id, name: buildingNames[id], x, y }));

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
  const name = ports.find(p => p.id === pid)?.name ?? meta.name;
  showBanner(`${name}<small>press Esc at any time to set sail</small>`);
  playMusic(`./assets/music/port/Lisbon.mp3`);
  buildPortMinimap();
}

function setSail() {
  scene = 'sea';
  inBuilding = null;
  hideBuildingPanel();
  camDist = 34;
  const name = ports.find(p => p.id === portId)?.name ?? '';
  showBanner(`Set sail from ${name}`);
  playMusic(`./assets/music/${playlist[trackIdx]}`);
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
const buildingPanel = document.getElementById('building-panel');
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

function openBuilding(b) {
  inBuilding = b;
  document.getElementById('building-name').textContent =
    b.name.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
  document.getElementById('building-img').src = `./assets/buildings/${b.name}.png`;
  document.getElementById('building-text').textContent =
    (BUILDING_FLAVOR[b.name] ?? 'Welcome!') +
    (b.id === 4 ? ' (Press Esc twice to set sail.)' : '');
  buildingPanel.style.display = 'block';
  if (['bar', 'church', 'palace'].includes(b.name)) {
    playMusic(`./assets/music/building/${b.name}.mp3`);
  }
}

function hideBuildingPanel() {
  buildingPanel.style.display = 'none';
  if (inBuilding && ['bar', 'church', 'palace'].includes(inBuilding.name)) {
    playMusic('./assets/music/port/Lisbon.mp3');
  }
  inBuilding = null;
}

// ---------------------------------------------------------------------------
// Villages / discoveries
// ---------------------------------------------------------------------------
const discoveryPanel = document.getElementById('discovery-panel');
const discoveriesFound = new Set();
const discoveryImg = new Image();
discoveryImg.src = './assets/discoveries.png';

function nearestVillage() {
  let best = null, bestD = 4;
  for (const v of villages) {
    const d = Math.hypot(v.x - shipPos.x, v.y - shipPos.z);
    if (d < bestD) { best = v; bestD = d; }
  }
  return best;
}

function goAshore(v) {
  discoveriesFound.add(v.id);
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
mmBase.width = mm.width; mmBase.height = mm.height;
{
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
  g.fillStyle = '#ffd94d';
  for (const p of ports) {
    g.fillRect(p.x / COLS * mm.width - 1, p.y / ROWS * mm.height - 1, 2, 2);
  }
}

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
  if (scene === 'sea') {
    mmCtx.drawImage(mmBase, 0, 0);
    mmCtx.fillStyle = '#ff4444';
    mmCtx.beginPath();
    mmCtx.arc(shipPos.x / COLS * mm.width, shipPos.z / ROWS * mm.height, 2.5, 0, 7);
    mmCtx.fill();
  } else {
    mmCtx.clearRect(0, 0, mm.width, mm.height);
    mmCtx.drawImage(mmPort, 0, 0, mm.width, mm.width);   // square, centered vertically
    mmCtx.fillStyle = '#ff4444';
    mmCtx.beginPath();
    mmCtx.arc(personPos.x / PORT_SIZE * mm.width, personPos.z / PORT_SIZE * mm.width, 3, 0, 7);
    mmCtx.fill();
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = {};
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (keys[k]) return;              // ignore auto-repeat for one-shot keys
  keys[k] = true;
  if (k === 'm') toggleMusic();
  if (k === 'e') onUseKey();
  if (k === 'g') onAshoreKey();
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
  if (scene === 'sea') {
    const p = nearestPort();
    if (p) enterPort(p.id);
  } else if (inBuilding) {
    hideBuildingPanel();
  } else if (buildingNear) {
    openBuilding(buildingNear);
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
  if (scene === 'port') {
    if (inBuilding) hideBuildingPanel();
    else setSail();
  }
}

// ---------------------------------------------------------------------------
// Music
// ---------------------------------------------------------------------------
const playlist = ['Mediterranean.mp3', 'Atlantic Ocean.mp3', 'North Sea.mp3'];
let trackIdx = 0;
const audio = new Audio();
audio.volume = 0.5;
audio.addEventListener('ended', () => {
  if (scene !== 'sea') return;
  trackIdx = (trackIdx + 1) % playlist.length;
  playMusic(`./assets/music/${playlist[trackIdx]}`);
});
let musicOn = true;
function playMusic(src) {
  audio.src = src;
  if (musicOn) audio.play().catch(() => {});
}
function toggleMusic() {
  musicOn = !musicOn;
  if (musicOn) audio.play().catch(() => {}); else audio.pause();
}

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

// ---------------------------------------------------------------------------
// Game loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
let gameTime = DAY_LENGTH_SEC * 0.3;   // start mid-morning
let started = false;

// debug hook
window.UW = {
  setTime: t => { gameTime = t; },
  shipPos, personPos,
  setZoom: d => { camDist = d; },
  topDown: h => { window.__topDown = h; },
  enterPort: id => enterPort(id),
  getScene: () => scene,
  getPortId: () => portId,
  getBuildings: () => portBuildings,
  getInBuilding: () => inBuilding,
  getDiscovered: () => [...discoveriesFound],
  teleport: (x, z) => { shipPos.x = x; shipPos.z = z; },
  walkTo: (x, z) => { personPos.x = x; personPos.z = z; },
};

document.getElementById('start-overlay').addEventListener('click', function () {
  this.style.display = 'none';
  started = true;
  playMusic(`./assets/music/${playlist[trackIdx]}`);
  showBanner('Lisbon, Portugal<small>February 1522 — your voyage begins</small>');
}, { once: true });

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  // --- day/night cycle (shared) ---
  gameTime = (gameTime + dt) % DAY_LENGTH_SEC;
  const t = gameTime / DAY_LENGTH_SEC;            // 0..1
  const seg = Math.floor(t * 4);                  // current phase
  const segT = t * 4 - seg;
  const FADE = 0.25;                              // last 25% of a phase fades to next
  const a = phaseNames[seg];
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

  // --- movement input ---
  let dx = 0, dz = 0;
  const panelOpen = discoveryPanel.style.display === 'block' || inBuilding;
  if (started && !panelOpen) {
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

  if (scene === 'sea') {
    // --- ship movement (slide along coasts) ---
    if (moving) {
      const step = SHIP_SPEED * dt;
      const nx = shipPos.x + dx * step, nz = shipPos.z + dz * step;
      if (sailableAt(nx, nz)) { shipPos.x = nx; shipPos.z = nz; }
      else if (sailableAt(nx, shipPos.z)) shipPos.x = nx;
      else if (sailableAt(shipPos.x, nz)) shipPos.z = nz;

      shipDir = dz < 0 ? (dx < 0 ? 'nw' : dx > 0 ? 'ne' : 'up')
              : dz > 0 ? (dx < 0 ? 'sw' : dx > 0 ? 'se' : 'down')
              : dx < 0 ? 'left' : 'right';
    }
    shipPos.x = THREE.MathUtils.clamp(shipPos.x, 2, COLS - 3);
    shipPos.z = THREE.MathUtils.clamp(shipPos.z, 2, ROWS - 3);
    ship.position.copy(shipPos);
    updateShipSprite();

    camera.position.set(shipPos.x, camDist * Math.cos(CAM_TILT), shipPos.z + camDist * Math.sin(CAM_TILT));
    camera.lookAt(shipPos.x, 0, shipPos.z);

    // --- hints: nearby port / village ---
    const p = nearestPort();
    const v = p ? null : nearestVillage();
    showHint(p ? `<span class="key">E</span> enter ${p.name}`
             : v ? `<span class="key">G</span> go ashore — something seems interesting here`
             : null);

    // --- HUD ---
    hudTop.innerHTML =
      `<b>${fmtLonLat(shipPos.x, shipPos.z)}</b><br>` +
      `time: ${a}<br>` +
      `speed: ${moving ? (SHIP_SPEED * 1.8).toFixed(1) : '0.0'} knots`;
  } else {
    // --- walk in port ---
    if (moving) {
      const step = WALK_SPEED * dt;
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

    camera.position.set(personPos.x, camDist * Math.cos(CAM_TILT), personPos.z + camDist * Math.sin(CAM_TILT));
    camera.lookAt(personPos.x, 0, personPos.z);
    if (window.__topDown) {
      camera.position.set(48, window.__topDown, 48);
      camera.lookAt(48, 0, 48.01);
    }

    // --- standing on a building? ---
    const pc = Math.floor(personPos.x), pr = Math.floor(personPos.z);
    buildingNear = portBuildings.find(b => b.x === pc && b.y === pr) ?? null;
    if (!inBuilding) {
      showHint(buildingNear
        ? `<span class="key">E</span> enter ${buildingNear.name.replace(/_/g, ' ')}`
        : null);
    } else {
      showHint(null);
    }

    // --- HUD ---
    const portName = ports.find(p => p.id === portId)?.name ?? '';
    hudTop.innerHTML =
      `<b>${portName}</b><br>` +
      `time: ${a}<br>` +
      `buildings: ${portBuildings.length}`;
  }

  // --- banner fade ---
  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) banner.style.opacity = 0;
  }

  // --- port discovery (sea) ---
  if (started && moving && scene === 'sea') {
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

  renderer.render(scene === 'sea' ? seaScene : portScene, camera);
}

// --- ports discovered so far (sea) ---
const discovered = new Set();

tick();
