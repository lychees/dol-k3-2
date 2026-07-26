#!/usr/bin/env python3
"""Decompress Koei LS11/Ls12 .LZW archives from the DOS version of
Uncharted Waters 2 into raw part files: raw/<NAME>/<NAME>.NNN

Format (reverse engineered by tzengyuxio/kaodata, dekoei/ls11.py):
  0x00  'LS11' magic
  0x10  256-byte dictionary
  then  part table: repeated (compressed_size u32be, uncompressed_size u32be,
        offset u32be) until a zero u32; each part is independently compressed
        with an LZW variant (variable-length gamma-ish codes).
This pure-python port avoids the bitarray dependency.
"""
import os
import sys


def get_codes(data: bytes) -> list:
    codes = []
    nbits = len(data) * 8

    def bit(i):
        return (data[i >> 3] >> (7 - (i & 7))) & 1

    mask_len, pos = 0, 0
    while pos < nbits:
        b = bit(pos)
        mask_len += 1
        pos += 1
        if not b:
            mask = (1 << mask_len) - 2
            factor = 0
            for _ in range(mask_len):
                factor = (factor << 1) | bit(pos)
                pos += 1
            codes.append(mask + factor)
            mask_len = 0
    return codes


def recover(codes, dictionary: bytes) -> bytes:
    out = bytearray()
    delta = 0
    for code in codes:
        if delta > 0:
            for _ in range(3 + code):
                p = len(out) - delta
                out.append(out[p] if 0 <= p < len(out) else 0)
            delta = 0
        elif code < 256:
            out.append(dictionary[code])
        else:
            delta = code - 256
    return bytes(out)


def decode_parts(data: bytes) -> list:
    if data[:4] not in (b'LS10', b'LS11', b'Ls12'):
        raise ValueError('not an LS1x archive')
    dictionary = data[16:272]
    pos = 272
    infos = []
    while data[pos:pos + 4] != b'\x00\x00\x00\x00':
        cs = int.from_bytes(data[pos:pos + 4], 'big')
        us = int.from_bytes(data[pos + 4:pos + 8], 'big')
        off = int.from_bytes(data[pos + 8:pos + 12], 'big')
        infos.append((cs, us, off))
        pos += 12
    parts = []
    for cs, us, off in infos:
        comp = data[off:off + cs]
        if cs == us:
            parts.append(comp)
        else:
            parts.append(recover(get_codes(comp), dictionary)[:us])
    return parts


def main():
    src, dst = sys.argv[1], sys.argv[2]   # e.g. Uncharted_Waters_2 -> raw
    os.makedirs(dst, exist_ok=True)
    for fname in sorted(os.listdir(src)):
        if not fname.upper().endswith('.LZW'):
            continue
        name = os.path.splitext(fname)[0].upper()
        data = open(os.path.join(src, fname), 'rb').read()
        parts = decode_parts(data)
        outdir = os.path.join(dst, name)
        os.makedirs(outdir, exist_ok=True)
        for i, part in enumerate(parts):
            out = os.path.join(outdir, f'{name}.{i:03}')
            with open(out, 'wb') as f:
                f.write(part)
        print(f'{fname}: {len(parts)} parts -> {outdir}/')


if __name__ == '__main__':
    main()
