# Uncharted Waters — three.js voyage

A browser sailing game built with **three.js**, using assets from the
[uw2ol](https://github.com/timewarpsgh/uw2ol) project
(a fan remake of *Uncharted Waters 2*, Koei 1993).

**Play online: https://lychees.github.io/dol-k3-2/game/**

Design doc: [DESIGN.md](DESIGN.md) · Dev log: [SESSION.md](SESSION.md)

## Features

- 🗺️ Full 2160×1080-tile world map with a custom tilemap shader, day/night cycle
- ⛵ Sail, trade 46 goods across 13 regional economies, bank with interest
- ⚓ Enter all **130 ports**: walk the streets, talk to NPCs, visit 12 building types
- 🏛️ Market, shipyard (22 ship types), bar (mates & sailors), dry dock, bank,
  inn, palace, church, MSC & job house quests, item shop, fortune house
- 🚢 Fleet of up to 5 ships, 6 cabin types, ship equipment (sails/cannons/
  ram/figurehead/boarding planks/armor)
- ⚔️ Real-time naval battles with boarding melee (dual health: hull & crew)
- 🚶 Land expeditions: go ashore, Dragon-Quest style turn-based battles,
  hero levels & equipment, 98 discovery sites
- 🧑‍🤝‍🧑 50 recruitable mates, 3 protagonists, port NPCs with dialog
- 🎵 Regional BGM (port/sea), sound effects

## Controls

| Key | Action |
|---|---|
| `W A S D` / arrows | sail / walk |
| `E` | enter port / building, talk to NPC |
| `G` | go ashore (near a discovery site) |
| `L` | land expedition / re-board ship |
| `Space` | fire broadside (naval battle) |
| `B` | boarding melee (naval battle) |
| `I` | Captain's Log (fleet/crew/cargo/quests…) |
| `Esc` | leave / set sail |
| `M` | toggle music |
| `` ` `` | developer mode |

## Run locally

```bash
cd game
python -m http.server 8734
# open http://127.0.0.1:8734
```

## Editor suite

`game/editor/` is a set of browser-based editors for the game data (no build
step, same conventions as the game). Serve `game/` as above and open
`http://127.0.0.1:8734/editor/`:

- **World map editor** (`map.html`) — paint the 2160×1080 `world_map.bin`
  with the day tileset: brush/rect/fill/eyedropper, wrap-aware, undo/redo,
  port & discovery overlays, import/export the .bin
- **Random map viewer** (`rando.html`) — preview the randomizer's generated
  world for any seed (identical to in-game generation), with port/discovery
  relocation preview and PNG export
- **Port map editor** (`portmap.html`) — edit the 101 96×96 port scenes in
  `portmaps.bin` with the correct per-port PORTCHIP tileset; building overlay
- **Ship editor** (`ships.html`) — all 22 ship types in `ships.json`, with
  ship image preview
- **Character editor** (`mates.html`) — 50 mates + 28 barmaids + the 4
  original characters (Isabella's companions, `mates_extra.json`), portrait
  picker over `figures.png` and the waifu portraits
- **Story editor** (`story.html`) — the 7 protagonists' main storylines in
  `story.json` (chapter name/goal/reward/text), with an in-game-style
  dialog preview
- **Hero/monster editor** (`hero.html`) — the CRPG layer: hero six-attribute
  stats, growth formulas (HP/SP/atk/def, exp curve, weapon/armor tiers,
  mate-skill leveling) in `heroes.json`, and the land-expedition monsters
  in `monsters.json` (with art picker), plus a live stat preview
- **Economy editor** (`goods.html`) — 13 regions × 46 goods price matrix and
  per-port specialties in `goods.json`
- **Port editor** (`ports.html`) — drag ports on the world map, edit
  region/tileset/maid/building positions (`ports.json` + `port_meta.json`)
- **Discovery/town/ruin editor** (`world.html`) — `villages.json` (with art
  picker), `towns.json`, `ruins.json`, click-to-place on the world map
- **Asset browser** (`assets.html`) — every tileset/sprite/portrait atlas,
  music & SFX player

Every editor loads from `assets/`, and exports the modified file as a
download — overwrite the file in `game/assets/` to apply. See
`game/editor/FORMATS.md` for the data format reference.

## Repository layout

- `game/` — the web game (static site, deployed via GitHub Pages)
  - `index.html`, `main.js`, `lib/three.module.js`, `assets/`
  - `editor/` — browser-based data editors (world map, port maps, ships,
    mates, economy, ports, discoveries, asset browser); see `editor/FORMATS.md`
- `tools/` — asset pipeline scripts (require a local clone of uw2ol in `./uw2ol`)
  - `prepare_assets.py` — world map, tiles, sprites, ports
  - `prepare_port_assets.py` — port maps, buildings, goods, ships, mates, music
- `tests/` — Playwright test suites
- `tests/screenshots/` — screenshots captured by the test runs
- `DESIGN.md` — design document
- `SESSION.md` — development session log

## Credits

All game assets are extracted from uw2ol, which took them from the original
Uncharted Waters 2 (Koei, 1993). Non-commercial fan/educational use only.

Port NPC characters: **Jephed, Game Between The Lines,
https://gamebetweenthelines.com/** (Top Down Pixel Art Characters pack,
free for commercial & non-commercial use).
