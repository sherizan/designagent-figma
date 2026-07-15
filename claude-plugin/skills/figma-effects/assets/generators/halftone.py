#!/usr/bin/env python3
"""Halftone PNG generator — pure stdlib, no deps.

Classic rotated-screen halftone: a grid of ink dots whose radius tracks an underlying
field (linear / radial / diagonal gradient). No native Figma halftone paint; apply the
output with `set_image` (FILL).

  python3 halftone.py --width 800 --height 800 --cell 16 --angle 15 \
      --fg "#111111" --bg "#f2f2f2" --field radial --out halftone.png
"""
import argparse, math, struct, zlib


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
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def field_value(kind, nx, ny):
    """Darkness 0..1 that drives dot size."""
    if kind == "linear":
        return nx
    if kind == "diagonal":
        return (nx + ny) / 2
    # radial: darkest at center
    d = math.hypot(nx - 0.5, ny - 0.5) / math.hypot(0.5, 0.5)
    return 1.0 - d


def build(width, height, cell, angle, fg, bg, kind, invert):
    rad = math.radians(angle)
    ca, sa = math.cos(rad), math.sin(rad)
    maxr = cell * 0.5 * math.sqrt(2)  # a dot can bleed to the cell corners
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            # rotate into screen space, snap to the nearest cell center
            rx = x * ca + y * sa
            ry = -x * sa + y * ca
            cx = (math.floor(rx / cell) + 0.5) * cell
            cy = (math.floor(ry / cell) + 0.5) * cell
            # rotate the cell center back to sample the field there
            bx = cx * ca - cy * sa
            by = cx * sa + cy * ca
            nx = min(1.0, max(0.0, bx / width))
            ny = min(1.0, max(0.0, by / height))
            val = field_value(kind, nx, ny)
            if invert:
                val = 1.0 - val
            r = val * maxr
            d = math.hypot(rx - cx, ry - cy)
            raw += bytes(fg if d <= r else bg)
    return raw


def main():
    ap = argparse.ArgumentParser(description="Generate a halftone PNG.")
    ap.add_argument("--width", type=int, default=800)
    ap.add_argument("--height", type=int, default=800)
    ap.add_argument("--cell", type=float, default=16.0, help="screen cell size in px")
    ap.add_argument("--angle", type=float, default=15.0, help="screen angle in deg")
    ap.add_argument("--fg", default="#111111", help="ink color")
    ap.add_argument("--bg", default="#f2f2f2", help="paper color")
    ap.add_argument("--field", default="radial", choices=["linear", "radial", "diagonal"])
    ap.add_argument("--invert", action="store_true", help="flip dot-size direction")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    raw = build(a.width, a.height, a.cell, a.angle, parse_hex(a.fg), parse_hex(a.bg), a.field, a.invert)
    write_png(a.out, a.width, a.height, raw)
    print(a.out)


if __name__ == "__main__":
    main()
