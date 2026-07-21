"""Extract web-ready assets from the uw2ol repo for the three.js game."""
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "uw2ol", "assets")
DST = os.path.join(ROOT, "game", "assets")

os.makedirs(DST, exist_ok=True)

# --- 1. world map piddle -> raw binary (2160 x 1080 bytes, row-major) ---
COLS, ROWS = 2160, 1080
with open(f"{SRC}/images/world_map/w_map_piddle_array.txt") as f:
    nums = f.read().split(",")
assert len(nums) == COLS * ROWS, len(nums)
data = bytes(int(n) for n in nums)
with open(f"{DST}/world_map.bin", "wb") as f:
    f.write(data)
print("world_map.bin", len(data))

# --- 2. tilesets (4 times of day) + ship tileset ---
for name in ["dawn", "day", "dusk", "night"]:
    shutil.copy(f"{SRC}/images/world_map/{name}.png", f"{DST}/tiles_{name}.png")
shutil.copy(f"{SRC}/images/player/ship-tileset.png", f"{DST}/ship-tileset.png")
print("tilesets copied")

# --- 3. ports metadata -> ports.json ---
# parse hash_ports_meta_data.py (a python dict literal) for name/x/y
text = open("uw2ol/code/common/hashes/hash_ports_meta_data.py", encoding="utf-8").read()
ports = []
# split into per-port blocks keyed by "N: {"
for m in re.finditer(r"(\d+):\s*\{(.*?)\n\t\}", text, re.S):
    pid, block = int(m.group(1)), m.group(2)
    name = re.search(r"'name':\s*'([^']+)'", block)
    x = re.search(r"'x':\s*(\d+)", block)
    y = re.search(r"'y':\s*(\d+)", block)
    if name and x and y:
        ports.append({"id": pid, "name": name.group(1),
                      "x": int(x.group(1)), "y": int(y.group(1))})
ports.sort(key=lambda p: p["id"])
with open(f"{DST}/ports.json", "w") as f:
    json.dump(ports, f, indent=1)
print("ports.json", len(ports), "ports")

# --- 4. a couple of sea music tracks ---
os.makedirs(f"{DST}/music/sea", exist_ok=True)
for track in ["Mediterranean.mp3", "Atlantic Ocean.mp3", "North Sea.mp3"]:
    shutil.copy(f"{SRC}/sounds/music/sea/{track}", f"{DST}/music/sea/{track}")
print("music copied")
