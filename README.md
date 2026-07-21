# Uncharted Waters — three.js voyage

A browser sailing game built with **three.js**, using assets from the
[uw2ol](https://github.com/timewarpsgh/uw2ol) project
(a fan remake of *Uncharted Waters 2*, Koei 1993).

**Play online: https://lychees.github.io/dol-k3-2/game/**

## Features

- 🗺️ The full 2160×1080-tile world map rendered with a custom tilemap shader
- 🌅 Day/night cycle cross-fading the original dawn/day/dusk/night tilesets
- ⛵ Sail with WASD/arrow keys, animated ship sprite, coast collision
- ⚓ Enter all **130 ports**: walk the streets with the original person sprite,
  visit 12 kinds of buildings (market, bar, inn, palace, church, …)
- 🗿 Go ashore near **98 discovery sites** (Stonehenge, Moai, …) with original
  artwork and descriptions
- 🧭 Lon/lat HUD, live minimap (world & port), port/building music

## Controls

| Key | Action |
|---|---|
| `W A S D` / arrows | sail / walk |
| `E` | enter port / enter building |
| `G` | go ashore (near a discovery site) |
| `Esc` | leave building / set sail |
| mouse wheel | zoom |
| `M` | toggle music |

## Run locally

```bash
cd game
python -m http.server 8734
# open http://127.0.0.1:8734
```

## Repository layout

- `game/` — the web game (static site, deployed via GitHub Pages)
- `prepare_assets.py`, `prepare_port_assets.py` — asset export scripts
  (require a local clone of uw2ol in `./uw2ol`)
- `test_final.py`, `test_port.py` — Playwright smoke tests
- `SESSION.md` — development session log

## Credits

All game assets are extracted from uw2ol, which took them from the original
Uncharted Waters 2 (Koei, 1993). Non-commercial fan/educational use only.
