"""Export port maps, buildings, villages and images from uw2ol to web assets."""
import json
import os
import shutil
import sys

UW = 'uw2ol'
OUT = 'game/assets'

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

# --- 3. port meta: tileset + buildings per port ----------------------------
meta = {}
for pid, p in hash_ports_meta_data.items():
    if not isinstance(p, dict) or 'buildings' not in p:
        continue
    meta[pid] = {
        'name': p['name'],
        'tileset': p['tileset'],
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

# --- 7. music: a few port themes + building themes --------------------------
os.makedirs(f'{OUT}/music/port', exist_ok=True)
os.makedirs(f'{OUT}/music/building', exist_ok=True)
for m in ['Lisbon.mp3', 'London.mp3', 'Seville.mp3', 'Venice.mp3',
          'Northern Europe Town.mp3', 'Southern Europe Town.mp3',
          'Middle Eastern Town.mp3', 'African Town.mp3', 'China Town.mp3',
          'Japan Town.mp3', 'Indian Town.mp3', 'Central America Town.mp3',
          'South America Town.mp3', 'Oceania Town.mp3', 'Amsterdam.mp3',
          'Marseille.mp3']:
    src = f'{UW}/assets/sounds/music/port/{m}'
    if os.path.exists(src):
        shutil.copy(src, f'{OUT}/music/port/{m}')
for m in ['bar.mp3', 'church.mp3', 'palace.mp3']:
    shutil.copy(f'{UW}/assets/sounds/music/building/{m}', f'{OUT}/music/building/{m}')
print('music copied')
print('DONE')
