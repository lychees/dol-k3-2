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
const [mapBuf, portMapBuf, ports, portMeta, buildingNames, villages, goodsData, shipTex, personTex] =
  await Promise.all([
    fetch('./assets/world_map.bin').then(r => r.arrayBuffer()),
    fetch('./assets/portmaps.bin').then(r => r.arrayBuffer()),
    fetch('./assets/ports.json').then(r => r.json()),
    fetch('./assets/port_meta.json').then(r => r.json()),
    fetch('./assets/building_names.json').then(r => r.json()),
    fetch('./assets/villages.json').then(r => r.json()),
    fetch('./assets/goods.json').then(r => r.json()),
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
  const name = ports.find(p => p.id === pid)?.name ?? meta.name;
  showBanner(`${name}<small>press Esc at any time to set sail</small>`);
  playMusic(portMusicFor(pid));
  buildPortMinimap();
}

function setSail() {
  scene = 'sea';
  inBuilding = null;
  hideBuildingPanel();
  camDist = 34;
  const name = ports.find(p => p.id === portId)?.name ?? '';
  showBanner(`Set sail from ${name}`);
  playSfx('./assets/sounds/wave.ogg');
  playMusic(seaMusicFor(portId));
}

// ---------------------------------------------------------------------------
// Player state (persisted to localStorage)
// ---------------------------------------------------------------------------
const SHIPS = [
  { name: 'Sloop',   speed: 7,   cargo: 20, hull: 100, price: 0 },
  { name: 'Caravel', speed: 8.5, cargo: 40, hull: 150, price: 5000 },
  { name: 'Galleon', speed: 10,  cargo: 80, hull: 220, price: 20000 },
];
const TITLES = [[50, 'Duke'], [40, 'Marquis'], [30, 'Earl'], [20, 'Viscount'],
                [15, 'Baron'], [10, 'Knight'], [5, 'Squire'], [0, '']];

const SAVE_KEY = 'uw-save-v1';
let P = {
  gold: 1000, fame: 0, provisions: 100, fatigue: 0,
  shipTier: 0, hull: 100, cargo: {}, bank: 0,
  telescope: false, discoveryQuest: null, deliveryQuest: null,
  palaceMilestone: 0, days: 0, discoveries: [], portsFound: [],
};
try {
  const s = JSON.parse(localStorage.getItem(SAVE_KEY));
  if (s && typeof s === 'object') P = { ...P, ...s };
} catch { /* fresh game */ }

// discoveries / found ports live in Sets, mirrored into P on save
const discoveriesFound = new Set(P.discoveries);
const discovered = new Set(P.portsFound);

function save() {
  P.discoveries = [...discoveriesFound];
  P.portsFound = [...discovered];
  localStorage.setItem(SAVE_KEY, JSON.stringify(P));
}

const cargoUsed = () => Object.values(P.cargo).reduce((a, b) => a + b, 0);
const cargoSpace = () => SHIPS[P.shipTier].cargo - cargoUsed();
const fameTitle = () => TITLES.find(([n]) => P.fame >= n)[1];

function speedFactor() {
  if (P.hull <= 0) return 0.25;
  if (P.provisions <= 0 || P.fatigue >= 90) return 0.5;
  return 1;
}

function onNewDay() {
  P.days++;
  P.bank = Math.floor(P.bank * 1.02);          // 2% daily interest
  if (scene === 'sea') {
    P.provisions = Math.max(0, P.provisions - 8);
    P.fatigue = Math.min(100, P.fatigue + 12);
    P.hull = Math.max(0, P.hull - 1);
    if (P.provisions <= 0) {
      P.hull = Math.max(0, P.hull - 5);
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
function setBuildingText(t) { buildingText.innerHTML = t; }

function renderActions(menu) {
  buildingActions.innerHTML = '';
  for (const item of menu) {
    const btn = document.createElement('button');
    btn.textContent = item.label + (item.cost ? ` (${item.cost}g)` : '');
    btn.disabled = !!item.disabled || (!!item.cost && P.gold < item.cost);
    btn.onclick = () => { item.action(); save(); renderActions(buildingMenu(inBuilding)); };
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
  const ship = SHIPS[P.shipTier];
  switch (b.name) {
    case 'harbor': return [
      { label: 'Buy provisions (fill to 100)', cost: 100 - P.provisions,
        disabled: P.provisions >= 100,
        action() { P.gold -= 100 - P.provisions; P.provisions = 100;
                   setBuildingText('Provisions loaded. The crew is ready.'); } },
      { label: 'Set sail', action() { setSail(); } },
    ];
    case 'market': return [
      { label: 'Trade goods', action() { openMarket(); } },
    ];
    case 'inn': return [
      { label: 'Rest until morning', cost: 10, action() {
        P.gold -= 10; P.fatigue = 0; onNewDay();
        setBuildingText('You sleep soundly. Fatigue washed away — a new day begins.');
      } },
    ];
    case 'bar': return [
      { label: 'Ask for rumors', cost: 25, action() {
        P.gold -= 25;
        const unknown = villages.filter(v => !discoveriesFound.has(v.id));
        if (!unknown.length) { setBuildingText('"You\'ve seen it all, captain!"'); return; }
        const v = unknown[Math.floor(Math.random() * unknown.length)];
        setBuildingText(`"I heard there's something interesting at ${fmtLonLat(v.x, v.y)}… worth a look, captain."`);
      } },
    ];
    case 'dry_dock': {
      const dmg = ship.hull - P.hull;
      const menu = [
        { label: `Repair hull (${P.hull}/${ship.hull})`, cost: dmg * 2, disabled: dmg <= 0,
          action() { P.gold -= dmg * 2; P.hull = ship.hull;
                     setBuildingText('Hull patched and caulked. She\'s seaworthy again.'); } },
      ];
      if (P.shipTier < SHIPS.length - 1) {
        const next = SHIPS[P.shipTier + 1];
        menu.push({ label: `Buy ${next.name} (speed ${next.speed}, cargo ${next.cargo})`, cost: next.price,
          action() { P.gold -= next.price; P.shipTier++;
                     P.hull = SHIPS[P.shipTier].hull;
                     setBuildingText(`The ${next.name} is yours, captain. A fine vessel!`); } });
      }
      return menu;
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
  closeMarket();
  if (inBuilding && ['bar', 'church', 'palace'].includes(inBuilding.name)) {
    playMusic(portMusicFor(portId));
  }
  inBuilding = null;
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------
const marketPanel = document.getElementById('market-panel');
let marketOpen = false;

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

function renderMarket() {
  document.getElementById('market-info').innerHTML =
    `gold: <b>${P.gold}g</b> &nbsp;·&nbsp; cargo space: <b>${cargoSpace()}</b> / ${SHIPS[P.shipTier].cargo}`;
  const div = document.getElementById('market-table');
  const rows = marketRows();
  let html = '<table><tr><th>goods</th><th>buy</th><th>sell</th><th>hold</th><th></th></tr>';
  for (const r of rows) {
    const hold = P.cargo[r.name] ?? 0;
    html += `<tr${r.special ? ' class="specialty"' : ''}><td>${r.name}${r.special ? ' ★' : ''}</td>` +
      `<td class="num">${r.buy ?? '—'}</td><td class="num">${r.sell}</td><td class="num">${hold}</td><td></td></tr>`;
  }
  div.innerHTML = html + '</table>';
  const trs = div.querySelectorAll('tr');
  rows.forEach((r, i) => {
    const td = trs[i + 1].lastChild;
    const mk = (label, fn, disabled) => {
      const btn = document.createElement('button');
      btn.textContent = label; btn.disabled = disabled; btn.onclick = () => { fn(); save(); renderMarket(); };
      td.appendChild(btn);
    };
    if (r.buy != null) {
      mk('+1', () => { P.gold -= r.buy; P.cargo[r.name] = (P.cargo[r.name] ?? 0) + 1; },
         P.gold < r.buy || cargoSpace() < 1);
      mk('+10', () => { P.gold -= r.buy * 10; P.cargo[r.name] = (P.cargo[r.name] ?? 0) + 10; },
         P.gold < r.buy * 10 || cargoSpace() < 10);
    }
    const hold = P.cargo[r.name] ?? 0;
    if (hold > 0) {
      mk('-1', () => { P.gold += r.sell; P.cargo[r.name]--; if (!P.cargo[r.name]) delete P.cargo[r.name]; }, false);
      mk('all', () => { P.gold += r.sell * hold; delete P.cargo[r.name]; }, false);
    }
  });
}

function openMarket() {
  marketOpen = true;
  buildingPanel.style.display = 'none';
  renderMarket();
  marketPanel.style.display = 'block';
}

function closeMarket() {
  if (!marketOpen) return;
  marketOpen = false;
  marketPanel.style.display = 'none';
  if (inBuilding) buildingPanel.style.display = 'block';
}

// ---------------------------------------------------------------------------
// Villages / discoveries
// ---------------------------------------------------------------------------
const discoveryPanel = document.getElementById('discovery-panel');
const discoveryImg = new Image();
discoveryImg.src = './assets/discoveries.png';

function nearestVillage() {
  let best = null, bestD = P.telescope ? 8 : 4;
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
  if (marketOpen) { closeMarket(); return; }
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
  if (marketOpen) { closeMarket(); return; }
  if (scene === 'port') {
    if (inBuilding) hideBuildingPanel();
    else setSail();
  }
}

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
  getMusic: () => audio.dataset.cur,
  getSfx: () => sfx.src,
  P,                                        // player state (gold, cargo, ...)
  save,
  openBuilding: b => openBuilding(b),
  reset: () => { localStorage.removeItem(SAVE_KEY); location.reload(); },
};

document.getElementById('start-overlay').addEventListener('click', function () {
  this.style.display = 'none';
  started = true;
  playMusic(seaMusicFor(1));   // Lisbon -> Mediterranean
  showBanner('Lisbon, Portugal<small>February 1522 — your voyage begins</small>');
}, { once: true });

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
  const panelOpen = discoveryPanel.style.display === 'block' || inBuilding || marketOpen;
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
    const curSpeed = SHIPS[P.shipTier].speed * speedFactor();
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

    // --- hints: nearby port / village ---
    const p = nearestPort();
    const v = p ? null : nearestVillage();
    showHint(p ? `<span class="key">E</span> enter ${p.name}`
             : v ? `<span class="key">G</span> go ashore — something seems interesting here`
             : null);

    // --- HUD ---
    hudTop.innerHTML =
      `<b>${fmtLonLat(shipPos.x, shipPos.z)}</b> · day ${P.days}<br>` +
      `time: ${a} · speed: ${moving ? (curSpeed * 1.8).toFixed(1) : '0.0'} kn<br>` +
      `gold: ${P.gold}g · food: ${P.provisions} · vigor: ${100 - P.fatigue} · hull: ${P.hull}`;
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

    // --- standing next to a building? (building tiles are unwalkable;
    //     the player stops in front of the door, like in uw2ol) ---
    buildingNear = null;
    let bestD = 2;
    for (const b of portBuildings) {
      const d = Math.hypot(b.x + 0.5 - personPos.x, b.y + 0.5 - personPos.z);
      if (d < bestD) { bestD = d; buildingNear = b; }
    }
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
      `<b>${portName}</b> · day ${P.days}<br>` +
      `time: ${a} · gold: ${P.gold}g<br>` +
      `fame: ${P.fame}${fameTitle() ? ' · ' + fameTitle() : ''} · ${SHIPS[P.shipTier].name}`;
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

tick();
