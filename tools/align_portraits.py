#!/usr/bin/env python3
"""Targeted palette derivation: align decoded hero portraits (value maps) with
correctly-colored faces in DOSBox screenshots via color-consistency search."""
import os
import numpy as np
from PIL import Image
from decode_graph import decode, EGA

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_block(path, bi):
    data = open(path, 'rb').read()
    n = int.from_bytes(data[:4], 'big') // 4
    offs = [int.from_bytes(data[i*4:i*4+4], 'big') for i in range(n)]
    blk = data[offs[bi]:offs[bi+1] if bi+1 < n else len(data)]
    return decode(blk)


def cost_and_colors(region, bmap):
    """For aligned bmap over region: per-value color spread (lower=better) + median colors."""
    total = 0.0
    colors = {}
    for v in range(16):
        m = bmap == v
        c = m.sum()
        if c < 15:
            continue
        px = region[m].astype(np.float32)
        med = np.median(px, axis=0)
        colors[v] = med
        total += (np.abs(px - med).mean() * c)
    return total, colors


def search(region, bmap):
    """Search scale+offset of bmap within region. Returns (cost, colors, info)."""
    RH, RW = region.shape[:2]
    bh, bw = bmap.shape
    best = None
    for s in np.arange(0.55, 1.05, 0.05):
        rw, rh = max(4, round(bw * s)), max(4, round(bh * s))
        if rw > RW or rh > RH:
            continue
        b = np.array(Image.fromarray(bmap).resize((rw, rh), Image.NEAREST))
        for oy in range(0, RH - rh + 1, 2):
            for ox in range(0, RW - rw + 1, 2):
                c, cols = cost_and_colors(region[oy:oy + rh, ox:ox + rw], b)
                if best is None or c < best[0]:
                    best = (c, cols, (s, oy, ox, rw, rh))
    return best


def main():
    # (screenshot, crop box x0,y0,x1,y1) regions containing a single hero face
    regions = {
        'ernst': ('intro-ernst', (175, 160, 310, 290)),
        'stats_joao': ('character-stats', (185, 315, 270, 390)),
        'cs_redhead': ('character-select', (105, 370, 190, 470)),
        'cs_whitehair': ('character-select', (185, 140, 265, 235)),
    }
    cands = ['op005_07', 'op007_04', 'op008_04', 'op009_04', 'op012_04']
    blocks = {}
    for c in cands:
        part, bi = c.rsplit('_', 1)
        w, h, img = load_block(os.path.join(ROOT, 'raw/OPGRAPH/OPGRAPH.%s' % part[2:]), int(bi))
        blocks[c] = img
        print(c, w, h)

    samples = {}
    for rname, (shot, box) in regions.items():
        p = os.path.join(ROOT, 'assets_dos/ui/%s.png' % shot)
        if not os.path.exists(p):
            continue
        region = np.array(Image.open(p).convert('RGB').crop(box))
        for c in cands:
            r = search(region, blocks[c])
            if r:
                cost, cols, info = r
                # normalized cost per pixel
                print('%s vs %s: cost=%.0f scale=%.2f off=%s' % (rname, c, cost, info[0], info[1:3]))


if __name__ == '__main__':
    main()
