#!/usr/bin/env python3
"""Full DOS 16-color palette: values 0-7 from GRAPH block6<->SNES market,
values 8-15 from DOS ships (GRAPH 28-52) <-> SNES ships (cost-matched)."""
import os
import numpy as np
from PIL import Image
from collections import Counter
from decode_graph import decode, EGA

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def graph_blocks():
    data = open(os.path.join(ROOT, 'Uncharted_Waters_2/GRAPH.DAT'), 'rb').read()
    n = int.from_bytes(data[:4], 'big') // 4
    offs = [int.from_bytes(data[i*4:i*4+4], 'big') for i in range(n)]
    return {bi: decode(data[offs[bi]:offs[bi+1] if bi+1 < n else len(data)])
            for bi in range(n)}


def align(dos, snes_rgb):
    """Return (cost_per_px, {value: modecolor}). dos & snes same size (resize if needed)."""
    h, w = dos.shape
    if snes_rgb.shape[1] != w or snes_rgb.shape[0] != h:
        snes_rgb = np.array(Image.fromarray(snes_rgb).resize((w, h), Image.NEAREST))
    best = None
    sh, sw = snes_rgb.shape[:2]
    for oy in range(0, sh - h + 1):
        for ox in range(0, sw - w + 1):
            reg = snes_rgb[oy:oy + h, ox:ox + w]
            cost, cnt = 0, 0
            for v in range(16):
                m = dos == v
                c = m.sum()
                if c < 30:
                    continue
                mode = Counter(map(tuple, reg[m])).most_common(1)[0][0]
                cost += np.abs(reg[m] - np.array(mode)).sum()
                cnt += c
            cpp = cost / max(cnt, 1)
            if best is None or cpp < best[0]:
                best = (cpp, oy, ox)
    cpp, oy, ox = best
    reg = snes_rgb[oy:oy + h, ox:ox + w]
    pal = {v: Counter(map(tuple, reg[dos == v])).most_common(1)[0][0]
           for v in range(16) if (dos == v).sum() > 30}
    return cpp, pal


def main():
    blocks = graph_blocks()
    samples = {}

    # values 0-7 from block6 <-> market
    w, h, dos6 = blocks[6]
    market = np.array(Image.open(os.path.join(ROOT, 'game/assets/buildings/market.png')).convert('RGB'))
    _, pal6 = align(dos6, market)
    print('block6<->market:', {v: pal6[v] for v in sorted(pal6)})
    for v, rgb in pal6.items():
        samples.setdefault(v, []).append(rgb)

    # values 8-15 from ships
    sdir = os.path.join(ROOT, 'game/assets/ships')
    snes_ships = {f[:-4]: np.array(Image.open(os.path.join(sdir, f)).convert('RGB'))
                  for f in os.listdir(sdir)}
    for bi in range(28, 53):
        if bi not in blocks:
            continue
        w, h, dos = blocks[bi]
        best, bname, bpal = None, None, None
        for name, sr in snes_ships.items():
            cpp, pal = align(dos, sr)
            if best is None or cpp < best:
                best, bname, bpal = cpp, name, pal
        print('ship block %2d -> %-18s cost %.1f vals %s' % (bi, bname, best, sorted(bpal)))
        for v, rgb in bpal.items():
            samples.setdefault(v, []).append(rgb)

    print('\n=== full palette ===')
    palette = {v: EGA[v] for v in range(16)}
    for v in range(16):
        if v in samples:
            palette[v] = Counter(samples[v]).most_common(1)[0][0]
        print('  %2d -> %s' % (v, palette[v]))
    np.save(os.path.join(ROOT, 'tools/dos_palette.npy'),
            np.array([palette[v] for v in range(16)], np.uint8))
    print('saved tools/dos_palette.npy')


if __name__ == '__main__':
    main()
