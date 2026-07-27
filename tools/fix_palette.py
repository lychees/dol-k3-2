#!/usr/bin/env python3
"""Derive the correct DOS 16-color palette by aligning decoded GRAPH/OPGRAPH/
ENDGRP blocks (correct structure, wrong EGA-default colors) against DOSBox
screenshots (correct colors) via FFT edge template-matching, then sampling
value->color. Outputs game/assets/dos palette + re-colored images."""
import os
import numpy as np
from PIL import Image
from decode_graph import decode, EGA

SX, SY = 1.025, 1.22   # game-pixel -> screenshot-pixel scale (DOSBox 640x400 -> 656x488)
GAME_Y = 51            # screenshot y where game area starts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_blocks():
    """Return dict name -> (w,h,value-map np.uint8)."""
    blocks = {}
    def add_container(data, tag):
        n = int.from_bytes(data[:4], 'big') // 4
        offs = [int.from_bytes(data[i*4:i*4+4], 'big') for i in range(n)]
        for bi in range(n):
            blk = data[offs[bi]:offs[bi+1] if bi+1 < n else len(data)]
            try:
                w, h, img = decode(blk)
                blocks['%s_%02d' % (tag, bi)] = (w, h, img)
            except Exception:
                pass
    add_container(open(os.path.join(ROOT, 'Uncharted_Waters_2/GRAPH.DAT'), 'rb').read(), 'g')
    add_container(open(os.path.join(ROOT, 'Uncharted_Waters_2/ENDGRP.DAT'), 'rb').read(), 'e')
    opdir = os.path.join(ROOT, 'raw/OPGRAPH')
    for f in sorted(os.listdir(opdir)):
        add_container(open(os.path.join(opdir, f), 'rb').read(), f.replace('OPGRAPH.', 'op'))
    return blocks


def edges(arr):
    """Binary edge map: 1 where a horizontal/vertical neighbor differs."""
    a = arr.astype(np.int16)
    e = np.zeros(a.shape, np.float32)
    e[:, :-1] = np.maximum(e[:, :-1], (a[:, 1:] != a[:, :-1]).astype(np.float32))
    e[:-1, :] = np.maximum(e[:-1, :], (a[1:, :] != a[:-1, :]).astype(np.float32))
    return e


def lum_edges(rgb):
    lum = rgb.astype(np.float32).sum(axis=2)
    g = np.zeros(lum.shape, np.float32)
    gx = np.abs(np.diff(lum, axis=1))
    gy = np.abs(np.diff(lum, axis=0))
    g[:, :-1] = gx
    g[:-1, :] = np.maximum(g[:-1, :], gy)
    thr = np.percentile(g, 92)
    return (g > max(thr, 18)).astype(np.float32)


def fft_match(tpl, img):
    """Max overlap of tpl edges onto img edges. Returns (score, oy, ox)."""
    H, W = img.shape
    h, w = tpl.shape
    if h > H or w > W or tpl.sum() == 0:
        return 0.0, 0, 0
    fh, fw = H + h, W + w
    Fa = np.fft.rfft2(img, (fh, fw))
    Fb = np.fft.rfft2(tpl[::-1, ::-1], (fh, fw))
    corr = np.fft.irfft2(Fa * Fb, (fh, fw))
    # valid top-left offsets: oy in [0,H-h], ox in [0,W-w]
    valid = corr[:H - h + 1, :W - w + 1]
    iy, ix = np.unravel_index(np.argmax(valid), valid.shape)
    score = valid[iy, ix] / tpl.sum()
    return float(score), int(iy), int(ix)


def main():
    shots = {}
    for name in ['character-select', 'intro-ernst', 'character-stats', 'opening-ships']:
        p = os.path.join(ROOT, 'assets_dos/ui/%s.png' % name)
        if os.path.exists(p):
            rgb = np.array(Image.open(p).convert('RGB'))[GAME_Y:, :, :]
            shots[name] = rgb
    print('screenshots:', list(shots))
    blocks = load_blocks()
    print('blocks:', len(blocks))

    samples = {}   # value -> list of RGB
    matches = []
    for bname, (w, h, img) in sorted(blocks.items()):
        if w < 150 or h < 60:   # large scenes only (avoid spurious small-block matches)
            continue
        rw, rh = max(1, round(w * SX)), max(1, round(h * SY))
        tpl_img = np.array(Image.fromarray(img).resize((rw, rh), Image.NEAREST))
        te = edges(tpl_img)
        if te.sum() < 30:
            continue
        best = None
        for sname, srgb in shots.items():
            se = lum_edges(srgb)
            score, oy, ox = fft_match(te, se)
            if best is None or score > best[0]:
                best = (score, sname, oy, ox, rw, rh)
        score, sname, oy, ox, rw, rh = best
        if score > 0.55:
            matches.append((score, bname, sname, oy, ox))
            srgb = shots[sname]
            region = srgb[oy:oy + rh, ox:ox + rw]
            for v in range(16):
                m = tpl_img == v
                if m.sum() > 20:
                    samples.setdefault(v, []).append(np.median(region[m], axis=0))
    matches.sort(reverse=True)
    print('\n=== matches (score, block, shot, y, x) ===')
    for m in matches[:40]:
        print('  %.2f  %-12s %-16s y=%d x=%d' % m)

    print('\n=== derived palette (value -> RGB, #samples) ===')
    palette = {}
    for v in range(16):
        if v in samples:
            med = np.median(np.array(samples[v]), axis=0).astype(int)
            palette[v] = tuple(med)
            print('  %2d -> (%3d,%3d,%3d)  n=%d' % (v, med[0], med[1], med[2], len(samples[v])))
    np.save(os.path.join(ROOT, 'tools/dos_palette.npy'),
            np.array([palette.get(v, EGA[v]) for v in range(16)], np.uint8))
    print('\nsaved tools/dos_palette.npy')


if __name__ == '__main__':
    main()
