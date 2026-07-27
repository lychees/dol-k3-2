#!/usr/bin/env python3
"""Decode GRAPH.DAT blocks (Koei EGA planar RLE) to PNG.

Format reverse-engineered from MAIN.EXE:
  Block = w(u16le) + h(u16le) + 16-byte lookup table (8x u16 4-pixel patterns)
          + control stream.
  Image is decoded into a 640-wide EGA 4-plane planar buffer (row stride =
  160 groups = 640 px). Each control byte produces `count` groups of 4 px.
  Literal 16-bit value ax=[n3 n2 n1 n0] is a 4x4 bit-plane matrix; pixel i
  color = bit(3-i) of n0..n3 combined (transpose).
"""
import sys
import numpy as np
from PIL import Image

STRIDE = 160  # groups per buffer row (640 px)


def u16(b, o):
    return b[o] | (b[o + 1] << 8)


def decode(blk):
    w = u16(blk, 0)
    h = u16(blk, 2)
    lookup = [u16(blk, 4 + i * 2) for i in range(8)]
    src = blk[20:]
    si = 0
    buf = [0] * (640 * h)
    di = 0
    gpr = w // 4  # groups per image row

    def put_group(p4):
        nonlocal di
        base = di * 4
        if base + 3 < len(buf):
            buf[base] = p4[0]
            buf[base + 1] = p4[1]
            buf[base + 2] = p4[2]
            buf[base + 3] = p4[3]
        di += 1

    rows = 0
    while rows < h and si < len(src):
        cx = gpr
        row_start = di
        while cx > 0 and si < len(src):
            al = src[si]; si += 1
            if al & 0x80:  # RUN
                count = (al & 0xF) + 1
                off_hi = (al & 0x30) >> 4
                offset = (off_hi + 1) * STRIDE if (al & 0x40) else (off_hi + 1)
                for _ in range(count):
                    s = (di - offset) * 4
                    d = di * 4
                    if d + 3 < len(buf):
                        for k in range(4):
                            buf[d + k] = buf[s + k] if 0 <= s + k < len(buf) else 0
                    di += 1
                cx -= count
            else:  # LITERAL
                count = (al & 7) + 1
                bits = al & 0x78
                if bits == 0:
                    ax = 0
                elif bits & 0x40:
                    ax = lookup[((bits >> 2) & 0xE) // 2]
                elif bits == 0x38:
                    ba = src[si]; bb = src[si + 1]; si += 2
                    ax = (ba << 8) | bb
                else:
                    d = src[si]; si += 1
                    lo = d & 0xF; hi = d >> 4
                    ax = {0x08: lo | (hi << 4),
                          0x10: lo | (hi << 8),
                          0x18: lo | (hi << 12),
                          0x20: (lo << 4) | (hi << 8),
                          0x28: (lo << 4) | (hi << 12),
                          0x30: (lo << 8) | (hi << 12)}[bits]
                n0 = ax & 0xF; n1 = (ax >> 4) & 0xF
                n2 = (ax >> 8) & 0xF; n3 = (ax >> 12) & 0xF
                p4 = [0, 0, 0, 0]
                for i in range(4):
                    b = 3 - i
                    p4[i] = (((n0 >> b) & 1) | (((n1 >> b) & 1) << 1)
                             | (((n2 >> b) & 1) << 2) | (((n3 >> b) & 1) << 3))
                for _ in range(count):
                    put_group(p4)
                cx -= count
        rows += 1
        di = row_start + STRIDE

    img = np.array(buf, 'uint8').reshape(h, 640)[:, :w]
    return w, h, img


# EGA default 16-color palette
EGA = [(0, 0, 0), (0, 0, 170), (0, 170, 0), (0, 170, 170),
       (170, 0, 0), (170, 0, 170), (170, 85, 0), (170, 170, 170),
       (85, 85, 85), (85, 85, 255), (85, 255, 85), (85, 255, 255),
       (255, 85, 85), (255, 85, 255), (255, 255, 85), (255, 255, 255)]


def render(img, pal):
    h, w = img.shape
    rgb = np.zeros((h, w, 3), 'uint8')
    for v in range(16):
        rgb[img == v] = pal[v]
    return rgb


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else 'Uncharted_Waters_2/GRAPH.DAT'
    outdir = sys.argv[2] if len(sys.argv) > 2 else None
    data = open(path, 'rb').read()
    n = int.from_bytes(data[:4], 'big') // 4
    offs = [int.from_bytes(data[i * 4:i * 4 + 4], 'big') for i in range(n)]
    if outdir:
        import os
        os.makedirs(outdir, exist_ok=True)
    cells = []
    for bi in range(n):
        blk = data[offs[bi]:offs[bi + 1] if bi + 1 < n else len(data)]
        try:
            w, h, img = decode(blk)
        except Exception as e:
            print('block', bi, 'FAILED', e)
            continue
        rgb = render(img, EGA)
        if outdir:
            Image.fromarray(rgb).save('%s/%02d.png' % (outdir, bi))
        cells.append((bi, w, h, rgb))
        print('block %2d: %3dx%-3d' % (bi, w, h))
    # contact sheet
    cw = 340
    cols = 5
    rows = (len(cells) + cols - 1) // cols
    sheet = np.zeros((rows * 130, cols * cw, 3), 'uint8')
    from PIL import ImageDraw
    for i, (bi, w, h, rgb) in enumerate(cells):
        im = Image.fromarray(rgb)
        s = min((cw - 10) / w, 120 / h, 3.0)
        im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.NEAREST)
        r, c = i // cols, i % cols
        a = np.array(im)
        sheet[r * 130 + 8:r * 130 + 8 + a.shape[0], c * cw + 5:c * cw + 5 + a.shape[1]] = a
    Image.fromarray(sheet).save('/tmp/graph_sheet.png')
    print('contact sheet -> /tmp/graph_sheet.png')


if __name__ == '__main__':
    main()
