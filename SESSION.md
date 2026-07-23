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

### 7. 港口建筑交互（完整游戏循环）
- **Player state** (localStorage `uw-save-v1`): gold, fame+title
  (Squire…Duke), provisions/fatigue/hull (drain at sea per in-game day,
  penalties at 0), ship tiers (Sloop/Caravel/Galleon: speed/cargo/hull),
  cargo hold, bank balance (2% daily interest), telescope, quests,
  discoveries — all persisted.
- **Trade economy** straight from uw2ol data: 13 regional price tables
  (~46 goods each, `[buy, sell]`, 0 = not sold locally) + 67 port
  specialties (cheap at origin). Classic buy-low-sell-high.
- **All 12 buildings interactive**:
  harbor (provisions, set sail) · market (trade UI) · inn (rest) ·
  bar (discovery rumors) · dry_dock (repair, buy ships) ·
  palace (fame milestones → royal rewards) · job_house (delivery quests,
  targets filtered to ports that have a job house) · msc (discovery
  research quests, uw2ol-style) · bank (deposit/withdraw + interest) ·
  item_shop (telescope/rations/lime juice) · church (donation blessings) ·
  fortune_house (fortunes, rare jackpot)
- 21 automated checks (full quest cycles, trading math, persistence)
  + regression suite — all passing.
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

### 8. 开发者模式 + 小地图/市场修复
- **Dev mode** (backquote `` ` `` toggles): set gold (or +1M), override ship
  speed in tiles/s (persisted as `P.devSpeed`; reset restores ship default).
  Typing in the inputs doesn't trigger hotkeys (printable chars swallowed,
  Esc/` pass through so panels still close — fixed a real focus bug where
  the dev panel couldn't be closed while an input had focus).
- **Port minimap**: was drawn as 240×240 into a 240×120 canvas — the
  southern half of every port was cut off. Now stretched to fill the
  canvas; the whole port and the player dot show correctly (verified with
  Istanbul, whose city lies in the south).
- **Market filtering**: goods not sold at the current port no longer
  clutter the table; rows = locally sold goods (+ specialty) plus anything
  the player holds and can sell.

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

### 9. 货物图标/盈亏 + 22 种船 + 海战
- **Goods icons**: canvas-generated category badges (spice/food/fabric/
  cloth/special/arms/gem/metal colors + monogram) in the market table.
- **Profit tracking**: `P.cargoCost` records purchase cost; held goods show
  per-unit profit/loss next to the sell price (green `+n` / red `-n`), and
  every sale prints revenue plus green-profit / red-loss in the info line.
- **22 real ship types** from uw2ol's hash_ship_name_to_attributes
  (Balsa 1,200g → Full Rigged Ship 320,000g): speed from power, cargo from
  capacity, hull from durability, guns; sprite row by size. Dry dock opens
  a shipyard table to buy any of them (old 3-tier saves migrate).
- **Naval battles**: pirates spawn over time at sea (shown on the minimap),
  chase within 20 tiles and engage on contact. Real-time broadsides
  (SPACE, 2s cooldown, range 10), cannonballs with shoot/explosion sfx,
  hull bars HUD, enemy AI (close in, circle, flee under 25% hull).
  Sinking them loots gold + fame; losing means shipwreck (half gold and
  all cargo lost, limp to nearest port); outrun them past 25 tiles to
  escape; entering port shakes pursuers.
- Bug found in review: shipyard panel wasn't wired into Esc/E/panelOpen —
  fixed alongside.
### 10. 酒馆招募 + 船只图片 + 船舱 + 船装
- **Crew (sailors)**: hire/dismiss at the bar (100g each); ships have
  min/max crew — below min crew: speed x0.7, broadside x0.5.
- **Mates (航海士)**: 50 named characters from uw2ol's hash_mates (portrait
  from figures.png 65x81 cells, stats: navigation/gunnery/accounting +
  leadership/seamanship/luck). Each even-id port hosts one in its bar;
  hire cost scales with skills.
- **Cabins**: assign mates to Navigator (+5% speed/pt), Gunner
  (+10% damage/pt), Accountant (+5% sell price/pt) in the Mates & Cabins
  panel; one mate per cabin, dismiss anytime.
- **Ship images**: real 128x96 art per ship in the shipyard table.
- **Equipment (Outfit Ship at dry dock)**: sails x3 tiers (+5/10/15%
  speed), cannons x3 tiers (broadside x1.3/1.6/2.0), Ram (15 hull/s on
  contact), Figurehead (fatigue -50%, loot +25%), Boarding Planks
  (B captures crippled ships for prize money), Armor Plating
  (damage taken -25%). Tiered items unlock sequentially.
### 11. 舰队 + 船舱扩展 + 主角 + 信息菜单
- **Fleet (up to 5 ships)**: P.ship/P.hull refactored to P.fleet[]
  (flagship = [0]). Cargo = sum, speed = slowest, guns = sum, crew
  limits = sums. Shipyard: buy adds to fleet, sell at half price,
  "make flagship" swaps. Old saves migrate.
- **6 cabin types**: +Lookout (intuition: +0.5 tile discovery sight/pt),
  +Surgeon (knowledge: -5% fatigue/pt), +Boatswain (seamanship:
  -5% provisions/pt) alongside Navigator/Gunner/Accountant.
- **4 protagonists** (João Ferrero / Catalina Erantzo / Otto Baynes /
  Pietro Conti) with their own walk sprites from person_tileset's 4
  character blocks; selectable on the start screen.
- **Captain's Log (I)**: tabbed info menu — Fleet (ships with art,
  totals), Crew (sailors + cabins + mate cards), Outfit (owned
  equipment), Hero (protagonist, stats, personal items), Cargo
  (icons, qty, avg cost), Discoveries (art + descriptions), Quests
  (MSC/delivery/royal favor progress).
- Homing cannonballs (fights were decided by misses vs circling
  enemies); test-only debug hooks (debugHit/hurtEnemy) for
  deterministic checks in slow headless environments.
- Root-caused a long debugging session: headless SwiftShader runs rAF
  unthrottled making wall-clock-dependent tests flaky — game logic
  (2.5s cooldowns etc.) was correct all along (proven via fireBall
  instrumentation).
### 12. 主角修正 + 港口 NPC
- **Protagonist fix**: person_tileset cols 24-31 are NOT a 4th character —
  they're static npc pairs (agent 24-25, old man 26-27, dog 28-29, guard
  30-31). The picker now offers the 3 valid walk-sprite characters:
  João (cols 0-7), Catalina (woman npc, 8-15), Otto (man npc, 16-23).
- **Port NPCs** (from uw2ol's port_npc.py): 2 men + 2 women wander each
  port with proper 4-direction 2-frame walk animation and random-walk AI;
  static npcs idle-animate at entrances — dog at the bar, old man at the
  inn, agent at the market, guard at the palace. All hidden at night,
  like in uw2ol.
### 13. 接舷战 + 双生命（水手/船耐）
- **Dual health**: every ship (player fleet & pirates) has hull durability
  AND a crew pool. Cannon volleys damage hull plus crew casualties
  (30% for enemies, gentler 10% for the player). Hull 0 = sinking /
  shipwreck; crew 0 = capture / massacre.
- **Boarding melee (B, within 2.5 tiles)**: crew-vs-crew attrition rounds
  driven by best cabin-mate swordplay; Boarding Planks give +25%.
  Win -> capture the ship (joins fleet if <5, else prize money, fame +5);
  lose your crew -> shipwreck. Stalemates impose a 6s re-board lock.
  Aggressive pirates grapple and board when they outnumber you 1.5x —
  but only after an 8s grace period so you can flee or fight first.
- **Balance lessons from playtesting**: pirates now spawn with small
  crews (1-2x min crew) and player crew casualties are 10% (a fresh
  5-sailor Balsa used to get massacred by 2 volleys / instant board).
- Battle HUD shows hull AND crew for both sides.
- Test hardening: noAutoSpawn hook, poll-based waits, over-provisioned
  test flagships — headless SwiftShader crashes/throttles made
  wall-clock assertions flaky (game logic proven correct via
  fireBall/shipwreck instrumentation traces).
### 14. 陆地探险（勇者斗恶龙模式）
- **Landing (L)**: step ashore onto any adjacent land tile; the ship waits
  at anchor. Walk the world map on foot (land tiles walkable, water
  blocks), walk back to the ship and press L to re-board.
- **Random encounters**: while walking, wild beasts attack — Dragon-Quest
  style turn-based battles (Attack / Balm / Run) with a battle log,
  party HP bars, and the battle theme (battle.ogg).
- **Party**: the hero plus up to 3 mates (swordplay = attack). Hero
  levels up with exp (maxHp/atk/def grow); mates fight with their own
  HP/atk/def.
- **Hero equipment** (item shop): 3 weapon tiers (+4/8/14 atk), 3 armor
  tiers (+2/5/9 def), healing balms (30 HP in battle). Inn rest heals
  the whole party.
- **Monsters**: 8 tiers from the discoveries art (Prairie Dog → Blue
  Whale), scaled to hero level. Defeat = wake at the ship, 1 HP, -10%
  gold.
- **Discoveries by foot**: walking within 1.5 tiles of a site triggers
  the discovery — inland sites now genuinely require an expedition.
### 15. 港口 NPC 对话
- Walk up to any port NPC and press E to talk (hint shows "talk to …"):
  sailors ("Have you been to X?"), townswomen ("Do you like this place?
  …How about me?"), the dog ("Woof!"), the old man (his classic line +
  free discovery coordinates), the market agent (names the port's
  specialty AND the region that pays most for it, excluding home),
  the palace guard (reacts to your title). Wanderers pause while you
  chat. Dialog lines from uw2ol's role.py.
### 16. 开发者控制台（Dev Console）
- The dev panel (`` ` ``) is now a tabbed console:
  **Cheats** (gold, ship speed) · **Monsters** (all 8 wild monsters with
  art and stats) · **Mates** (all 50 mates with portrait, full stats, home
  port, hired mark) · **Discoveries** (all 98 sites with art, coords,
  description, found mark) · **Teleport** (dropdown of all 130 ports,
  teleports the fleet to the port's nearest sailable coast via the shared
  `sailableNear` helper, shaking off pursuers).
### 17. 船只属性完善 + 吧女
- **Ship attributes**: ships.json now carries tacking too; the shipyard
  table shows speed, tacking, cargo, hull, guns, crew (min-max) and price
  for all 22 ship types.
- **Bar maids (hash_maids)**: 28 named waitresses (maids.json + maid id
  per port in port_meta.json). Bars with a maid offer "Talk to the
  waitress" — she greets by name with her portrait and a submenu:
  Ask for info (real trade tip: a local good's best-paying region),
  Tell her a story (small fame chance), Buy her a drink (100g →
  discovery coordinates). Submenu persistence fixed by letting actions
  keep their custom menu (return true).
### 18. 船厂改装 + 同型复购
- Shipyard is now two sections: **Your fleet** (every ship instance with
  hull/guns/cargo/speed/mods and flagship/refit/sell buttons) and **Buy
  ships** (all 22 models, duplicates allowed — buy three Sloops if you like).
- **Per-ship refit**: each fleet ship can be upgraded independently in 4
  categories (guns/hull/cargo/speed), 3 levels each (+20% or +0.3 speed
  per level, 20% of the ship's price per level). `shipStats(f)` computes
  effective stats with mods; fleet totals (cargo/guns/speed) and the
  flagship's max hull all respect refits. Hull mods also add current hp.
### 19. 陆地城市 + 陆地遗迹 + 新发现物
- **12 new discovery sites** (villages.json 98 -> 110): Mount Fuji, Grand
  Canyon, Victoria Falls, Ayers Rock, Great Wall, Mount Everest, Niagara
  Falls, Lake Baikal, Iguazu Falls, Dead Sea, Matterhorn, Amazon River —
  using the 12 free art cells in the discoveries sheet; coords converted
  from real lon/lat and snapped to the nearest land tile.
- **14 land towns** (towns.json): Madrid, Paris, Vienna, Moscow, Kiev,
  Baghdad, Timbuktu, Delhi, Samarkand, Lhasa, Xi'an, Mexico City, Cuzco,
  Karakorum. Walk up (E) to enter the town panel: rest at the inn (full
  party heal), buy provisions, hear rumors (discovery coords). Blue dots
  on the land minimap.
- **10 explorable ruins** (ruins.json): Valley of Kings, Delphi, Petra,
  Angkor Wat, Ajanta Caves, Teotihuacan, Chichen Itza, Great Zimbabwe,
  Mohenjo-daro, Mogao Caves. Staged exploration (4 stages + sanctum):
  monsters (uses the DQ battle with an onEnd callback), traps, caches,
  and a final treasure (gold + exp + fame). 7-day re-explore cooldown
  (P.ruinCd). Purple dots on the land minimap.
### 20. 城镇可见性修复 + 小地图放大
- **Towns/ruins are now visible everywhere**: blue (towns) and purple
  (ruins) markers on the 3D world map (Points, like port markers) and on
  the minimap in every scene, not just land mode.
- **Enter radius** for towns/ruins widened from 2.5 to 4 tiles.
- **Double-click the minimap** to enlarge it (240x120 <-> 720x360, base
  map rebuilt at the new resolution).
- Bug found: the land branch of the E handler (town/ruin entry) had been
  lost in an earlier silent patch-replace failure; restored.
- Debug hooks: `landTo(x, z)` for tests.
### 21. UW3 陆地探险 + UW4 船舱
- **UW3-style land expeditions**: terrain bands by latitude (snow >55°,
  plains, desert 15-32°, jungle <15°). Walking on land drains provisions
  (heavy in desert/jungle) and builds fatigue (heavy in snow); starving
  costs hero HP daily. Land HUD shows terrain and food. High fatigue
  (>=90) weakens the hero's attack by 25% in land battles.
- **UW4-style cabins**: each ship has refittable cabin slots by size
  (2/3/4/5). 9 cabin types — Captain/Navigator/Deck/Gunnery/Purser/
  Lookout/Sick bay/Kitchen/Chapel — each driven by a different mate stat
  (leadership, navigation, seamanship, gunnery, accounting, intuition,
  knowledge, luck). Mates are assigned to specific ship cabins via
  dropdowns in the Mates panel (one mate per cabin). Cabin types can be
  changed at the dry dock for 500g. Old global-cabin saves migrate.
### 22. 老存档迁移修复 + 酒馆 21 点
- **Migration fix**: the pre-UW4 cabin migration ran before CABIN_COUNT /
  cabinKey were initialized (TDZ crash for old saves) and could assign
  several mates to one cabin, overwriting cabin types. Moved after the
  helpers and made slot allocation distinct (free-slot-first, retype as
  needed, overflow left unassigned).
- **Blackjack in the bar**: full 21-point mini-game — bet 50/100/500g,
  proper deck shuffle, soft aces, hidden hole card until stand, dealer
  draws to 17, payouts: blackjack 2.5x, win 2x, push 1x. Next hand or
  leave (Esc).
### 23. 德州扑克 + 卡牌点数修正
- **Texas Hold'em in the bar**: heads-up vs dealer AI. Blinds (player
  SB 10 / dealer BB 20), four streets (preflop/flop/turn/river), one
  decision per street (Fold / Check·Call / Raise 50), strength-based
  dealer AI, full 7-card hand evaluation (high card → straight flush
  with wheel and proper tiebreakers), split pots.
- **Card rank bug**: with ids suit*13+rank, bjValue/evalHand miscounted
  ranks (ace treated as 2, king as 14, ids >13 all counted 10 in
  blackjack). Shared `cardRank` helper fixes both games (ace-high).
### 24. 港口快捷面板 + 淡水港
- **Port quick bar**: a row of buttons at the bottom of the port scene
  (Market/Bar/Dock/Harbor/Inn/Palace/Jobs/MSC/Bank/Shop/Church/Fortune)
  opens each building instantly; hides while inside a building or in
  dialogs.
- **New port: Tamsui (淡水)**, id 131 at (1646,458) on the Taiwan coast.
  Uses Zeiton's China-town map (PORT_MAP_OVERRIDE) and tileset 4, Far
  East region (East Asia Sea music on set sail, China Town in port),
  10 buildings. Port count is now 131.
### 25. 港口发展度 + 投资占有率
- Every port has a development value (capitals 500, normal 200, supply
  100, Tamsui 150) tracked in `P.portDev[pid] = {dev, mine}` (persisted).
- Palace / governor: status button shows development + your share, and
  Invest 100/1000/10000g raises both dev and your contribution
  (+1 per 100g). Share = mine / dev.
- Share effects in that port's market: buy prices up to -10%, sell
  prices up to +10% (including specialties).
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
