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
    const [x, y] = snapCoast(rnd);
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
