# Development Session — Uncharted Waters three.js

Date: 2026-07-21
Project: dol-k3-2 — a browser sailing game built with three.js using assets from
[timewarpsgh/uw2ol](https://github.com/timewarpsgh/uw2ol) (a fan remake of
Uncharted Waters 2 as an MMO, written in Python/pygame/twisted).

## Session log

### 1. "What's this?" — uw2ol repo overview
- Explained the uw2ol project: Python MMO remake of Uncharted Waters 2
  (pygame + twisted + pygame_gui + MySQL), assets taken from the original game.

### 2. "build a game using their assets with three.js"
- Cloned uw2ol and reverse-engineered its asset formats:
  - World map: 2160×1080 tile matrix, tile ids 1-based; sailable ids 1–32
    (`code/common/constants.py: SAILABLE_TILES`).
  - World tilesets: `assets/images/world_map/{dawn,day,dusk,night}.png`,
    16×8 grid of 16px tiles.
  - Ship sprites: `ship-tileset.png`, 8 cols × 4 rows of 32px;
    cols up 0-1, right 2-3, down 4-5, left 6-7.
  - Ports: 130 ports with world-map tile coordinates.
- Exported web assets (`prepare_assets.py`): `world_map.bin`, `tiles_*.png`,
  `ship-tileset.png`, `ports.json`, sea music.
- Built the game (`game/index.html` + `game/main.js`):
  - Whole world map as ONE plane with a custom tilemap shader
    (map data in a `DataTexture`, per-pixel tile lookup — no millions of quads).
  - Day/night cycle cross-fading the 4 original tileset variants.
  - Sailing with WASD/arrows, coast sliding collision, animated ship sprite.
  - 130 port markers, port discovery banners, live minimap,
    lon/lat HUD (fitted from port positions), zoom, music.
- Verified with headless Chromium (Playwright): start at Lisbon
  (38.8°N 10.1°W ✓), sailing, land collision, discovery, all day phases,
  zero console errors.

### 3. "要可以进港口和进村落" (enter ports and villages)
- Reverse-engineered port/village formats from uw2ol source:
  - `PORTMAP.000–100`: 96×96 bytes, tile id = byte + 1, row-major.
  - `PORTCHIP.{000,002,...,012}  {phase}.png`: 16×15 grid of 16px tiles
    (256×240); tileset per port = `2 * tileset` from `hash_ports_meta_data.py`.
  - Walkable port tiles: ids 1–39 (Asia ports, map idx ≥ 94: 1–46).
  - Buildings per port from `hash_ports_meta_data[port]['buildings']`;
    id→name via `look_up_tables.py: id_2_building_type` (12 types).
  - Enter port: within 2 tiles in uw2ol (we use 4 for playability).
  - Villages/discoveries: `hash_villages.py`, 98 entries with world tile x/y,
    description, and 49px cell coords into `discoveries_and_items.png`.
  - Person sprite: `person_tileset.png`, 32×32 cells, same direction layout
    as ships.
- Exported (`prepare_port_assets.py`): `portmaps.bin` (101 maps),
  `portchips/` (28 pngs), `port_meta.json`, `building_names.json`,
  `villages.json`, `person-tileset.png`, `discoveries.png`,
  building interiors, port/building music.
- Implemented:
  - Port scene: walk ashore in any of 130 ports (supply ports >101 use the
    generic map 100), person sprite with walk animation, building entry
    (interior image + flavor text + bar/church/palace music), Esc to set sail.
  - Village discovery: G to go ashore near a discovery site, panel with the
    original artwork + description, discoveries counter.
  - Port minimap, per-port tileset lazy loading, day/night in port.
- Bug found & fixed: port tileset is 16×**15** (256×240), not 16×8 —
  tileset size is now a parameter of the tilemap shader mesh factory.
- Verified: Lisbon walk + inn, Istanbul (tileset 2), Sakai (Japan, tileset 5,
  Asia walk rules), supply port, port night, Stonehenge discovery.

### 4. "上传到 github 并配置 github page"
- Initialized git, pushed to https://github.com/lychees/dol-k3-2
- Enabled GitHub Pages (main branch, root); game served at
  https://lychees.github.io/dol-k3-2/game/

### 5. "港口的贴图是不是不太对？也没法访问建筑" (bugfix round)
- **Building access**: building tiles are unwalkable by design (ids 42/44/46/170);
  in uw2ol the player stops in front of the door. Fixed the proximity check to
  trigger on the nearest building within 2 tiles instead of requiring the
  player to stand ON the (unwalkable) building tile.
- **Port textures — root cause: off-by-one tile ids**. PORTMAP bytes are
  0-based (uw2ol does `byte + 1`), but the shader assumed 1-based ids like the
  world map. Every port tile was drawn as the previous tile (water rendered as
  beach-edge tiles → the mystery "vertical stripes"). Fixed by uploading a
  +1-shifted copy of the port map to the DataTexture.
- **Color fix**: removed `SRGBColorSpace` from tileset textures — the custom
  ShaderMaterial does not re-encode to sRGB, so decoded-linear output looked
  dark/over-contrasted. Textures now pass through raw, matching the PNGs.
- **Filtering**: tilesets use LinearFilter + mipmaps + max anisotropy with a
  GLSL3 `textureGrad` shader (continuous derivatives, no tile-boundary
  artifacts); texel-center sampling keeps magnified pixels crisp.
- Verified on real GPU (RTX 4090) + SwiftShader: Lisbon/Istanbul ports match
  the PIL ground-truth render; full regression test passed.

### 6. 区域 BGM + 发现音效 + 方向修复
- **Regional BGM** (uw2ol's mapping from gui.py): exported `region` per port
  (economyId → markets list). Port music: 6 capital themes (Lisbon/Seville/
  London/Marseille/Amsterdam/Venice), region themes (African/Middle Eastern/
  Northern Europe/Southern Europe/Central & South America/Indian/Southeast
  Asian Town), China/Japan/Oceania Town by port id, port.ogg fallback.
  Sea music on set sail by the port's region (African Sea/Mediterranean/
  North Sea/American Sea/Indian Ocean/Southeast Asian Sea/East Asia Sea,
  sea.ogg/sea_1.ogg fallback). BGM loops; ~190MB of music added.
- **Discovery sfx**: discover.ogg on going ashore, wave.ogg on set sail
  (separate Audio element so BGM keeps playing).
- **Direction fix**: removed `rotation.z = Math.PI` from ship/person meshes —
  the 180° roll made sprites face the opposite way (up/down swapped).
  Verified all 4 directions against the sprite sheet.

## Key file formats (cheat sheet)

| Data | Format |
|---|---|
| world_map.bin | 2160×1080 bytes, tile id = value (1-based) |
| portmaps.bin | 101 × (96×96) bytes, tile id = value + 1 |
| tiles_*.png | 16×8 grid of 16px tiles (256×128) |
| portchips/*.png | 16×15 grid of 16px tiles (256×240) |
| ship-tileset.png | 8×4 grid of 32px; row 1 = player ship |
| person-tileset.png | 32×1 grid of 32px; up 0-1, right 2-3, down 4-5, left 6-7 |
| discoveries.png | 49px cells, 16×8 grid (785×393) |

## Asset credits
All game assets (map data, tiles, sprites, music, images) are extracted from
the uw2ol project, which took them from the original Uncharted Waters 2
(Koei, 1993). For non-commercial fan/educational use only.
