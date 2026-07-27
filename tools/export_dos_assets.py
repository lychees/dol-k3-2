#!/usr/bin/env python3
"""Export recolored DOS assets (hero portraits, UI elements, scenes) to
game/assets/dos/ using the derived palette (tools/dos_palette.npy)."""
import os
import numpy as np
from PIL import Image
from decode_graph import decode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'game/assets/dos')
os.makedirs(OUT, exist_ok=True)
PAL = np.load(os.path.join(ROOT, 'tools/dos_palette.npy'))


def render(img):
    h, w = img.shape
    rgb = np.zeros((h, w, 3), 'uint8')
    for v in range(16):
        rgb[img == v] = PAL[v]
    return rgb


def load_graph(bi):
    d = open(os.path.join(ROOT, 'Uncharted_Waters_2/GRAPH.DAT'), 'rb').read()
    n = int.from_bytes(d[:4], 'big') // 4
    o = [int.from_bytes(d[i*4:i*4+4], 'big') for i in range(n)]
    return decode(d[o[bi]:o[bi+1] if bi+1 < n else len(d)])


def load_op(part, bi):
    d = open(os.path.join(ROOT, 'raw/OPGRAPH/OPGRAPH.%03d' % part), 'rb').read()
    n = int.from_bytes(d[:4], 'big') // 4
    o = [int.from_bytes(d[i*4:i*4+4], 'big') for i in range(n)]
    return decode(d[o[bi]:o[bi+1] if bi+1 < n else len(d)])


def save(img, name):
    Image.fromarray(render(img)).save(os.path.join(OUT, name + '.png'))
    print('  %s  %dx%d' % (name, img.shape[1], img.shape[0]))


# hero portraits (op_part, op_bi, hero key)
HEROES = [(5, 7, 'otto'), (7, 4, 'catalina'), (8, 4, 'hero_b1'),
          (9, 4, 'hero_b2'), (12, 4, 'hero_b3')]
# UI elements (graph block, name)
UI = [(0, 'yesno'), (23, 'dialogbox')]
# scenes (graph block, name)
SCENES = [(27, 'tavern')]

print('heroes:')
for part, bi, name in HEROES:
    w, h, img = load_op(part, bi)
    save(img, 'hero_' + name)
print('ui:')
for bi, name in UI:
    w, h, img = load_graph(bi)
    save(img, 'ui_' + name)
print('scenes:')
for bi, name in SCENES:
    w, h, img = load_graph(bi)
    save(img, 'scene_' + name)
print('done -> game/assets/dos/')
