#!/usr/bin/env python3
"""Per-hero portrait palette: align each DOS hero portrait (value map) with its
correctly-colored char-select headshot via normalized color-consistency search."""
import os
import numpy as np
from PIL import Image
from decode_graph import decode

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_op(part, bi):
    d = open(os.path.join(ROOT, 'raw/OPGRAPH/OPGRAPH.%03d' % part), 'rb').read()
    n = int.from_bytes(d[:4], 'big') // 4
    o = [int.from_bytes(d[i*4:i*4+4], 'big') for i in range(n)]
    return decode(d[o[bi]:o[bi+1] if bi+1 < n else len(d)])


def ncc(region, bmap):
    """normalized color-consistency cost + per-value median color."""
    total, cnt = 0.0, 0
    colors = {}
    for v in range(16):
        m = bmap == v
        c = int(m.sum())
        if c < 10:
            continue
        px = region[m].astype(np.float32)
        med = np.median(px, axis=0)
        colors[v] = med
        total += np.abs(px - med).mean() * c
        cnt += c
    return (total / max(cnt, 1)), colors


def search(region, bmap):
    RH, RW = region.shape[:2]
    bh, bw = bmap.shape
    best = None
    for s in np.arange(0.5, 1.4, 0.05):
        rw, rh = max(4, round(bw * s)), max(4, round(bh * s))
        if rw > RW or rh > RH:
            continue
        b = np.array(Image.fromarray(bmap).resize((rw, rh), Image.NEAREST))
        for oy in range(0, RH - rh + 1, 2):
            for ox in range(0, RW - rw + 1, 2):
                c, cols = ncc(region[oy:oy + rh, ox:ox + rw], b)
                if best is None or c < best[0]:
                    best = (c, cols, (round(s, 2), oy, ox))
    return best


# hero -> (op_part, op_bi, char-select headshot crop box x0,y0,x1,y1)
HEROES = {
    'otto': (5, 7, (185, 140, 270, 240)),
    'catalina': (7, 4, (105, 370, 195, 475)),
}


def main():
    cs = np.array(Image.open(os.path.join(ROOT, 'assets_dos/ui/character-select.png')).convert('RGB'))
    for name, (part, bi, box) in HEROES.items():
        w, h, img = load_op(part, bi)
        region = cs[box[1]:box[3], box[0]:box[2]]
        cost, cols, info = search(region, img)
        print('%s: cost=%.1f scale=%.2f off=(%d,%d)' % (name, cost, info[0], info[1], info[2]))
        for v in sorted(cols):
            print('   val %2d -> (%3d,%3d,%3d)' % (v, *cols[v].astype(int)))


if __name__ == '__main__':
    main()
