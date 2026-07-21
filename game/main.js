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
const PORT_SIZE = 96;         // port maps are 96x96 tiles
const PORT_WALK_MAX = 39;     // walkable port tile ids: 1..39
const PORT_WALK_MAX_ASIA = 46;
const WALK_SPEED = 6;         // tiles per second in port

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

// ---------------------------------------------------------------------------
// Boot: load all assets, then init
// ---------------------------------------------------------------------------
const [mapBuf, portMapBuf, ports, portMeta, buildingNames, villages, goodsData, shipData, matesData, maidsData, shipTex, personTex] =
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
    loadTex('./assets/ship-tileset.png', false),
    loadTex('./assets/person-tileset.png', false),
  ]);
const mapData = new Uint8Array(mapBuf);
const portMaps = new Uint8Array(portMapBuf);   // 101 maps of 96*96

const phaseNames = ['dawn', 'day', 'dusk', 'night'];
const phaseTex = {};
await Promise.all(phaseNames.map(async n => {
  phaseTex[n] = await loadTex(`./assets/tiles_${n}.png`);
}));

// Tilesets: raw colors (no sRGB decode — output matches the original PNGs),
// mipmaps + anisotropy so distant tiles blend instead of moiré-striping.
// (texel-center sampling in the shader keeps magnified pixels crisp even
//  with LinearFilter; filtering only kicks in when tiles are minified.)
// Sprites (filter=false): crisp nearest, no mipmaps.
function loadTex(url, filter = true) {
  return new Promise((res, rej) => new THREE.TextureLoader().load(url, t => {
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

const tileAt = (col, row) => mapData[row * COLS + col];
const sailableAt = (x, z) => {
  const c = Math.floor(x), r = Math.floor(z);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return SAILABLE.has(tileAt(c, r));
};

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
// direction frame helpers (sprite sheets share the up/right/down/left layout)
const shipFrame = (map, dir, frame, row) =>
  map.offset.set((DIRECTION_COL[dir] + frame) / 8, (3 - row) / 4);
const personFrame = (map, dir, frame, block) =>
  map.offset.set((block + DIRECTION_COL[dir] + frame) / 32, 0);

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
const ship = makeSprite(shipTex, 1 / 8, 1 / 4);
const shipMap = ship.material.map;
seaScene.add(ship);

const DIRECTION_COL = { up: 0, right: 2, down: 4, left: 6,
                        ne: 2, se: 2, nw: 6, sw: 6 };
let shipDir = 'down';
let animFrame = 0, animTimer = 0;

function updateShipSprite() {
  shipFrame(shipMap, shipDir, animFrame, curShip().row);   // sprite row by ship size
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
const person = makeSprite(personTex, 1 / 32, 1);
const personMap = person.material.map;
portScene.add(person);

const personPos = new THREE.Vector3(48, 0.4, 48);
let personDir = 'down';

// person_tileset: cols 0-7 player, 8-15 woman npc, 16-23 man npc;
// cols 24-31 are static npc pairs (agent/old man/dog/guard), NOT walkable characters
const CHARACTER_NAMES = ['João Ferrero', 'Catalina Erantzo', 'Otto Baynes'];
const CHARACTER_BLOCK = [0, 8, 16];

function updatePersonSprite() {
  personFrame(personMap, personDir, animFrame, CHARACTER_BLOCK[P.character]);
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
  // PORTMAP bytes are 0-based; the shader expects 1-based tile ids (like the world map)
  const portDataShifted = portData.map(v => v + 1);
  portWorld = makeTilemapMesh(portDataShifted, PORT_SIZE, PORT_SIZE, chips.day, chips.day, 16, 15);
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
  endBattle();                    // reaching port shakes off any pursuers
  spawnPortNpcs();
  const name = ports.find(p => p.id === pid)?.name ?? meta.name;
  showBanner(`${name}<small>press Esc at any time to set sail</small>`);
  playMusic(portMusicFor(pid));
  buildPortMinimap();
}

function setSail() {
  scene = 'sea';
  inBuilding = null;
  closeDialog();
  hideBuildingPanel();
  camDist = 34;
  const name = ports.find(p => p.id === portId)?.name ?? '';
  showBanner(`Set sail from ${name}`);
  playSfx('./assets/sounds/wave.ogg');
  playMusic(seaMusicFor(portId));
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
function closeBuildingSubPanels() {
  for (const n of ['market', 'shipyard', 'mates', 'outfit']) closePanel(n);
}
function closeBuildingSubPanelOpen() {
  for (const n of ['market', 'shipyard', 'mates', 'outfit']) {
    if (PANELS[n].open) { closePanel(n); return true; }
  }
  return false;
}
function closeTopPanel() {
  // close the topmost closable panel; returns true if something was closed
  for (const n of ['dialog', 'menu', 'dev', 'market', 'shipyard', 'mates', 'outfit']) {
    if (PANELS[n].open) { closePanel(n); return true; }
  }
  return false;
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
      P.fame += Math.random() < 0.3 ? 1 : 0;
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

function showDialog(name, text) {
  document.getElementById('dialog-name').textContent = name;
  document.getElementById('dialog-text').innerHTML = text;
  openPanel('dialog');
}
definePanel('dialog', dialogPanel);
const closeDialog = () => closePanel('dialog');

function npcDialog(npc) {
  const kind = npc.kind;
  if (kind === 'man') {
    const p = ports[Math.floor(Math.random() * ports.length)];
    showDialog('Sailor', `"Have you been to <b>${p.name}</b>?"`);
  } else if (kind === 'woman') {
    showDialog('Townswoman', '"Do you like this place? ... How about me?"');
  } else if (kind === 'dog') {
    showDialog('Dog', 'Woof! Woof!');
  } else if (kind === 'oldman') {
    const unknown = villages.filter(v => !discoveriesFound.has(v.id));
    if (unknown.length && Math.random() < 0.6) {
      const v = unknown[Math.floor(Math.random() * unknown.length)];
      showDialog('Old man', `"Cherish your time, kid. I was like you many years ago…<br>` +
        `Say — they say there's something strange at <b>${fmtLonLat(v.x, v.y)}</b>."`);
    } else {
      showDialog('Old man', '"Cherish your time, kid. I was like you many years ago."');
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
        (best ? `They pay much more for it in <b>${best}</b>."` : '"'));
    } else {
      showDialog('Agent', '"Here! We have everything you can imagine!"');
    }
  } else if (kind === 'guard') {
    showDialog('Guard', P.fame >= 5
      ? `"Good day, ${fameTitle()}. The governor speaks well of you."`
      : '"Halt! State your business. …Move along, sailor."');
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

  // 2 men + 2 women wandering near the harbor
  const harbor = portBuildings.find(b => b.id === 4);
  const cx = harbor ? harbor.x : 48, cz = harbor ? harbor.y + 2 : 60;
  for (let i = 0; i < 4; i++) {
    const kind = i % 2 === 0 ? 'man' : 'woman';
    let sx = cx + 0.5, sz = cz + 0.5;
    for (let t = 0; t < 20; t++) {
      const x = cx + Math.floor(Math.random() * 17 - 8) + 0.5;
      const z = cz + Math.floor(Math.random() * 17 - 8) + 0.5;
      if (walkableAt(x, z)) { sx = x; sz = z; break; }
    }
    const mesh = makeNpcMesh(NPC_FRAMES[kind].down);
    mesh.position.set(sx, 0.4, sz);
    portScene.add(mesh);
    npcs.push({ kind, mesh, pos: new THREE.Vector3(sx, 0.4, sz), dir: 'down',
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
    n.mesh.material.map.offset.set((NPC_FRAMES[n.kind][n.dir] + n.frame) / 32, 0);
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
const landPerson = makeSprite(personTex, 1 / 32, 1);
const landPersonMap = landPerson.material.map;
landPerson.visible = false;
seaScene.add(landPerson);

const landPos = new THREE.Vector3(0, 0.4, 0);
let landDir = 'down';

function updateLandPersonSprite() {
  personFrame(landPersonMap, landDir, animFrame, CHARACTER_BLOCK[P.character]);
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

const heroMaxHp = () => 20 + 8 * P.hero.lv;
const heroAtk = () => 4 + 2 * P.hero.lv + [0, 4, 8, 14][P.hero.weapon];
const heroDef = () => Math.floor(P.hero.lv / 2) + [0, 2, 5, 9][P.hero.armor];
const mateMaxHp = id => 15 + 5 * (matesData[id]?.lv ?? 1);
const mateAtk = id => 3 + (matesData[id]?.lv ?? 1) + Math.floor((matesData[id]?.swordplay ?? 0) / 20);
const mateDef = id => Math.floor((matesData[id]?.lv ?? 1) / 3);
const mateHpOf = id => P.mateHp[id] ?? mateMaxHp(id);

function landAt(x, z) {   // walkable for a person: land tiles (not sailable water)
  const c = Math.floor(x), r = Math.floor(z);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  return !SAILABLE.has(tileAt(c, r));
}

function landOn() {
  // find an adjacent land tile to step onto
  for (const [ox, oz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = Math.floor(shipPos.x) + ox + 0.5, z = Math.floor(shipPos.z) + oz + 0.5;
    if (landAt(x, z)) {
      landPos.set(x, 0.4, z);
      scene = 'land';
      camDist = 16;
      landDir = 'down';
      landPerson.visible = true;
      landPerson.position.copy(landPos);
      updateLandPersonSprite();
      endBattle();   // pirates can't follow you ashore
      showBanner('Gone ashore<small>explore on foot — beware of wild beasts! Return to your ship and press L to re-board</small>');
      return true;
    }
  }
  showBanner('No place to land here');
  return false;
}

function reboard() {
  if (Math.hypot(landPos.x - shipPos.x, landPos.z - shipPos.z) > 2.5) {
    showBanner('Your ship is too far — walk back to it');
    return;
  }
  scene = 'sea';
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
    // level ups
    while (P.hero.exp >= P.hero.lv * 20) {
      P.hero.exp -= P.hero.lv * 20;
      P.hero.lv++;
      P.hero.hp = heroMaxHp();
      bt.log.push(`Level up! ${CHARACTER_NAMES[P.character]} is now lv ${P.hero.lv}!`);
    }
    P.fame += 1;
    bt.over = true;
    save();
    setTimeout(() => { closeLandBattle(); }, 1600);
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
    closeLandBattle();   // ran away
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
  gold: 1000, fame: 0, provisions: 100, fatigue: 0,
  fleet: [{ ship: 'Balsa', hull: 60 }],   // up to 5 ships; [0] = flagship
  cargo: {}, cargoCost: {}, bank: 0,
  crew: 5, mates: [],
  cabins: { navigator: null, gunner: null, accountant: null,
            lookout: null, surgeon: null, boatswain: null },
  equipment: { sails: 0, cannons: 0, ram: false, figurehead: false, boarding: false, armor: false },
  character: 0,
  hero: { lv: 1, exp: 0, hp: 28, weapon: 0, armor: 0, balms: 0 },
  mateHp: {},                       // mate id -> current hp (land battles)
  telescope: false, discoveryQuest: null, deliveryQuest: null,
  palaceMilestone: 0, days: 0, discoveries: [], portsFound: [],
  devSpeed: null,                 // developer-mode ship speed override
};
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && typeof s === 'object') P = { ...P, ...s };
} catch { /* fresh game */ }
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

const flag = () => P.fleet[0];                      // flagship
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

const fleetCargoCap = () => P.fleet.reduce((a, f) => a + shipStats(f).cargo, 0);
const fleetGuns = () => P.fleet.reduce((a, f) => a + shipStats(f).guns, 0);
const fleetMinCrew = () => P.fleet.reduce((a, f) => a + shipByName(f.ship).minCrew, 0);
const fleetMaxCrew = () => P.fleet.reduce((a, f) => a + shipByName(f.ship).maxCrew, 0);
const fleetSpeed = () => Math.min(...P.fleet.map(f => shipStats(f).speed));

// --- mates / cabins / equipment bonuses --------------------------------------
const cabinMate = slot => P.cabins[slot] ? matesData[P.cabins[slot]] : null;
const navBonus = () => 1 + (cabinMate('navigator')?.navigation ?? 0) * 0.05;
const accBonus = () => 1 + (cabinMate('accountant')?.accounting ?? 0) * 0.05;
const lookoutRange = () => (cabinMate('lookout')?.intuition ?? 0) * 0.5;
const surgeonFactor = () => 1 - (cabinMate('surgeon')?.knowledge ?? 0) * 0.05;
const boatswainFactor = () => 1 - (cabinMate('boatswain')?.seamanship ?? 0) * 0.05;
const sailBonus = () => 1 + [0, 0.05, 0.1, 0.15][P.equipment.sails];
const CANNON_MULT = [1, 1.3, 1.6, 2];
const gunBonus = () => (1 + (cabinMate('gunner')?.gunnery ?? 0) * 0.1) * CANNON_MULT[P.equipment.cannons];
const crewOk = () => P.crew >= fleetMinCrew();
const battleDmg = () => fleetGuns() / 4 * gunBonus() * (crewOk() ? 1 : 0.5);

// figure portrait: 65x81 cell from figures.png
const figuresImg = new Image();
figuresImg.src = './assets/figures.png';
function figureUrl(x, y) {
  const c = document.createElement('canvas');
  c.width = 65; c.height = 81;
  c.getContext('2d').drawImage(figuresImg, (x - 1) * 65 + 3, (y - 1) * 81 + 3, 59, 75,
                             0, 0, 65, 81);
  return c.toDataURL();
}

// discoveries / found ports live in Sets, mirrored into P on save
const discoveriesFound = new Set(P.discoveries);
const discovered = new Set(P.portsFound);

function save() {
  P.discoveries = [...discoveriesFound];
  P.portsFound = [...discovered];
  localStorage.setItem(SAVE_KEY, JSON.stringify(P));
}

const cargoUsed = () => Object.values(P.cargo).reduce((a, b) => a + b, 0);
const cargoSpace = () => fleetCargoCap() - cargoUsed();
const fameTitle = () => TITLES.find(([n]) => P.fame >= n)[1];

function speedFactor() {
  if (flag().hull <= 0) return 0.25;
  if (P.provisions <= 0 || P.fatigue >= 90) return 0.5;
  return 1;
}

function onNewDay() {
  P.days++;
  P.bank = Math.floor(P.bank * 1.02);          // 2% daily interest
  if (scene === 'sea') {
    P.provisions = Math.max(0, P.provisions - 8 * boatswainFactor());
    P.fatigue = Math.min(100, P.fatigue + 12 * (P.equipment.figurehead ? 0.5 : 1) * surgeonFactor());
    flag().hull = Math.max(0, flag().hull - 1);
    if (P.provisions <= 0) {
      flag().hull = Math.max(0, flag().hull - 5);
      showBanner('Out of provisions!<small>the crew is starving — find a port</small>');
    }
  }
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
    case 'harbor': return [
      { label: 'Buy provisions (fill to 100)', cost: 100 - P.provisions,
        disabled: P.provisions >= 100,
        action() { P.gold -= 100 - P.provisions; P.provisions = 100;
                   setBuildingText('Provisions loaded. The crew is ready.'); } },
      { label: 'Set sail', action() { setSail(); } },
    ];
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
        { label: `Hire sailors +10 (${P.crew}/${fleetMaxCrew()})`, cost: 1000,
          disabled: P.crew >= fleetMaxCrew(),
          action() {
            const n = Math.min(10, fleetMaxCrew() - P.crew);
            P.gold -= n * 100; P.crew += n;
            setBuildingText(`${n} sturdy sailors join your crew. (${P.crew}/${fleetMaxCrew()})`);
          } },
        { label: 'Dismiss sailors -10', disabled: P.crew <= fleetMinCrew(),
          action() {
            const n = Math.min(10, P.crew - fleetMinCrew());
            P.crew -= n;
            setBuildingText(`${n} sailors take their pay and leave. (${P.crew}/${fleetMaxCrew()})`);
          } },
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
              `<img src="${figureUrl(...m.image)}" style="width:65px;height:81px;image-rendering:pixelated"><br>` +
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
      return [
        { label: `Request audience (${discoveriesFound.size}/${next} discoveries)`, disabled: discoveriesFound.size < next,
          action() {
            P.palaceMilestone = next;
            const reward = next * 100;
            P.gold += reward; P.fame += 2;
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
      if (P.deliveryQuest) {
        const q = P.deliveryQuest;
        const target = ports.find(p => p.id === q.port);
        if (q.port === portId) return [
          { label: `Deliver the letter (+${q.reward}g)`, action() {
            P.gold += q.reward; P.fame += 3; P.deliveryQuest = null;
            setBuildingText(`Letter delivered! Payment: ${q.reward}g. The guild thanks you.`);
          } },
        ];
        return [{ label: `Deliver letter to ${target.name} (${fmtLonLat(target.x, target.y)})`, disabled: true,
                  action() {} }];
      }
      return [
        { label: 'Take a delivery job', action() {
          // only ports that actually have a job house
          const others = ports.filter(p => {
            if (p.id === portId) return false;
            const m = portMeta[Math.min(p.id, 101)];
            return m.buildings && m.buildings[7];
          });
          const t = others[Math.floor(Math.random() * others.length)];
          const here = ports.find(p => p.id === portId);
          const dist = Math.hypot(t.x - here.x, t.y - here.y);
          const reward = 200 + Math.min(800, Math.floor(dist / 2));
          P.deliveryQuest = { port: t.id, reward };
          setBuildingText(`Deliver this letter to the job house in <b>${t.name}</b> (${fmtLonLat(t.x, t.y)}). Reward: ${reward}g.`);
        } },
      ];
    }
    case 'msc': {
      if (P.discoveryQuest) {
        if (discoveriesFound.has(P.discoveryQuest)) {
          const v = villages.find(x => x.id === P.discoveryQuest);
          return [
            { label: `Report: ${v.name} (+600g)`, action() {
              P.gold += 600; P.fame += 5; P.discoveryQuest = null;
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
      { label: 'Rations (+50 provisions)', cost: 100, disabled: P.provisions >= 100,
        action() { P.gold -= 100; P.provisions = Math.min(100, P.provisions + 50);
                   setBuildingText('Hardtack and salted pork stowed aboard.'); } },
      { label: 'Lime juice (-50 fatigue)', cost: 300, disabled: P.fatigue <= 0,
        action() { P.gold -= 300; P.fatigue = Math.max(0, P.fatigue - 50);
                   setBuildingText('The crew gulps it down. Scurvy kept at bay.'); } },
    ];
    case 'church': return [
      { label: 'Make a donation', cost: 20, action() {
        P.gold -= 20;
        const roll = Math.random();
        if (roll < 0.3) { P.fame += 1; setBuildingText('Your generosity is remembered. (fame +1)'); }
        else if (roll < 0.6) { P.provisions = Math.min(100, P.provisions + 20);
          setBuildingText('The sisters share bread with your crew. (provisions +20)'); }
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
  if (['bar', 'church', 'palace'].includes(b.name)) {
    playMusic(`./assets/music/building/${b.name}.mp3`);
  }
}

function hideBuildingPanel() {
  buildingPanel.style.display = 'none';
  pendingHire = null;
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
  const meta = portMeta[Math.min(portId, 101)];
  const region = meta.region;
  const table = region ? goodsData.regions[region] : null;
  const rows = [];
  if (table) {
    for (const [name, [buy, sell]] of Object.entries(table.prices)) {
      rows.push({ name, buy: table.available[name]?.[0] ?? null, sell });
    }
  }
  const spec = goodsData.specialties[portId];
  if (spec && !rows.find(r => r.name === spec.name)) {
    const sell = table?.prices[spec.name]?.[1] ?? Math.floor(spec.price * 1.5);
    rows.push({ name: spec.name, buy: spec.price, sell, special: true });
  } else if (spec) {
    const r = rows.find(r => r.name === spec.name);
    r.buy = spec.price; r.special = true;
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
        P.fleet.push({ ship: s.name, hull: s.hull });
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
const CABINS = [['navigator', 'Navigator', '+5% speed / pt'],
                ['gunner', 'Gunner', '+10% damage / pt'],
                ['accountant', 'Accountant', '+5% sell / pt'],
                ['lookout', 'Lookout', '+0.5 sight / pt'],
                ['surgeon', 'Surgeon', '-5% fatigue / pt'],
                ['boatswain', 'Boatswain', '-5% food / pt']];

function renderMates() {
  document.getElementById('mates-info').innerHTML =
    `sailors: <b>${P.crew}</b>/${fleetMaxCrew()} &nbsp;·&nbsp; mates: <b>${P.mates.length}</b>`;
  const cab = document.getElementById('mates-cabins');
  cab.innerHTML = '';
  for (const [slot, label, desc] of CABINS) {
    const m = cabinMate(slot);
    const div = document.createElement('div');
    div.className = 'cabin';
    div.innerHTML = `<b>${label}</b><br>${m ? m.name : '—'}<br><small>${desc}</small>`;
    cab.appendChild(div);
  }
  const div = document.getElementById('mates-table');
  div.innerHTML = '';
  if (!P.mates.length) {
    div.innerHTML = '<p>No mates yet — meet them in bars around the world.</p>';
    return;
  }
  for (const id of P.mates) {
    const m = matesData[id];
    const card = document.createElement('div');
    card.className = 'mate-card';
    card.innerHTML = `<img src="${figureUrl(...m.image)}" alt="">` +
      `<div class="mate-stats"><b>${m.name}</b> · ${m.nation} · lv ${m.lv}<br>` +
      `lead ${m.leadership} seam ${m.seamanship} luck ${m.luck}<br>` +
      `nav ${m.navigation} gun ${m.gunnery} acc ${m.accounting}</div>`;
    const btns = document.createElement('div');
    for (const [slot, label] of CABINS) {
      const b = document.createElement('button');
      b.textContent = label.slice(0, 3);
      b.title = `assign as ${label}`;
      b.disabled = P.cabins[slot] === id;
      b.onclick = () => {
        for (const [s] of CABINS) if (P.cabins[s] === id) P.cabins[s] = null;
        P.cabins[slot] = id;
        save(); renderMates();
      };
      btns.appendChild(b);
    }
    const dismiss = document.createElement('button');
    dismiss.textContent = '\u2715';
    dismiss.title = 'dismiss';
    dismiss.onclick = () => {
      P.mates = P.mates.filter(x => x !== id);
      for (const [s] of CABINS) if (P.cabins[s] === id) P.cabins[s] = null;
      save(); renderMates();
    };
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

// ---------------------------------------------------------------------------
// Captain's Log (I): fleet / crew / outfit / hero / cargo / discoveries / quests
// ---------------------------------------------------------------------------
const menuPanel = document.getElementById('menu-panel');
let menuTab = 'fleet';
const MENU_TABS = [['fleet', 'Fleet'], ['crew', 'Crew'], ['outfit', 'Outfit'],
                   ['hero', 'Hero'], ['cargo', 'Cargo'], ['discoveries', 'Discoveries'],
                   ['quests', 'Quests']];

const MENU_RENDER = {
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
      CABINS.map(([slot, label]) => `<b>${label}</b>: ${cabinMate(slot)?.name ?? '—'}`).join(' · ') + '</p>';
    if (!P.mates.length) return html + '<p>No mates yet — meet them in bars.</p>';
    for (const id of P.mates) {
      const m = matesData[id];
      html += `<div class="mate-card"><img src="${figureUrl(...m.image)}" alt="">` +
        `<div class="mate-stats"><b>${m.name}</b> · ${m.nation} · lv ${m.lv}<br>` +
        `lead ${m.leadership} seam ${m.seamanship} know ${m.knowledge} int ${m.intuition} ` +
        `cour ${m.courage} sword ${m.swordplay} luck ${m.luck}<br>` +
        `nav ${m.navigation} gun ${m.gunnery} acc ${m.accounting}</div></div>`;
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
    return `<p><b>${CHARACTER_NAMES[P.character]}</b>${fameTitle() ? ' · ' + fameTitle() : ''}</p>` +
      `<p>fame: ${P.fame} · gold: ${P.gold}g · bank: ${P.bank}g · days: ${P.days}</p>` +
      `<p>provisions: ${Math.floor(P.provisions)} · vigor: ${100 - Math.floor(P.fatigue)}</p>` +
      `<h3 style="color:#ffd94d;margin:8px 0 2px">hero</h3>` +
      `<p>lv ${P.hero.lv} · hp ${P.hero.hp}/${heroMaxHp()} · atk ${heroAtk()} · def ${heroDef()} · ` +
      `weapon t${P.hero.weapon} · armor t${P.hero.armor} · balms ${P.hero.balms}</p>` +
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
    const found = villages.filter(v => discoveriesFound.has(v.id));
    let html = `<p>${found.length} / ${villages.length} discovered</p>`;
    if (!found.length) return html + '<p>Nothing yet — go ashore where things seem interesting.</p>';
    for (const v of found) {
      html += `<div class="mate-card"><canvas class="disc-thumb" data-img="${v.img[0]},${v.img[1]}" ` +
        `width="49" height="49" style="image-rendering:pixelated;border:1px solid #8a6d3b;border-radius:3px"></canvas>` +
        `<div class="mate-stats"><b>${v.name}</b> · ${fmtLonLat(v.x, v.y)}<br>${v.desc.slice(0, 90)}…</div></div>`;
    }
    return html;
  },
  quests() {
    let html = '';
    if (P.discoveryQuest) {
      const v = villages.find(x => x.id === P.discoveryQuest);
      html += `<p><b>Research quest (MSC)</b>: find <b>${v.name}</b> at ${fmtLonLat(v.x, v.y)}, ` +
              `then report to any MSC. Reward: 600g</p>`;
    }
    if (P.deliveryQuest) {
      const t = ports.find(p => p.id === P.deliveryQuest.port);
      html += `<p><b>Delivery (job house)</b>: letter to <b>${t.name}</b> ` +
              `(${fmtLonLat(t.x, t.y)}). Reward: ${P.deliveryQuest.reward}g</p>`;
    }
    if (!html) html = '<p>No active quests — visit an MSC or a job house.</p>';
    html += `<hr style="border-color:#2a3444">` +
      `<p><b>Royal favor</b>: ${discoveriesFound.size}/${P.palaceMilestone + 5} discoveries to next audience</p>` +
      `<p><b>Ports</b>: ${discovered.size} / ${ports.length} discovered · ` +
      `<b>Discoveries</b>: ${discoveriesFound.size} / ${villages.length}</p>`;
    return html;
  },
};

function renderMenu() {
  const tabs = document.getElementById('menu-tabs');
  tabs.innerHTML = '';
  for (const [id, label] of MENU_TABS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = id === menuTab ? 'active' : '';
    b.onclick = () => { menuTab = id; renderMenu(); };
    tabs.appendChild(b);
  }
  const div = document.getElementById('menu-content');
  div.innerHTML = MENU_RENDER[menuTab]();
  // draw discovery thumbnails (49px cells from the discoveries sheet)
  div.querySelectorAll('.disc-thumb').forEach(cv => {
    const [ix, iy] = cv.dataset.img.split(',').map(Number);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(discoveryImg, (ix - 1) * 49, (iy - 1) * 49, 49, 49, 0, 0, 49, 49);
  });
}

definePanel('menu', menuPanel, { render: renderMenu });
const toggleMenu = () => PANELS.menu.open ? closePanel('menu') : openPanel('menu');
const closeMenu = () => closePanel('menu');

// ---------------------------------------------------------------------------
// Naval battles: pirates hunt at sea; SPACE fires a broadside
// ---------------------------------------------------------------------------
const battleHud = document.getElementById('battle-hud');
const PIRATE_SHIPS = ['Brigantine', 'Nao', 'Galleon', 'Carrack'];
let pirates = [];             // overworld NPC ships hunting the player
let battle = null;            // {enemy, balls, cd}
let pirateTimer = 30;         // seconds until next spawn check
let noAutoSpawn = false;      // test hook: disable random pirate spawns

const ballGeo = new THREE.PlaneGeometry(0.5, 0.5);
const ballMat = new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.DoubleSide });

function makeShipMesh(row) {
  const mesh = makeSprite(shipTex, 1 / 8, 1 / 4);
  mesh.material.map.offset.set(0, (3 - row) / 4);
  return mesh;
}

function spawnPirate(x, z, name) {
  const ship = shipByName(name ?? PIRATE_SHIPS[Math.floor(Math.random() * PIRATE_SHIPS.length)]);
  const mesh = makeShipMesh(ship.row);
  seaScene.add(mesh);
  const p = { mesh, pos: new THREE.Vector3(x, 0.4, z), dir: 'down', ship,
              hull: ship.hull,
              crew: ship.minCrew + Math.floor(Math.random() * ship.minCrew),
              cooldown: 2, boardCd: 8, fleeing: false, frame: 0, animT: 0 };
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
  for (const [slot] of CABINS) sw = Math.max(sw, cabinMate(slot)?.swordplay ?? 0);
  return 1 + sw / 100;
};

function canBoard() {
  return battle && shipPos.distanceTo(battle.enemy.pos) < 2.5 && !(battle.boardLock > 0);
}

function captureEnemy() {
  const e = battle.enemy;
  playSfx('./assets/sounds/explosion.ogg');
  if (P.fleet.length < 5) {
    P.fleet.push({ ship: e.ship.name, hull: Math.floor(e.ship.hull * 0.5) });
    P.fame += 5;
    save();
    showBanner(`${e.ship.name} captured!<small>she joins your fleet · fame +5</small>`);
  } else {
    const loot = Math.floor((300 + e.ship.price / 10) * (P.equipment.figurehead ? 1.25 : 1));
    P.gold += loot;
    P.fame += 5;
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
  save();
  if (e.crew <= 0) {
    showBanner(`Boarding victory!<small>their crew is finished (${eStart} → 0); you lost ${pStart - P.crew} sailors</small>`);
    captureEnemy();
  } else if (P.crew <= 0) {
    shipwreck('massacre');
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
  if (shipPos.distanceTo(battle.enemy.pos) > 10) return;
  battle.cd = 2;
  fireBall(shipPos, battle.enemy.pos, battleDmg(), true);
}

function sinkEnemy() {
  const p = battle.enemy;
  removePirate(p);
  const loot = Math.floor((150 + Math.random() * 400 + p.ship.price / 100) * (P.equipment.figurehead ? 1.25 : 1));
  P.gold += loot;
  P.fame += 3;
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
    pirateTimer = 25 + Math.random() * 20;
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
        else if (P.crew <= 0) shipwreck('massacre');
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
  P.fame += 1;
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
  if (closeTopPanel()) return;
  if (scene === 'port') {
    if (inBuilding) hideBuildingPanel();
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
    `flagship: ${curShip().name} · fleet: ${P.fleet.length}/5 · speed override: ${P.devSpeed ?? 'off'}`;
  // tabs
  const tabs = document.getElementById('dev-tabs');
  tabs.innerHTML = '';
  for (const [id, label] of DEV_TABS) {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = id === devTab ? 'active' : '';
    b.onclick = () => { devTab = id; refreshDevPanel(); };
    tabs.appendChild(b);
  }
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
  content.querySelectorAll('.disc-thumb').forEach(cv => {
    const [ix, iy] = cv.dataset.img.split(',').map(Number);
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(discoveryImg, (ix - 1) * 49, (iy - 1) * 49, 49, 49, 0, 0, 49, 49);
  });
  // teleport wiring
  const tp = document.getElementById('dev-tp-go');
  if (tp) tp.onclick = () => {
    const pid = +document.getElementById('dev-tp-port').value;
    const p = ports.find(x => x.id === pid);
    if (!p) return;
    endBattle();                       // teleporting shakes off any pursuers
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
      html += `<div class="mate-card"><img src="${figureUrl(...m.image)}" alt="">` +
        `<div class="mate-stats"><b>${m.name}</b>${hired ? ' ★' : ''} · ${m.nation} · lv ${m.lv} · ` +
        `${home ? home.name : '?'}<br>` +
        `lead ${m.leadership} seam ${m.seamanship} know ${m.knowledge} int ${m.intuition} ` +
        `cour ${m.courage} sword ${m.swordplay} luck ${m.luck} · nav ${m.navigation} ` +
        `gun ${m.gunnery} acc ${m.accounting}</div></div>`;
    }
    return html;
  },
  discoveries() {
    let html = `<p>${discoveriesFound.size} / ${villages.length} discovered</p>`;
    for (const v of villages) {
      const found = discoveriesFound.has(v.id);
      html += `<div class="mate-card"><canvas class="disc-thumb" data-img="${v.img[0]},${v.img[1]}" ` +
        `width="49" height="49" style="image-rendering:pixelated;border:1px solid #8a6d3b;border-radius:3px"></canvas>` +
        `<div class="mate-stats"><b>${v.name}</b>${found ? ' ★' : ''} · ${fmtLonLat(v.x, v.y)}<br>` +
        `${v.desc.slice(0, 90)}…</div></div>`;
    }
    return html;
  },
  teleport() {
    const opts = ports.map(p => `<option value="${p.id}">${p.name} (${fmtLonLat(p.x, p.y)})</option>`).join('');
    return `<p>Teleport your fleet to any port's coast.</p>` +
      `<p><select id="dev-tp-port" style="width:100%;font-size:15px;background:#1a2a4a;color:#ffe9a8;` +
      `border:1px solid #8a6d3b;border-radius:6px;padding:6px">${opts}</select></p>` +
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
const PORTS_WITH_OWN_THEME = ['Lisbon', 'Seville', 'London', 'Marseille', 'Amsterdam', 'Venice'];
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
  if ([95, 96, 98].includes(pid)) return './assets/music/port/China Town.mp3';
  if ([99, 100].includes(pid)) return './assets/music/port/Japan Town.mp3';
  if (pid === 120) return './assets/music/port/Oceania Town.mp3';
  return './assets/music/port.ogg';
}

function seaMusicFor(pid) {
  const r = pid <= 101 ? portMeta[pid]?.region : null;
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
let currentPhase = 'day';
let started = false;

// debug hook
window.UW = {
  setTime: t => { gameTime = t; },
  shipPos, personPos,
  setZoom: d => { camDist = d; },
  enterPort: id => enterPort(id),
  getScene: () => scene,
  getPortId: () => portId,
  getBuildings: () => portBuildings,
  getInBuilding: () => inBuilding,
  getDiscovered: () => [...discoveriesFound],
  teleport: (x, z) => { shipPos.x = x; shipPos.z = z; },
  walkTo: (x, z) => { personPos.x = x; personPos.z = z; },
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
  getScene2: () => scene,
  getLandBattle: () => landBattle && { name: landBattle.enemy.name, hp: landBattle.enemy.hp },
  hurtEnemyCrew: n => { if (battle) battle.enemy.crew -= n; },
  getEnemyCrew: () => battle?.enemy.crew,
  reset: () => { localStorage.removeItem(SAVE_KEY); location.reload(); },
};

// character selection on the start overlay
{
  const picker = document.getElementById('char-select');
  CHARACTER_NAMES.forEach((name, ci) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.className = 'char-portrait' + (ci === P.character ? ' selected' : '');
    c.title = name;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(personTex.image, (CHARACTER_BLOCK[ci] + 4) * 32, 0, 32, 32, 0, 0, 64, 64);
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

document.getElementById('lb-attack').onclick = () => landBattleTurn('attack');
document.getElementById('lb-balm').onclick = () => landBattleTurn('balm');
document.getElementById('lb-run').onclick = () => landBattleTurn('run');

document.getElementById('start-overlay').addEventListener('click', function (e) {
  if (e.target.closest('#char-select') || started) return;   // picking a hero / already started
  this.style.display = 'none';
  started = true;
  save();
  playMusic(seaMusicFor(1));   // Lisbon -> Mediterranean
  showBanner(`Lisbon, Portugal<small>February 1522 — ${CHARACTER_NAMES[P.character]}'s voyage begins</small>`);
});

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.1);

  // --- day/night cycle (shared) ---
  const prevGameTime = gameTime;
  gameTime = (gameTime + dt) % DAY_LENGTH_SEC;
  if (started && gameTime < prevGameTime) onNewDay();   // day wrapped
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

  // --- movement input ---
  let dx = 0, dz = 0;
  const panelOpen = discoveryPanel.style.display === 'block' || inBuilding || anyPanelOpen() || !!landBattle;
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
    shipPos.x = THREE.MathUtils.clamp(shipPos.x, 2, COLS - 3);
    shipPos.z = THREE.MathUtils.clamp(shipPos.z, 2, ROWS - 3);
    ship.position.copy(shipPos);
    updateShipSprite();

    camera.position.set(shipPos.x, camDist * Math.cos(CAM_TILT), shipPos.z + camDist * Math.sin(CAM_TILT));
    camera.lookAt(shipPos.x, 0, shipPos.z);

    // --- hints: boarding / nearby port / village ---
    const p = battle ? null : nearestPort();
    const v = p || battle ? null : nearestVillage();
    showHint(canBoard() ? `<span class="key">B</span> board them — melee fight!`
             : p ? `<span class="key">E</span> enter ${p.name}`
             : v ? `<span class="key">G</span> go ashore — something seems interesting here`
             : null);

    // --- pirates & battle ---
    if (started && !panelOpen) updatePirates(dt);
    updateBattle(dt);

    // --- HUD ---
    hudTop.innerHTML =
      `<b>${fmtLonLat(shipPos.x, shipPos.z)}</b> · day ${P.days}<br>` +
      `time: ${a} · speed: ${moving ? (curSpeed * 1.8).toFixed(1) : '0.0'} kn<br>` +
      `gold: ${P.gold}g · food: ${P.provisions} · vigor: ${100 - P.fatigue} · hull: ${Math.ceil(flag().hull)} · crew: ${P.crew}`;
  } else if (scene === 'port') {
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
    updateNpcs(dt, a);

    camera.position.set(personPos.x, camDist * Math.cos(CAM_TILT), personPos.z + camDist * Math.sin(CAM_TILT));
    camera.lookAt(personPos.x, 0, personPos.z);

    // --- standing next to a building? (building tiles are unwalkable;
    //     the player stops in front of the door, like in uw2ol) ---
    buildingNear = null;
    let bestD = 2;
    for (const b of portBuildings) {
      const d = Math.hypot(b.x + 0.5 - personPos.x, b.y + 0.5 - personPos.z);
      if (d < bestD) { bestD = d; buildingNear = b; }
    }
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
      `fame: ${P.fame}${fameTitle() ? ' · ' + fameTitle() : ''} · ${curShip().name}${P.fleet.length > 1 ? ' +' + (P.fleet.length - 1) : ''}`;
  }

  else {
    // --- walk on land (Dragon-Quest expeditions) ---
    if (moving && !landBattle) {
      const step = WALK_SPEED * dt;
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
        if (Math.hypot(v.x - landPos.x, v.y - landPos.z) < 1.5) {
          goAshore(v);
          break;
        }
      }
    }
    landPos.x = THREE.MathUtils.clamp(landPos.x, 2, COLS - 3);
    landPos.z = THREE.MathUtils.clamp(landPos.z, 2, ROWS - 3);
    landPerson.position.copy(landPos);
    updateLandPersonSprite();

    camera.position.set(landPos.x, camDist * Math.cos(CAM_TILT), landPos.z + camDist * Math.sin(CAM_TILT));
    camera.lookAt(landPos.x, 0, landPos.z);

    const nearShip = Math.hypot(landPos.x - shipPos.x, landPos.z - shipPos.z) <= 2.5;
    showHint(landBattle ? null
             : nearShip ? `<span class="key">L</span> re-board your ship`
             : null);

    hudTop.innerHTML =
      `<b>${CHARACTER_NAMES[P.character]}</b> lv ${P.hero.lv} · hp ${P.hero.hp}/${heroMaxHp()}<br>` +
      `exp ${P.hero.exp}/${P.hero.lv * 20} · day ${P.days}<br>` +
      `<b>${fmtLonLat(landPos.x, landPos.z)}</b> · on foot`;
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
