#!/usr/bin/env python3
"""Holographic-foil PNG generator — pure stdlib, no deps.

Iridescent full-spectrum sweep with oil-slick warping, bright light streaks and fine
grain. No native Figma paint does this; apply the output with `set_image` (FILL).

  python3 holographic.py --width 640 --height 640 --out holo.png
"""
import argparse, colorsys, math, struct, zlib, random


def write_png(path, w, h, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def clamp8(v):
    return 0 if v < 0 else 255 if v > 255 else int(v + 0.5)


def build(width, height, seed, sat_base, grain, cycles):
    rnd = random.Random(seed)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        ny = y / (height - 1)
        for x in range(width):
            nx = x / (width - 1)
            # diagonal sweep + two-wave oil-slick warp -> iridescent hue flow
            d = nx * 0.7 + ny * 0.7
            warp = (0.10 * math.sin((nx * 3.1 + ny * 1.7) * math.tau)
                    + 0.06 * math.sin((nx * 1.3 - ny * 2.1) * math.tau + 1.0))
            t = d * cycles + warp
            hue = t % 1.0
            sat = sat_base + 0.20 * math.sin(t * math.tau * 1.5)
            streak = math.sin((nx - ny) * math.tau * 1.5 + 0.5)
            val = 0.86 + 0.14 * max(0.0, streak)  # bright light bands
            r, g, b = colorsys.hsv_to_rgb(hue, max(0.15, sat), min(1.0, val))
            n = rnd.uniform(-grain, grain)
            raw += bytes((clamp8((r + n) * 255), clamp8((g + n) * 255), clamp8((b + n) * 255)))
    return raw


def main():
    ap = argparse.ArgumentParser(description="Generate a holographic-foil PNG.")
    ap.add_argument("--width", type=int, default=640)
    ap.add_argument("--height", type=int, default=640)
    ap.add_argument("--seed", type=int, default=7, help="grain pattern")
    ap.add_argument("--saturation", type=float, default=0.42, help="pastel 0.3 .. vivid 0.6")
    ap.add_argument("--grain", type=float, default=0.02, help="foil grain amount")
    ap.add_argument("--cycles", type=float, default=1.15, help="spectrum repeats across the diagonal")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    raw = build(a.width, a.height, a.seed, a.saturation, a.grain, a.cycles)
    write_png(a.out, a.width, a.height, raw)
    print(a.out)


if __name__ == "__main__":
    main()
