// Lottie JSON → one frame of SVG. Pure, no I/O — checked by check-lottie.mjs.

// ---- Lottie → SVG (one frame) ----
// ponytail: static snapshot of the shape model only; no precomps/masks/trim/text/gradients.
// Add a proper rasterizer (lottie-web in the plugin UI) if animated exports are ever needed.

interface LottieKeyframe { t: number; s?: number[]; e?: number[]; h?: number }
interface LottieProp { a?: number; k: unknown; s?: boolean; x?: LottieProp; y?: LottieProp }
interface LottieShape {
  ty: string; it?: LottieShape[]; nm?: string; hd?: boolean;
  p?: LottieProp; s?: LottieProp; r?: LottieProp; a?: LottieProp; o?: LottieProp; c?: LottieProp; w?: LottieProp;
  ks?: LottieProp; g?: { k: LottieProp };
}
interface LottieLayer {
  ty: number; ind?: number; parent?: number; nm?: string; hd?: boolean; ip: number; op: number;
  ks: { a?: LottieProp; p?: LottieProp; s?: LottieProp; r?: LottieProp; o?: LottieProp };
  shapes?: LottieShape[]; sw?: number; sh?: number; sc?: string;
}
export interface LottieRoot { w: number; h: number; ip: number; op: number; nm?: string; layers: LottieLayer[] }

// Value of an animatable property at `frame`: static `k`, or linear interpolation
// between the surrounding keyframes (hold keyframes and the last one snap).
function lottieValue(prop: LottieProp | undefined, frame: number): number[] {
  if (!prop) return [];
  if (prop.s && prop.x && prop.y) {
    return [lottieValue(prop.x, frame)[0] ?? 0, lottieValue(prop.y, frame)[0] ?? 0];
  }
  const k = prop.k;
  if (!prop.a || !Array.isArray(k) || typeof k[0] === 'number') {
    return Array.isArray(k) ? (k as number[]) : typeof k === 'number' ? [k] : [];
  }
  const frames = k as LottieKeyframe[];
  const first = frames[0]!;
  if (frame <= first.t) return first.s ?? [];
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i]!;
    const b = frames[i + 1]!;
    if (frame >= a.t && frame < b.t) {
      const from = a.s ?? [];
      const to = b.s ?? a.e ?? from;
      if (a.h) return from;
      const u = (frame - a.t) / Math.max(1, b.t - a.t);
      return from.map((v, j) => v + ((to[j] ?? v) - v) * u);
    }
  }
  const last = frames[frames.length - 1]!;
  return last.s ?? frames[frames.length - 2]?.e ?? frames[frames.length - 2]?.s ?? [];
}

function lottieTransform(
  t: { a?: LottieProp; p?: LottieProp; s?: LottieProp; r?: LottieProp } | undefined,
  frame: number
): string {
  if (!t) return '';
  const [ax = 0, ay = 0] = lottieValue(t.a, frame);
  const [px = 0, py = 0] = lottieValue(t.p, frame);
  const [sx = 100, sy = 100] = lottieValue(t.s, frame);
  const [r = 0] = lottieValue(t.r, frame);
  return `translate(${px} ${py}) rotate(${r}) scale(${sx / 100} ${sy / 100}) translate(${-ax} ${-ay})`;
}

function lottieColor(prop: LottieProp | undefined, frame: number): string {
  const [r = 0, g = 0, b = 0] = lottieValue(prop, frame);
  const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function lottiePathD(prop: LottieProp | undefined, frame: number): string {
  const k = prop?.k as { v?: number[][]; i?: number[][]; o?: number[][]; c?: boolean } | LottieKeyframe[] | undefined;
  let shape = k as { v?: number[][]; i?: number[][]; o?: number[][]; c?: boolean } | undefined;
  if (Array.isArray(k)) {
    // animated path: keyframe `s` holds [shape]; snap to the nearest keyframe (no morphing)
    const frames = k as Array<{ t: number; s?: unknown[] }>;
    const kf = frames.filter((f) => f.t <= frame).pop() ?? frames[0];
    shape = kf?.s?.[0] as typeof shape;
  }
  const v = shape?.v ?? [];
  if (v.length === 0) return '';
  const i = shape?.i ?? [];
  const o = shape?.o ?? [];
  const pt = (p: number[] | undefined) => `${p?.[0] ?? 0} ${p?.[1] ?? 0}`;
  const parts = [`M ${pt(v[0])}`];
  const n = v.length;
  const segs = shape?.c ? n : n - 1;
  for (let idx = 0; idx < segs; idx += 1) {
    const a = idx;
    const b = (idx + 1) % n;
    const c1 = [(v[a]?.[0] ?? 0) + (o[a]?.[0] ?? 0), (v[a]?.[1] ?? 0) + (o[a]?.[1] ?? 0)];
    const c2 = [(v[b]?.[0] ?? 0) + (i[b]?.[0] ?? 0), (v[b]?.[1] ?? 0) + (i[b]?.[1] ?? 0)];
    parts.push(`C ${pt(c1)} ${pt(c2)} ${pt(v[b])}`);
  }
  if (shape?.c) parts.push('Z');
  return parts.join(' ');
}

function lottieShapesToSvg(shapes: LottieShape[], frame: number, skipped: Set<string>): string {
  // A group's fills/strokes paint every geometry in that group.
  let fill = 'none';
  let stroke = '';
  let strokeWidth = 0;
  let fillOpacity = 1;
  let strokeOpacity = 1;
  let transform = '';
  const geoms: string[] = [];
  const groups: string[] = [];
  for (const sh of shapes) {
    if (sh.hd) continue;
    switch (sh.ty) {
      case 'gr':
        groups.push(lottieShapesToSvg(sh.it ?? [], frame, skipped));
        break;
      case 'rc': {
        const [w = 0, h = 0] = lottieValue(sh.s, frame);
        const [cx = 0, cy = 0] = lottieValue(sh.p, frame);
        const [r = 0] = lottieValue(sh.r, frame);
        geoms.push(`<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${r}"/>`);
        break;
      }
      case 'el': {
        const [w = 0, h = 0] = lottieValue(sh.s, frame);
        const [cx = 0, cy = 0] = lottieValue(sh.p, frame);
        geoms.push(`<ellipse cx="${cx}" cy="${cy}" rx="${w / 2}" ry="${h / 2}"/>`);
        break;
      }
      case 'sh': {
        const d = lottiePathD(sh.ks, frame);
        if (d) geoms.push(`<path d="${d}"/>`);
        break;
      }
      case 'fl':
        fill = lottieColor(sh.c, frame);
        fillOpacity = (lottieValue(sh.o, frame)[0] ?? 100) / 100;
        break;
      case 'st':
        stroke = lottieColor(sh.c, frame);
        strokeWidth = lottieValue(sh.w, frame)[0] ?? 1;
        strokeOpacity = (lottieValue(sh.o, frame)[0] ?? 100) / 100;
        break;
      case 'gf':
      case 'gs': {
        // gradient: keep the first stop's color as a flat paint
        const k = lottieValue(sh.g?.k, frame);
        const h = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
        const c = `#${h(k[1] ?? 0)}${h(k[2] ?? 0)}${h(k[3] ?? 0)}`;
        if (sh.ty === 'gf') fill = c;
        else {
          stroke = c;
          strokeWidth = lottieValue(sh.w, frame)[0] ?? 1;
        }
        skipped.add(`gradient "${sh.nm ?? sh.ty}" flattened`);
        break;
      }
      case 'tr':
        transform = lottieTransform(sh, frame);
        fillOpacity *= (lottieValue(sh.o, frame)[0] ?? 100) / 100;
        break;
      case 'tm':
      case 'rp':
      case 'mm':
      case 'pb':
      case 'rd':
        skipped.add(`shape modifier "${sh.nm ?? sh.ty}"`);
        break;
      default:
        skipped.add(`shape type "${sh.ty}"`);
    }
  }
  const paint = `fill="${fill}" fill-opacity="${fillOpacity}"` +
    (stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}"` : '');
  return `<g transform="${transform}" ${paint}>${geoms.join('')}${groups.join('')}</g>`;
}

export function lottieFrameToSvg(root: LottieRoot, frameArg: number | 'last'): { svg: string; skipped: string[] } {
  const frame = frameArg === 'last' ? Math.max(root.ip, root.op - 1) : frameArg;
  const skipped = new Set<string>();
  const byIndex = new Map<number, LottieLayer>();
  for (const l of root.layers) if (l.ind != null) byIndex.set(l.ind, l);
  const chain = (l: LottieLayer, depth = 0): string => {
    const own = lottieTransform(l.ks, frame);
    const parent = l.parent != null ? byIndex.get(l.parent) : undefined;
    return parent && depth < 16 ? `${chain(parent, depth + 1)} ${own}` : own;
  };
  const out: string[] = [];
  // Lottie draws the last layer first (bottom); SVG draws in source order.
  for (const layer of [...root.layers].reverse()) {
    if (layer.hd || frame < layer.ip || frame >= layer.op) continue;
    const opacity = (lottieValue(layer.ks.o, frame)[0] ?? 100) / 100;
    if (layer.ty === 4) {
      out.push(`<g transform="${chain(layer)}" opacity="${opacity}">${lottieShapesToSvg(layer.shapes ?? [], frame, skipped)}</g>`);
    } else if (layer.ty === 1) {
      out.push(`<g transform="${chain(layer)}" opacity="${opacity}"><rect width="${layer.sw ?? 0}" height="${layer.sh ?? 0}" fill="${layer.sc ?? '#000'}"/></g>`);
    } else if (layer.ty !== 3) {
      // 3 = null (transform-only) layers are fine to drop; everything else is unsupported
      skipped.add(`layer "${layer.nm ?? layer.ty}" (type ${layer.ty})`);
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${root.w}" height="${root.h}" viewBox="0 0 ${root.w} ${root.h}">${out.join('')}</svg>`;
  return { svg, skipped: Array.from(skipped) };
}

