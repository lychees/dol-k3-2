# Uncharted Waters — three.js voyage · Design Document

## 1. Overview

A single-page browser game recreating *Uncharted Waters 2* (Koei, 1993) with
**three.js**, using data and media assets extracted from the
[uw2ol](https://github.com/timewarpsgh/uw2ol) project. Static site, no build
step, deployed on GitHub Pages at `/game/`.

Core loop: **sail → trade → outfit your fleet → fight pirates → explore
ashore → discover the world** — with a survival layer (water/rations →
fatigue → crew deaths → game over) driving route planning.

Optional **randomizer mode** (UWNHRando-style) reshuffles the economy,
ports, discoveries and can regenerate the entire world map from a seed.

Optional **GVO asset pack**: the start screen offers a choice between the
classic UW2 (uw2ol) assets and Uncharted Waters Online artwork from
[dol-rev](https://github.com/lychees/dol-rev) (loaded cross-origin from its
GitHub Pages site; `gvo.js` maps 44 goods icons + 59 discovery artworks by
id; everything unmapped falls back to the classic assets). Persisted in
localStorage `uw-asset-pack`.

- Plain ES modules + import map (`three` from `game/lib/`); no bundler
- All state in the browser (localStorage); no backend required for solo play
- `server/` holds an **experimental multiplayer backend prototype**
  (not wired to the frontend — see §9)

## 2. Repository layout

```
game/
  index.html        shell, panels, HUD, overlays, import map
  main.js           the whole game (~4k lines, single ES module)
  randomizer.js     seeded world/economy generator (imported by main.js)
  lib/three.module.js
  assets/           generated from the uw2ol repo by tools/
  editor/           browser-based data editors (no build step; see editor/FORMATS.md)
tools/              asset pipeline (Python): prepare_assets.py, prepare_port_assets.py
tests/              Playwright suites (+ tests/screenshots/)
server/             MP backend prototype: asyncio websockets + SQLite, DI container
uw2ol/              (gitignored) asset source repo
```

## 3. Frontend architecture (game/main.js)

### 3.1 Rendering: one shader, two tilemaps

World map (2160×1080) and port maps (96×96) are each a **single
`PlaneGeometry`**. The tile-id grid lives in a `DataTexture`
(RedFormat/UnsignedByte); a GLSL3 fragment shader (`makeTilemapMesh`) maps
each pixel to a tile id and samples the right 16×16 cell from the tileset
atlas.

- Texel-center sampling → pixel-crisp close-ups; `textureGrad` with
  continuous derivatives → correct mips/aniso at distance
- Day/night: two phase textures blended in-shader (dawn/day/dusk/night
  cross-fade, 4-phase original tilesets)
- Port maps reuse the shader with a 16×15 tileset grid and +1-shifted ids
  (PORTMAP bytes are 0-based)
- Optional **MD palette mode**: textures quantized to 9-bit color with a
  contrast/saturation boost at load (Mega Drive look), toggled from the dev
  console, persisted in localStorage

Sprites (`makeSprite`) are flat quads with UV `repeat`/`offset` windows into
their sheets; all walk/sail animation is 2 frames per direction.
`DIRECTION_COL = up:0, right:2, down:4, left:6` fits ship/person/hero sheets;
the Jephed NPC atlas uses row-per-direction (down/left/right/up).

### 3.2 The toroidal world

The map wraps west↔east **and** north↔south:

- `wrapX/wrapZ/tileAt` wrap all tile lookups; `distT()` gives wrap-aware
  shortest distance and is used by every proximity check (enter port/town/
  ruin, re-board, discovery triggers)
- The world mesh is drawn as a 3×3 grid of offset copies so edges are
  seamless (frustum culling keeps it cheap)
- Ships and walkers wrap their positions instead of clamping — no edge walls

### 3.3 Scenes & input routing

`scene ∈ { 'sea', 'port', 'land' }`; one `tick()` loop branches per scene.
Port and land share the sea renderer setup; `scene === 'port'` swaps in
`portScene`.

All UI panels live in one registry (`PANELS` + `openPanel/closePanel/
anyPanelOpen/closeTopPanel`), which drives Esc/E routing and movement
locking (`panelOpen`). Building sub-panels (market, shipyard, mates,
outfit) close back to their building menu.

### 3.4 Time & the survival chain

- 180 s = 1 in-game day; **time flows 10× faster under sail**
  (`SAIL_DAY_SCALE`) so voyages actually cost days
- Consumption settles **twice per day** (midday + midnight, half rate each)
  via `settleConsumption()`; full `onNewDay()` (days++, 2% bank interest,
  mate skill XP, hull wear) runs at midnight only
- Sea chain: provisions drain `(4 + crew×0.25)/day` → empty provisions →
  fatigue ×3 → fatigue 100 → crew deaths `10 + random(5%,25%)` per
  settlement → **crew 0 = GAME OVER** (red overlay; only restart clears the
  save). Land expeditions have their own cheaper drain + hero HP loss
- Below minimum crew: speed ×0.7, broadside damage ×0.5
- Sea HUD shows: food units **+ days remaining**, fatigue bar, crew bar with
  a gold tick at minimum crew (turns red below it)

### 3.5 Persistence

`P` serializes to `localStorage 'uw-save-v1'` on every mutation: gold, fame,
fleet (per-ship refits), cargo (+cost basis), bank, crew, mates, cabin
assignments, mate skills/XP, equipment, hero (lv/exp/equipment/balms),
quests, port development, discoveries, days, character, devSpeed, randomizer
seed/rate. Migrations at load upgrade older save shapes.

## 4. Game systems

### 4.1 Economy

13 regional price tables (~46 goods, `[buy,sell]`) + 67 port specialties
from uw2ol data; cost-basis tracking → per-unit profit in red/green; goods
not stocked locally are hidden from the buy list. Bank: 2% daily interest.
Palace/governor **investment** raises a port's development and earns
ownership share.

### 4.2 Fleet, crew & mates

- Up to 5 ships, 22 real types (uw2ol stats: min/max crew, guns, cargo,
  speed, price); duplicates allowed; flagship takes battle damage
- Dry dock: buy/sell ships, per-ship **refit** (guns/hull/cargo/speed)
- 50 named mates hired in bars (each port's mate from uw2ol's mapping);
  9 cabin types (UW4-style) with mate assignment; cabins map to UWO-style
  skills (navigation/gunnery/accounting/lookout/surgery/cooking/leadership/
  swordplay/fortune) that level with use and scale the cabin bonus
- Equipment: sails & cannons (3 tiers), ram, figurehead, boarding planks,
  armor

### 4.3 Naval combat

Pirates spawn over time (rate configurable in randomizer), chase, engage on
contact. Real-time broadsides (SPACE, homing cannonballs); **dual health**:
hull (sink) + crew (capture); boarding melee (B) with swordplay attrition —
win and the prize joins your fleet or sells. Bounty hunts from the job
house. Losing your whole crew (melee or cannon fire) = game over; sinking =
shipwreck (limp to nearest known port, half gold + cargo lost).

### 4.4 Ports

131 ports (96×96 PORTMAP scenes + Tamsui reuse). 12 building types, all
functional: market, bank, inn, dry dock, palace (invest + development share),
job house (delivery/bounty/treasure quests), MSC (discovery research), bar
(hire sailors/mates, maids, rumors, **blackjack + Texas Hold'em**), item
shop, church, fortune house. Harbor sells provisions and sets sail.
Quick-access building panel in port UI.

NPCs: 40-character Jephed pack wanderers (4-dir walk cycles) + static
door NPCs (dog/old man/agent/guard); E to talk — agent gives real trade
tips, old man gives discovery coordinates. Hidden & non-interactive at
night. Shift to run.

### 4.5 Land expeditions (UW3-style rules)

- L near a coast goes ashore; the ship stays anchored. You can only
  re-board within 2.5 tiles of it (L)
- On foot you may enter ports/towns (E within 4 tiles) — but **cannot set
  sail** until you walk back and re-board (harbor offers "leave on foot",
  Esc exits the city back to the wilds)
- DQ-style turn-based battles vs wild beasts; hero levels, weapons/armor/
  balms; 14 towns (rest, rumors), 10 ruins (staged exploration, traps,
  treasure, 7-day cooldown), 110 discoveries trigger by proximity
- Defeat = wake at the ship, −10% gold

### 4.6 Randomizer mode (UWNHRando-inspired, game/randomizer.js)

Seeded (FNV hash → mulberry32). Checkboxes: markets, specialties, start
ship, port development, port locations, **map structure**, discoveries —
all on by default; the seed shows bottom-right in-game.

Map generation pipeline (`generateWorldMap`): 3-octave wrap-aware value
noise → quantile threshold to hit the target land % → edge-seeded ocean
flood fill (guarantees navigable sea) → majority-filter de-speckle →
rivers carved inland from coasts → mountain clusters → polar snow band →
marching-squares coastline pass (snapshot-based, shore texture matches the
adjacent land class: grass/sand/snow).

Options: land % (12–32), continent size, river/mountain density, polar
on/off, coast smoothing, pirate rate. Towns/ruins/supply ports use the
original 2×2 map icons (composed from consecutive tileset rows, sea color
chroma-keyed).

### 4.7 Dev console

Backquote toggles: cheats (gold, ship speed), monster/mate/discovery
encyclopedias, and **port teleport with case-insensitive prefix filter +
double-click to teleport**. MD palette toggle lives here too.

## 4.9 Data-driven overrides (editor-editable JSON)

Most game data that started life hardcoded in `main.js` now lives in
`assets/*.json`, loaded at startup and merged over the built-ins (missing
files keep the built-ins, so the game is fully backward compatible):

| File | Overrides | Editor |
|---|---|---|
| `story.json` | `STORYLINES` display fields (name/goal/reward/text; check/progress stay in code) | `editor/story.html` |
| `heroes.json` | `HERO_ATTRS` + `GROWTH` coefficients + gameplay params (titles, encounters, monster scaling, skill XP, hero item shop) | `editor/hero.html` |
| `monsters.json` | `LAND_MONSTERS` | `editor/hero.html` |
| `mates_extra.json` | original characters (mate id > 50, Isabella's party) | `editor/mates.html` |
| `equipment.json` | `OUTFIT_ITEMS` / `CABIN_TYPES` / `CABIN_DEFAULTS` | `editor/outfit.html` |
| `balance.json` | `BALANCE` (time scale, bank interest, drain/fatigue/death, pirates) | `editor/outfit.html` |
| `gvo_map.json` | GVO asset mapping (goods icons, discovery artwork) | `editor/gvoimport.html` |
| `lang_zh.json` | Chinese display names (goods/ports/ships/discoveries/monsters) | `gvo_ref` scripts |

The **Chinese language pack** is display-layer only: internal logic keys
(cargo, ship names, …) stay English, so saves are language-independent.
The **GVO asset pack** and language are chosen on the start screen and
persisted in localStorage (`uw-asset-pack`, `uw-lang`).

Extraction/mapping scripts: `tools/extract/` (one-off main.js → JSON
migrations) and `tools/gvo/` (dol-rev fusion pipeline, see its README).

## 5. Asset pipeline

`tools/prepare_*.py` (need a local uw2ol clone; location-independent):

| Asset | Source | Format |
|---|---|---|
| `world_map.bin` | world map piddle | 2160×1080 bytes, 1-based tile ids (1–32 sailable) |
| `portmaps.bin` | PORTMAP.000–100 | 101×(96×96) bytes, 0-based |
| `tiles_*.png`, `portchips/` | original tilesets | 16px tiles, 4 day-phases |
| `ports.json`, `port_meta.json` | hash_ports_meta_data | coords, buildings, tileset, region, maid |
| `goods.json` | hash_markets_price_details + hash_special_goods | 13 regional tables + specialties |
| `ships.json` | hash_ship_name_to_attributes | 22 ships |
| `mates.json`, `figures.png` | hash_mates | 50 mates + 65×81 portraits |
| `villages.json`, `discoveries.png` | hash_villages | 98 sites + 49px art |
| `music/`, `sounds/` | uw2ol sounds | regional BGM + sfx |
| `heroes.png` | DOS figure.png | 6 protagonists × 8 frames, 68px cells, chroma-keyed |
| `npc_atlas.png` | Jephed CC0 pack | 40 chars, rows down/left/right/up |

Music: port themes by capital > region > fallback; sea themes by region;
building themes (bar/church/palace); `battle.ogg` for battles; separate sfx
channel (discover, wave, shoot, explosion, engage).

## 6. Testing

`tests/` Playwright suites per feature area, run headless Chromium against
`python -m http.server` in `game/`, driving the game through `window.UW`
debug hooks (teleport/landTo/enterPort/openBuilding/spawnPirate/newDay/
setTime/...). Guidelines: poll-based waits (SwiftShader is slow and rAF is
unthrottled), deterministic hooks over wall-clock assertions, and remember
`:has-text()` exists only in Playwright selectors, not `querySelector`.

## 7. Deployment

GitHub Pages serves the repo root; the game is `/game/`. `main.js` is
cache-busted with `?v=YYYYMMDD` in `index.html` — **bump on every push**
(users must Ctrl+F5). Pages builds occasionally need a manual trigger
(`POST /repos/lychees/dol-k3-2/pages/builds`).

## 8. Conventions & gotchas

- **Always verify search-and-replace landed** (grep after editing) — silent
  no-op replaces have caused multiple shipped bugs
- Run `node --check game/main.js` after every edit
- Sprite direction layouts differ per sheet: `DIRECTION_COL` for
  ship/person/heroes, row-per-direction for the Jephed atlas
- Port tile ids in PORTMAP are 0-based; the shader expects 1-based
- Per-port PORTCHIP tileset file = `2*tileset`, zero-padded to 3

## 9. Multiplayer backend prototype (server/)

Not wired to the frontend. Python asyncio + websockets + SQLite:

- **Extensibility first**: a DI container (`main.py: build_container()` is
  the only place concrete implementations are chosen), a plugin handler
  registry (`app/handlers/` modules auto-register via `discover_registrars()`)
- Packet spec v1: `{v, type, seq, token, payload}`; replies `type.ok` /
  `error`
- pbkdf2 password auth; player game state as versioned JSON documents
- 17 integration tests; see `server/DESIGN.md` for the full spec
