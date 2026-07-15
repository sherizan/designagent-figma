---
name: figma-effects
description: >-
  Apply rich fills and effects to Figma nodes via the designagent bridge — gradients
  (linear/radial/angular/diamond), noise/grain, tiled patterns, inner-shadow, blur,
  texture, glass, plus mesh gradients, halftones and holographic foil. Use whenever
  the user asks to make a node look like a gradient, mesh, iridescent/holographic card,
  grainy/noisy surface, frosted glass, halftone/dot pattern, or textured background in
  Figma. Routes to native Figma paints/effects first and falls back to generated PNG
  fills only for looks Figma can't do natively (mesh, halftone, holographic).
---

# figma-effects — fills & effects on Figma nodes

Give a selected/target Figma node a non-flat look. **Prefer a native Figma paint/effect**
(real, editable in Figma) and only rasterize when Figma has no native equivalent.

Requires the DesignAgent bridge to be running (`status` should return `connected: true`).
Most tools take a `nodeId`; get one from `status`/`get_spec` (current selection) or from the
create tools. After applying anything, call `take_screenshot` to confirm the pixels.

## Decision tree — native first

| The user wants… | Use | Native? |
|-----------------|-----|---------|
| Gradient: linear / radial / angular / diamond, multi-stop | `set_gradient` | ✅ editable |
| Noise / grain / film grain | `set_noise` | ✅ editable |
| Frosted **glass**, **blur**, **inner shadow**, **texture** grain | `set_effect` | ✅ editable |
| Drop shadow | `set_shadow` | ✅ editable |
| Repeat/tile a node as a fill | `set_pattern` | ✅ editable |
| A shader already in the file/library | `set_shader` (ids from `list_shaders`) | ✅ |
| **Mesh gradient** (smooth multi-point blend) | raster → `set_image` | ❌ no native paint |
| **Halftone** / dot-screen | raster → `set_image` | ❌ no native paint |
| **Holographic / iridescent foil** | raster → `set_image`, or native — see below | ❌ no native paint |

Native paints/effects stay fully editable in Figma and re-export cleanly. Reach for a raster
fill only for the three rows Figma can't express. Noise/texture/glass need a recent Figma version.

**A raster fill is a dead end for the user: they cannot tweak colors, only regenerate.** Say so up
front and ask, rather than silently shipping a PNG someone then has to live with. Holographic has a
real native option, so it is a genuine choice:

- **Editability matters** → `set_gradient` **angular**, rainbow stops, + `set_noise`. Every band stays
  a draggable stop. Reads as a CD/disc sheen, not foil — no wavy distortion, because no native paint
  warps a gradient along a curve.
- **The foil look matters** → raster `holographic.py`. Only the raster gets the irregular warp.

Tested side by side: angular is the best native attempt. Linear rainbow stops read as printed stripes,
and **uneven stop spacing does not rescue them** — parallel bands look mechanical however you space
them. A `glass` effect on top barely registers. Don't burn turns rediscovering that.

## Native quick reference

- **Gradient** — `set_gradient { nodeId, type, stops:[{position,color}], angle?, centerX?, centerY?, radius? }`.
  `type` linear|radial|angular|diamond. Linear uses `angle` (deg, 0=up, 180=down); the others use
  `centerX/centerY/radius` in 0–1 (defaults center 0.5,0.5 radius 0.5 = fills the box). ≥2 stops;
  positions default to an even spread. 8-digit hex gives per-stop alpha.
- **Noise** — `set_noise { nodeId, noiseType, noiseSize?, density?, color?, secondaryColor?, opacity?, append? }`.
  monotone / duotone (add `secondaryColor`) / multitone (add `opacity`). `append:true` keeps existing effects.
- **Pattern** — `set_pattern { nodeId, sourceNodeId, tileType?, scalingFactor?, spacing?, horizontalAlignment? }`.
  `sourceNodeId` is any separate node (not an ancestor/descendant of the target). Great for dot grids,
  stripes, logos-as-tile.
- **Effect** — `set_effect { nodeId, type, ... }` where type is inner-shadow | blur | texture | glass:
  - `blur`: `radius`, `blurType` LAYER|BACKGROUND (background needs a translucent fill to show through).
  - `inner-shadow`: `color`, `offsetX/offsetY`, `blur`, `spread`, `opacity` (mirrors `set_shadow`).
  - `texture`: `noiseSize`, `radius`, `clipToShape`.
  - `glass`: `lightIntensity`, `lightAngle`, `refraction`, `depth`, `dispersion`, `radius`.
  - `append:true` stacks on top of existing effects instead of replacing.

Effects can stack: e.g. `set_gradient` then `set_noise {append:true}` for a grainy gradient.

## Raster fallback — mesh / halftone / holographic

Generators live at `${CLAUDE_PLUGIN_ROOT}/skills/figma-effects/assets/generators/` and are **pure
Python stdlib — no pip installs**. Each writes a PNG and prints its path.

1. Read the node size from `get_spec` and generate at ~1.2× for crispness (aspect need not be exact —
   `set_image` FILL crops to fit and preserves corner radius).
2. Run the generator, then apply the PNG:

```
python3 "${CLAUDE_PLUGIN_ROOT}/skills/figma-effects/assets/generators/mesh.py" \
    --width 600 --height 590 --colors "#7B2FF7,#F72FA0,#2F6BF7,#FF7A14,#17E6C3" --out /tmp/mesh.png
# then: set_image { nodeId, path: "/tmp/mesh.png", scaleMode: "FILL" }
```

- **mesh.py** — `--colors` (comma hex, ≥2), `--seed`, `--sigma` (blob softness). Gaussian blend of color points.
- **holographic.py** — `--saturation` (pastel↔vivid), `--grain`, `--cycles`, `--seed`. Iridescent foil sweep.
- **halftone.py** — `--cell`, `--angle`, `--fg`, `--bg`, `--field` linear|radial|diagonal, `--invert`.

Write PNGs to a temp/scratch dir, not into the user's project. Always finish with `take_screenshot`
to verify the result.

## Notes

- **Read the error before blaming the Figma version.** `Unrecognized key(s) in object: '<key>'` is the
  runtime rejecting one property, which means the effect *is* supported — the plugin sent a key this
  runtime's schema lacks (the bundled typings run ahead of shipped Figma). Fix the payload; do not fall
  back to raster. Only a genuinely unsupported effect type justifies the fallback, and that error names
  the type, not a key.
- If `set_noise`/`set_effect` (texture/glass) fails because the effect type itself is unsupported, the
  file's Figma version predates those effects — fall back to a raster texture or a shader.
- For a **grainy holographic card** (this skill's origin): generate the foil with **`--grain 0`**, apply
  via `set_image`, then `set_noise {append:true, noiseType:'multitone', density:0.35}`. Keep grain native
  and it stays a slider in Figma's effects panel; bake it with `--grain` and every tweak means
  regenerating the PNG. Baked grain also swamps the native layer, so you can't tell whether `set_noise`
  actually rendered — a grain-free fill is the only way to see it work.
