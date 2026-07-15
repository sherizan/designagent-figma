#!/usr/bin/env python3
"""Mesh-gradient PNG generator — pure stdlib, no deps.

Figma has no native mesh-gradient paint, so generate one as a raster and apply it
with the designagent `set_image` tool (scaleMode FILL). Corner radius is preserved
by the image fill.

  python3 mesh.py --width 600 --height 600 --colors "#7B2FF7,#F72FA0,#2F6BF7" --out mesh.png
"""
import argparse, math, struct, zlib, random

DEFAULT = ["#7B2FF7", "#F72FA0", "#2F6BF7", "#FF7A14", "#17E6C3"]


def parse_hex(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def write_png(path, w, h, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))  # 8-bit RGB
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def build(width, height, colors, seed, sigma):
    rnd = random.Random(seed)
    cols = [parse_hex(c) for c in colors]
    # First few colors anchor corners + center; extras get seeded jitter positions.
    base = [(0.12, 0.12), (0.88, 0.12), (0.15, 0.88), (0.85, 0.90), (0.5, 0.5)]
    pts = []
    for i, c in enumerate(cols):
        px, py = base[i] if i < len(base) else (rnd.random(), rnd.random())
        pts.append((px, py, c))
    inv2s2 = 1.0 / (2 * sigma * sigma)
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # PNG filter type 0
        ny = y / (height - 1)
        for x in range(width):
            nx = x / (width - 1)
            wsum = r = g = b = 0.0
            for px, py, (cr, cg, cb) in pts:
                w = math.exp(-((nx - px) ** 2 + (ny - py) ** 2) * inv2s2)
                wsum += w
                r += w * cr; g += w * cg; b += w * cb
            raw += bytes((round(r / wsum), round(g / wsum), round(b / wsum)))
    return raw


def main():
    ap = argparse.ArgumentParser(description="Generate a mesh-gradient PNG.")
    ap.add_argument("--width", type=int, default=600)
    ap.add_argument("--height", type=int, default=600)
    ap.add_argument("--colors", default=",".join(DEFAULT), help="comma-separated hex")
    ap.add_argument("--seed", type=int, default=7, help="positions of extra color points")
    ap.add_argument("--sigma", type=float, default=0.38, help="blob softness (0.25 tight, 0.5 broad)")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    colors = [c.strip() for c in a.colors.split(",") if c.strip()]
    if len(colors) < 2:
        ap.error("need at least 2 colors")
    raw = build(a.width, a.height, colors, a.seed, a.sigma)
    write_png(a.out, a.width, a.height, raw)
    print(a.out)


if __name__ == "__main__":
    main()
