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

## Repository layout

- `game/` — the web game (static site, deployed via GitHub Pages)
  - `index.html`, `main.js`, `lib/three.module.js`, `assets/`
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
