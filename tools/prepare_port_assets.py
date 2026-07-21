"""Export port maps, buildings, villages and images from uw2ol to web assets."""
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UW = os.path.join(ROOT, 'uw2ol')
OUT = os.path.join(ROOT, 'game', 'assets')

sys.path.append(os.path.join(UW, 'code/common'))
from hashes.hash_ports_meta_data import hash_ports_meta_data
from hashes.hash_villages import villages_dict
from hashes.look_up_tables import id_2_building_type

os.makedirs(f'{OUT}/portchips', exist_ok=True)
os.makedirs(f'{OUT}/buildings', exist_ok=True)

# --- 1. port tilesets: 7 chipsets x 4 phases -------------------------------
TILESET_FILES = ['000', '002', '004', '006', '008', '010', '012']
PHASES = ['dawn', 'day', 'dusk', 'night']
for ts in TILESET_FILES:
    for ph in PHASES:
        src = f'{UW}/assets/images/ports/PORTCHIP.{ts}  {ph}.png'
        shutil.copy(src, f'{OUT}/portchips/{ts}_{ph}.png')
print('portchips copied')

# --- 2. all 101 port maps packed into one bin (96*96 bytes each) -----------
with open(f'{OUT}/portmaps.bin', 'wb') as out:
    for i in range(101):
        with open(f'{UW}/assets/images/ports/PORTMAP.{i:03d}', 'rb') as f:
            data = f.read()
        assert len(data) == 96 * 96, (i, len(data))
        out.write(data)
print('portmaps.bin written')

# --- 3. port meta: tileset + buildings + region per port -------------------
MARKETS = hash_ports_meta_data['markets']
meta = {}
for pid, p in hash_ports_meta_data.items():
    if not isinstance(p, dict) or 'buildings' not in p:
        continue
    meta[pid] = {
        'name': p['name'],
        'tileset': p['tileset'],
        'region': MARKETS[p['economyId']] if 'economyId' in p else None,
        'buildings': {int(k): [v['x'], v['y']] for k, v in p['buildings'].items()},
    }
with open(f'{OUT}/port_meta.json', 'w') as f:
    json.dump(meta, f)
print('port_meta.json:', len(meta), 'ports')

# --- 4. building id -> name -------------------------------------------------
with open(f'{OUT}/building_names.json', 'w') as f:
    json.dump({int(k): v for k, v in id_2_building_type.items()}, f)

# --- 5. villages / discoveries ---------------------------------------------
vil = []
for vid, v in villages_dict.items():
    vil.append({
        'id': int(vid), 'name': v['name'], 'x': v['x'], 'y': v['y'],
        'desc': v.get('description', ''),
        'img': [v.get('image_x', 1), v.get('image_y', 1)],
    })
with open(f'{OUT}/villages.json', 'w') as f:
    json.dump(vil, f)
print('villages.json:', len(vil), 'discoveries')

# --- 6. images --------------------------------------------------------------
shutil.copy(f'{UW}/assets/images/player/person_tileset.png', f'{OUT}/person-tileset.png')
shutil.copy(f'{UW}/assets/images/discoveries_and_items/discoveries_and_items.png',
            f'{OUT}/discoveries.png')
for name in set(id_2_building_type.values()):
    src = f'{UW}/assets/images/buildings/{name}.PNG'
    if os.path.exists(src):
        shutil.copy(src, f'{OUT}/buildings/{name}.png')
    else:
        print('missing building image:', name)
print('images copied')

# --- 7. music: all regional port/sea themes + building themes + effects ----
os.makedirs(f'{OUT}/music/port', exist_ok=True)
os.makedirs(f'{OUT}/music/sea', exist_ok=True)
os.makedirs(f'{OUT}/music/building', exist_ok=True)
os.makedirs(f'{OUT}/sounds', exist_ok=True)
PORT_MUSIC = ['Lisbon.mp3', 'Seville.mp3', 'London.mp3', 'Marseille.mp3',
              'Amsterdam.mp3', 'Venice.mp3', 'African Town.mp3',
              'Middle Eastern Town.mp3', 'Northern Europe Town.mp3',
              'Southern Europe Town.mp3', 'Central America Town.mp3',
              'South America Town.mp3', 'Indian Town.mp3', 'China Town.mp3',
              'Japan Town.mp3', 'Oceania Town.mp3', 'Southeast Asian Town.ogg']
for m in PORT_MUSIC:
    src = f'{UW}/assets/sounds/music/port/{m}'
    if os.path.exists(src):
        shutil.copy(src, f'{OUT}/music/port/{m}')
    else:
        print('missing port music:', m)
SEA_MUSIC = ['African Sea.mp3', 'American Sea.mp3', 'Atlantic Ocean.mp3',
             'East Asia Sea.mp3', 'Indian Ocean.mp3', 'Mediterranean.mp3',
             'North Sea.mp3', 'Pacific.mp3', 'Southeast Asian Sea.ogg']
for m in SEA_MUSIC:
    src = f'{UW}/assets/sounds/music/sea/{m}'
    if os.path.exists(src):
        shutil.copy(src, f'{OUT}/music/sea/{m}')
    else:
        print('missing sea music:', m)
for m in ['sea.ogg', 'sea_1.ogg', 'port.ogg']:
    shutil.copy(f'{UW}/assets/sounds/music/{m}', f'{OUT}/music/{m}')
for m in ['bar.mp3', 'church.mp3', 'palace.mp3']:
    shutil.copy(f'{UW}/assets/sounds/music/building/{m}', f'{OUT}/music/building/{m}')
shutil.copy(f'{UW}/assets/sounds/effect/discover.ogg', f'{OUT}/sounds/discover.ogg')
shutil.copy(f'{UW}/assets/sounds/effect/wave.ogg', f'{OUT}/sounds/wave.ogg')
# --- 8. trade goods: per-region price tables + port specialties -------------
from hashes.hash_markets_price_details import hash_markets_price_details
from hashes.hash_special_goods import hash_special_goods

goods = {}
for econ_id, table in hash_markets_price_details.items():
    if not isinstance(table, dict) or 'Available_items' not in table:
        continue
    region = MARKETS[econ_id]
    table = {k: v for k, v in table.items()
             if isinstance(v, list) and len(v) == 2 and isinstance(v[0], (int, float))}
    available = {k: v for k, v in table.items() if v[0] > 0}
    goods[region] = {'available': available, 'prices': table}

specialties = {}
for pid, s in hash_special_goods.items():
    if s.get('specialty') and s['specialty'] != '0':
        specialties[int(pid)] = {'name': s['specialty'], 'price': s['price']}

with open(f'{OUT}/goods.json', 'w') as f:
    json.dump({'regions': goods, 'specialties': specialties}, f)
print('goods.json:', len(goods), 'regions,', len(specialties), 'specialties')
# --- 9. ships + battle sounds ------------------------------------------------
from hashes.hash_ship_name_to_attributes import hash_ship_name_to_attributes
ships = {name: {'durability': a['durability'], 'power': a['power'],
                'capacity': a['capacity'], 'guns': a['max_guns'],
                'min_crew': a['min_crew'], 'max_crew': a['max_crew'],
                'price': a['price']}
         for name, a in hash_ship_name_to_attributes.items()}
with open(f'{OUT}/ships.json', 'w') as f:
    json.dump(ships, f)
print('ships.json:', len(ships), 'ships')
for m in ['shoot.ogg', 'explosion.ogg', 'engage.ogg']:
    shutil.copy(f'{UW}/assets/sounds/effect/{m}', f'{OUT}/sounds/{m}')
print('battle sounds copied')

# --- 10. mates + ship images + figures ---------------------------------------
from hashes.hash_mates import hash_mates
mates = {int(k): {'name': v['name'], 'nation': v['nation'], 'lv': v['lv'],
                  'leadership': v['leadership'], 'seamanship': v['seamanship'],
                  'knowledge': v['knowledge'], 'intuition': v['intuition'],
                  'courage': v['courage'], 'swordplay': v['swordplay'],
                  'luck': v['luck'], 'accounting': v['accounting'],
                  'gunnery': v['gunnery'], 'navigation': v['navigation'],
                  'image': v['image_x'] and [v['image_x'], v['image_y']] or None}
         for k, v in hash_mates.items()}
with open(f'{OUT}/mates.json', 'w') as f:
    json.dump(mates, f)
print('mates.json:', len(mates), 'mates')

os.makedirs(f'{OUT}/ships', exist_ok=True)
for name in ships:
    src = f"{UW}/assets/images/ships/{name.lower()}.png"
    if os.path.exists(src):
        shutil.copy(src, f'{OUT}/ships/{name.lower()}.png')
    else:
        print('missing ship image:', name)
shutil.copy(f'{UW}/assets/images/figures/figures.png', f'{OUT}/figures.png')
print('ship images + figures copied')
print('DONE')
