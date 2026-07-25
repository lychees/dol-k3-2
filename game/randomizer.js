// Seeded randomizer (inspired by Gilmok/UWNHRando).
// Deterministic: same seed + same options -> same world.

// --- seed hashing + PRNG -----------------------------------------------------
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const shuffle = (rnd, arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// --- market randomization -----------------------------------------------------
// Per UWNHRando: every good available somewhere, buy < sell per region,
// specialties never duplicate the home region's market.
function randomizeMarkets(rnd, goodsData) {
  const regions = Object.keys(goodsData.regions);
  const allGoods = Object.keys(goodsData.regions[regions[0]].prices);
  const covered = new Set();

  // guarantee coverage: deal all goods to regions first
  const hands = regions.map(() => []);
  allGoods.forEach((g, i) => hands[i % regions.length].push(g));

  const out = {};
  regions.forEach((region, i) => {
    // 8-12 goods: the dealt hand + random extras
    const n = 8 + Math.floor(rnd() * 5);
    const avail = new Set(hands[i]);
    for (const g of shuffle(rnd, allGoods)) {
      if (avail.size >= n) break;
      avail.add(g);
    }
    avail.forEach(g => covered.add(g));

    const available = {};
    const prices = {};
    for (const g of allGoods) {
      const [b0, s0] = goodsData.regions[region].prices[g];
      if (avail.has(g)) {
        const buy = Math.max(1, Math.round(b0 * (0.7 + rnd() * 0.6)));
        const sell = Math.max(buy + 1, Math.round(buy * (1.1 + rnd() * 0.5)));
        available[g] = [buy, sell];
        prices[g] = [buy, sell];
      } else {
        const sell = Math.max(1, Math.round(s0 * (0.9 + rnd() * 0.6)));
        prices[g] = [0, sell];
      }
    }
    out[region] = { available, prices };
  });

  // any good that ended up covered nowhere: force it into a random region
  for (const g of allGoods) {
    if (!covered.has(g)) {
      const region = pick(rnd, regions);
      const [b0, s0] = out[region].prices[g];
      const buy = Math.max(1, Math.round((b0 || s0) * 0.8));
      out[region].available[g] = [buy, Math.max(buy + 1, Math.round(buy * 1.3))];
    }
  }
  return out;
}

function randomizeSpecialties(rnd, regionsRnd, portRegion, ports) {
  const allGoods = Object.keys(regionsRnd[Object.keys(regionsRnd)[0]].prices);
  const specs = {};
  for (const p of ports) {
    const region = portRegion(p.id);
    const homeAvail = region ? Object.keys(regionsRnd[region].available) : [];
    const candidates = allGoods.filter(g => !homeAvail.includes(g));
    const good = pick(rnd, candidates.length ? candidates : allGoods);
    const base = region ? (regionsRnd[region].prices[good]?.[1] ?? 50) : 50;
    specs[p.id] = { name: good, price: Math.max(1, Math.round(base * 0.8)) };
  }
  return specs;
}

// --- geography randomization ---------------------------------------------------
function randomizePorts(rnd, ports, snapCoast) {
  const used = [];
  return ports.map(p => {
    let [x, y] = snapCoast(rnd);
    // keep ports apart
    for (let tries = 0; tries < 20; tries++) {
      if (used.every(([ux, uy]) => Math.hypot(ux - x, uy - y) >= 8)) break;
      [x, y] = snapCoast(rnd);
    }
    used.push([x, y]);
    return { ...p, x, y };
  });
}

function randomizeDiscoveries(rnd, villages, snapLand) {
  return villages.map(v => {
    const [x, y] = snapLand(rnd);
    return { ...v, x, y };
  });
}

// --- world map structure generation ---------------------------------------------
// 3-octave value noise -> threshold at a land-percentage quantile, then
// flood-fill the ocean so all water is reachable (circumnavigable).
function valueNoise(rnd, gw, gh, cols, rows) {
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const s = t => t * t * (3 - 2 * t);
  return (x, z) => {
    // wrap-aware sampling: the map is a torus (edges connect)
    const gx = x / cols * gw, gz = z / rows * gh;
    const x0 = Math.floor(gx) % gw, z0 = Math.floor(gz) % gh;
    const x1 = (x0 + 1) % gw, z1 = (z0 + 1) % gh;
    const fx0 = gx - Math.floor(gx), fz0 = gz - Math.floor(gz);
    const fx = s(fx0), fz = s(fz0);
    const v00 = grid[z0 * gw + x0], v10 = grid[z0 * gw + x1];
    const v01 = grid[z1 * gw + x0], v11 = grid[z1 * gw + x1];
    return v00 + (v10 - v00) * fx + (v01 - v00) * fz + (v00 - v10 - v01 + v11) * fx * fz;
  };
}

export function generateWorldMap(rnd, COLS, ROWS, seaId, landIds) {
  const n1 = valueNoise(rnd, 10, 6, COLS, ROWS);
  const n2 = valueNoise(rnd, 24, 12, COLS, ROWS);
  const n3 = valueNoise(rnd, 60, 30, COLS, ROWS);
  const val = new Float32Array(COLS * ROWS);
  const LAND_PCT = 0.16 + rnd() * 0.08;      // 16-24% land
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x < COLS; x++) {
      const i = z * COLS + x;
      val[i] = 0.55 * n1(x, z) + 0.3 * n2(x, z) + 0.15 * n3(x, z);
    }
  }
  const sorted = Float32Array.from(val).sort();
  const thr = sorted[Math.floor((1 - LAND_PCT) * sorted.length)];
  const data = new Uint8Array(COLS * ROWS).fill(seaId);
  const n4 = valueNoise(rnd, 40, 20, COLS, ROWS);
  for (let i = 0; i < data.length; i++) {
    if (val[i] >= thr) {
      const t = n4((i % COLS), (i / COLS) | 0);
      data[i] = t < 0.7 ? landIds[0] : t < 0.95 ? landIds[1] : landIds[2];
    }
  }
  // polar ice caps (north & south bands, like the original's arctic scenery)
  const POLAR = 0.045;
  for (let z = 0; z < ROWS; z++) {
    if (Math.min(z, ROWS - 1 - z) >= ROWS * POLAR) continue;
    for (let x = 0; x < COLS; x++) {
      const i = z * COLS + x;
      // jagged icy cap: mostly snow land, with a few water channels
      data[i] = n4(x, z) > 0.18 ? 82 : seaId;
    }
  }

  // ocean connectivity: flood fill from every WATER tile on the map edge.
  // (starting in a random inland lake would seal the MAIN ocean instead!)
  const reach = new Uint8Array(COLS * ROWS);
  const q = [];
  const seedAt = (x, z) => {
    const i = wrapI(x, z);
    if (data[i] === seaId && !reach[i]) { reach[i] = 1; q.push([x, z]); }
  };
  const wrapI = (x, z) => ((z % ROWS + ROWS) % ROWS) * COLS + ((x % COLS + COLS) % COLS);
  for (let x = 0; x < COLS; x++) { seedAt(x, 0); seedAt(x, ROWS - 1); }
  for (let z = 0; z < ROWS; z++) { seedAt(0, z); seedAt(COLS - 1, z); }
  // edges might be all ice: fall back to the first water tile anywhere
  if (!q.length) {
    for (let i = 0; i < data.length; i++) {
      if (data[i] === seaId) { reach[i] = 1; q.push([i % COLS, Math.floor(i / COLS)]); break; }
    }
  }
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = (x + dx + COLS) % COLS, nz = (z + dz + ROWS) % ROWS;
      const ni = nz * COLS + nx;
      if (!reach[ni] && data[ni] === seaId) { reach[ni] = 1; q.push([nx, nz]); }
    }
  }
  let sealed = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === seaId && !reach[i]) { data[i] = landIds[0]; sealed++; }
  }
  return { data, sealedLakes: sealed };
}

// --- main entry ------------------------------------------------------------------
/**
 * Apply the randomizer to the game's data objects (mutates them).
 * opts: { seed, markets, specialties, startShip, portDev, portLocations, discoveries }
 * deps: { goodsData, villages, ports, portMeta, snapCoast, snapLand, ships }
 * Returns a summary of what was randomized.
 */
export function applyRandomizer(opts, deps) {
  const seed = hashSeed(opts.seed ?? Math.floor(Math.random() * 1e9));
  const rnd = mulberry32(seed);
  const summary = { seed };

  const regionsRnd = opts.markets ? randomizeMarkets(rnd, deps.goodsData)
                                  : deps.goodsData.regions;
  if (opts.markets) {
    for (const r of Object.keys(regionsRnd)) deps.goodsData.regions[r] = regionsRnd[r];
    summary.markets = true;
  }
  if (opts.specialties) {
    deps.goodsData.specialties =
      randomizeSpecialties(rnd, regionsRnd, deps.portRegion, deps.ports);
    summary.specialties = true;
  }
  if (opts.portDev) {
    for (const p of deps.ports) {
      deps.portDev[p.id] = { dev: 100 + Math.floor(rnd() * 500), mine: 0 };
    }
    summary.portDev = true;
  }
  if (opts.portLocations) {
    const moved = randomizePorts(rnd, deps.ports, deps.snapCoast);
    deps.ports.forEach((p, i) => { p.x = moved[i].x; p.y = moved[i].y; });
    summary.portLocations = true;
  }
  if (opts.discoveries) {
    const moved = randomizeDiscoveries(rnd, deps.villages, deps.snapLand);
    deps.villages.forEach((v, i) => { v.x = moved[i].x; v.y = moved[i].y; });
    summary.discoveries = true;
  }
  if (opts.startShip) {
    const small = deps.ships.slice(0, 6);
    summary.startShip = pick(rnd, small).name;
  }
  return summary;
}
