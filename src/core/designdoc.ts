import type { AnalysisCore } from './analyze';
import { collectAnnotationEntries, collectInstances, flattenNodes } from './serialize';
import type { ResolvedVariable, UiNodeSpec, UiSpec } from './types';

// DESIGN.md serializer — follows the google-labs-code/design.md spec:
// machine-readable token frontmatter (the normative values) plus a
// human-readable prose body in the canonical section order. Tokens are
// synthesized from the analyzed selection (preferring real Figma variables),
// so the frontmatter is always populated even without a formal design system.

export interface DesignDocFrame {
  core: AnalysisCore;
}

export interface DesignDocMeta {
  fileName: string;
  omittedFrameCount?: number;
}

// ---- color helpers ----

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseColor(raw: string): Rgb | null {
  const input = raw.trim();
  const hex = input.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex && hex[1]) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }
  const rgb = input.match(/rgba?\(([^)]+)\)/i);
  if (rgb && rgb[1]) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0] ?? '');
      const g = parseFloat(parts[1] ?? '');
      const b = parseFloat(parts[2] ?? '');
      const a = parts.length >= 4 ? parseFloat(parts[3] ?? '1') : 1;
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return { r: clamp255(r), g: clamp255(g), b: clamp255(b), a: Number.isFinite(a) ? a : 1 };
      }
    }
  }
  return null;
}

// Pull the first color literal out of a compound value (e.g. "1px solid #ccc").
function extractColor(value: string): Rgb | null {
  const token = value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)/i);
  return token ? parseColor(token[0]) : null;
}

function toHex({ r, g, b, a }: Rgb): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0');
  const base = `#${h(r)}${h(g)}${h(b)}`;
  return a < 1 ? `${base}${Math.round(a * 255).toString(16).padStart(2, '0')}` : base;
}

function luminance({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function saturation({ r, g, b }: Rgb): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// ---- token synthesis ----

type ColorRole = 'text' | 'bg' | 'border';

interface ColorHit {
  hex: string;
  rgb: Rgb;
  count: number;
  roles: Set<ColorRole>;
}

function gatherColorHits(nodes: UiNodeSpec[]): { hits: ColorHit[]; hasGradient: boolean } {
  const map = new Map<string, ColorHit>();
  let hasGradient = false;
  const add = (rgb: Rgb | null, role: ColorRole) => {
    if (!rgb || rgb.a === 0) return;
    const hex = toHex(rgb);
    const existing = map.get(hex);
    if (existing) {
      existing.count += 1;
      existing.roles.add(role);
    } else {
      map.set(hex, { hex, rgb, count: 1, roles: new Set([role]) });
    }
  };
  for (const node of nodes) {
    const css = node.css;
    if (css) {
      if (css['color']) add(parseColor(css['color']), 'text');
      const bg = css['background-color'] ?? css['background'];
      if (bg) {
        if (/gradient/i.test(bg)) hasGradient = true;
        add(extractColor(bg), 'bg');
      }
      if (css['border']) add(extractColor(css['border']), 'border');
    }
    // Paint colors from extraction — captures vector/'mixed' fills the CSS path misses.
    const visual = node.visual;
    if (visual) {
      for (const hex of visual.fillColors ?? []) {
        add(parseColor(hex), 'bg');
      }
      if (visual.strokeColor) {
        add(parseColor(visual.strokeColor), 'border');
      }
    }
  }
  const hits = [...map.values()].sort((a, b) => b.count - a.count);
  return { hits, hasGradient };
}

function sanitizeKey(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'token';
}

function uniqueKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  const key = `${base}-${i}`;
  used.add(key);
  return key;
}

interface ColorTokens {
  ordered: Array<{ key: string; value: string }>;
  byValue: Map<string, string>; // hex -> token name
}

function buildColorTokens(frames: DesignDocFrame[], nodes: UiNodeSpec[]): ColorTokens {
  const used = new Set<string>();
  const ordered: Array<{ key: string; value: string }> = [];
  const byValue = new Map<string, string>();
  const push = (key: string, value: string) => {
    const k = uniqueKey(sanitizeKey(key), used);
    ordered.push({ key: k, value });
    const norm = parseColor(value);
    if (norm && !byValue.has(toHex(norm))) byValue.set(toHex(norm), k);
  };

  // Prefer real Figma color variables — they're the actual design system.
  const variables: ResolvedVariable[] = [];
  for (const frame of frames) {
    variables.push(...(frame.core.uiSpec.tokenization.resolvedVariables ?? []));
  }
  const colorVars = variables.filter((v) => /color/i.test(v.resolvedType));
  const seenVar = new Set<string>();
  for (const v of colorVars) {
    const value = Object.values(v.modes)[0];
    if (!value || seenVar.has(v.name)) continue;
    seenVar.add(v.name);
    if (parseColor(value)) push(v.name, toHex(parseColor(value) as Rgb));
    if (ordered.length >= 16) break;
  }
  if (ordered.length > 0) return { ordered, byValue };

  // No variables — synthesize from observed values.
  const { hits } = gatherColorHits(nodes);
  if (hits.length === 0) return { ordered, byValue };

  const taken = new Set<string>();
  const claim = (hit: ColorHit | undefined, key: string) => {
    if (!hit || taken.has(hit.hex)) return;
    taken.add(hit.hex);
    push(key, hit.hex);
  };

  const primary = hits.find((h) => saturation(h.rgb) >= 0.25);
  claim(primary, 'primary');
  const surface = hits.find((h) => h.roles.has('bg') && luminance(h.rgb) >= 0.5 && !taken.has(h.hex));
  claim(surface ?? hits.find((h) => h.roles.has('bg') && !taken.has(h.hex)), 'surface');
  const onSurface = hits.find((h) => h.roles.has('text') && !taken.has(h.hex));
  claim(onSurface, 'on-surface');

  let neutral = 1;
  let accent = 2;
  for (const hit of hits) {
    if (taken.has(hit.hex) || ordered.length >= 10) continue;
    if (saturation(hit.rgb) >= 0.25) {
      claim(hit, accent === 2 ? 'accent' : `accent-${accent}`);
      accent += 1;
    } else {
      claim(hit, `neutral-${neutral}`);
      neutral += 1;
    }
  }
  return { ordered, byValue };
}

const WEIGHT_NAMES: Array<[RegExp, number]> = [
  [/thin|hairline/, 100],
  [/extra[\s-]?light|ultra[\s-]?light/, 200],
  [/light/, 300],
  [/regular|normal|book/, 400],
  [/medium/, 500],
  [/semi[\s-]?bold|demi[\s-]?bold/, 600],
  [/extra[\s-]?bold|ultra[\s-]?bold/, 800],
  [/black|heavy/, 900],
  [/bold/, 700]
];

function weightFor(node: UiNodeSpec): number {
  const cssWeight = node.css?.['font-weight'];
  if (cssWeight) {
    const n = parseInt(cssWeight, 10);
    if (Number.isFinite(n)) return n;
  }
  const style = (node.text?.fontStyle ?? '').toLowerCase();
  for (const [re, w] of WEIGHT_NAMES) {
    if (re.test(style)) return w;
  }
  return 400;
}

function normalizeDimension(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v || /^(auto|normal|none)$/i.test(v)) return undefined;
  const pct = v.match(/^(-?\d+(?:\.\d+)?)%$/);
  if (pct && pct[1]) {
    const ratio = Math.round((parseFloat(pct[1]) / 100) * 100) / 100;
    return String(ratio);
  }
  return v;
}

interface TypographyToken {
  key: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight: number;
  lineHeight?: string;
  letterSpacing?: string;
}

function sizeName(size: number): string {
  if (size >= 32) return 'display';
  if (size >= 24) return 'headline';
  if (size >= 20) return 'title';
  if (size >= 16) return 'body-lg';
  if (size >= 14) return 'body';
  if (size >= 12) return 'label';
  return 'caption';
}

function buildTypographyTokens(nodes: UiNodeSpec[]): TypographyToken[] {
  const combos = new Map<string, { token: Omit<TypographyToken, 'key'>; count: number }>();
  for (const node of nodes) {
    if (!node.text) continue;
    const size = node.text.fontSize ?? (node.css?.['font-size'] ? parseFloat(node.css['font-size']) : undefined);
    if (!size || !Number.isFinite(size)) continue;
    const family = (node.css?.['font-family'] ?? node.text.fontFamily ?? '').replace(/["']/g, '').trim();
    const weight = weightFor(node);
    const lineHeight = normalizeDimension(node.css?.['line-height'] ?? node.text.lineHeight);
    const letterSpacing = normalizeDimension(node.css?.['letter-spacing'] ?? node.text.letterSpacing);
    const rounded = Math.round(size);
    const key = `${family}|${rounded}|${weight}|${lineHeight ?? ''}|${letterSpacing ?? ''}`;
    const existing = combos.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      combos.set(key, {
        count: 1,
        token: {
          fontFamily: family || undefined,
          fontSize: rounded,
          fontWeight: weight,
          lineHeight,
          letterSpacing
        }
      });
    }
  }
  const ranked = [...combos.values()].sort((a, b) => b.token.fontSize - a.token.fontSize).slice(0, 8);
  const used = new Set<string>();
  return ranked.map((entry) => ({
    key: uniqueKey(sizeName(entry.token.fontSize), used),
    ...entry.token
  }));
}

function buildScale(values: number[], names: string[]): Array<{ key: string; value: number }> {
  const unique = [...new Set(values.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.round(n)))].sort(
    (a, b) => a - b
  );
  return unique.slice(0, names.length).map((value, i) => ({ key: names[i] ?? `s-${i}`, value }));
}

function collectSpacing(nodes: UiNodeSpec[]): number[] {
  const counts = new Map<number, number>();
  for (const node of nodes) {
    const l = node.layout;
    if (!l) continue;
    for (const v of [l.itemSpacing, l.paddingTop, l.paddingRight, l.paddingBottom, l.paddingLeft]) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        const key = Math.round(v);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  // Only recurring values are a real spacing scale; one-off layout values are dropped.
  return [...counts.entries()].filter(([, c]) => c >= 2).map(([value]) => value);
}

function collectRadii(nodes: UiNodeSpec[]): number[] {
  const values: number[] = [];
  for (const node of nodes) {
    const r = node.visual?.cornerRadius;
    if (typeof r === 'number') values.push(r);
  }
  return values;
}

function collectShadows(nodes: UiNodeSpec[]): string[] {
  const set = new Set<string>();
  for (const node of nodes) {
    const shadow = node.css?.['box-shadow'];
    if (shadow && shadow !== 'none') set.add(shadow.trim());
  }
  return [...set];
}

interface ComponentToken {
  key: string;
  backgroundColor?: string;
  textColor?: string;
}

function colorRef(value: string | undefined, byValue: Map<string, string>): string | undefined {
  if (!value) return undefined;
  const rgb = extractColor(value);
  if (!rgb) return undefined;
  const hex = toHex(rgb);
  const token = byValue.get(hex);
  return token ? `{colors.${token}}` : hex;
}

function buildComponentTokens(frames: DesignDocFrame[], byValue: Map<string, string>): ComponentToken[] {
  const seen = new Map<string, ComponentToken>();
  for (const frame of frames) {
    for (const instance of collectInstances(frame.core.uiSpec)) {
      const name = instance.instance?.mainComponentName ?? instance.name;
      if (!name) continue;
      const key = sanitizeKey(name);
      if (seen.has(key)) continue;
      const bg = colorRef(instance.css?.['background-color'] ?? instance.css?.['background'], byValue);
      // a component's text color usually lives on a descendant text node
      let textColor: string | undefined;
      for (const child of flattenNodes(instance)) {
        if (child.text && child.css?.['color']) {
          textColor = colorRef(child.css['color'], byValue);
          if (textColor) break;
        }
      }
      seen.set(key, { key, backgroundColor: bg, textColor });
      if (seen.size >= 16) break;
    }
  }
  return [...seen.values()];
}

// ---- YAML + Markdown emission ----

function yamlString(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function emitFrontmatter(
  meta: DesignDocMeta,
  description: string,
  colors: ColorTokens,
  typography: TypographyToken[],
  spacing: Array<{ key: string; value: number }>,
  rounded: Array<{ key: string; value: number }>,
  components: ComponentToken[]
): string {
  const lines: string[] = ['---', 'version: alpha', `name: ${yamlString(meta.fileName)}`];
  if (description) lines.push(`description: ${yamlString(description)}`);

  if (colors.ordered.length > 0) {
    lines.push('colors:');
    for (const c of colors.ordered) lines.push(`  ${c.key}: ${yamlString(c.value)}`);
  }

  if (typography.length > 0) {
    lines.push('typography:');
    for (const t of typography) {
      lines.push(`  ${t.key}:`);
      if (t.fontFamily) lines.push(`    fontFamily: ${yamlString(t.fontFamily)}`);
      lines.push(`    fontSize: ${t.fontSize}px`);
      lines.push(`    fontWeight: ${t.fontWeight}`);
      if (t.lineHeight) lines.push(`    lineHeight: ${t.lineHeight}`);
      if (t.letterSpacing) lines.push(`    letterSpacing: ${yamlString(t.letterSpacing)}`);
    }
  }

  if (spacing.length > 0) {
    lines.push('spacing:');
    for (const s of spacing) lines.push(`  ${s.key}: ${s.value}px`);
  }

  if (rounded.length > 0) {
    lines.push('rounded:');
    for (const r of rounded) lines.push(`  ${r.key}: ${r.value}px`);
  }

  if (components.length > 0) {
    lines.push('components:');
    for (const c of components) {
      lines.push(`  ${c.key}:`);
      if (c.backgroundColor) lines.push(`    backgroundColor: ${yamlString(c.backgroundColor)}`);
      if (c.textColor) lines.push(`    textColor: ${yamlString(c.textColor)}`);
    }
  }

  lines.push('---');
  return lines.join('\n');
}

function describeLayout(uiSpec: UiSpec): string | null {
  const layout = uiSpec.root.layout;
  if (!layout || !layout.layoutMode || layout.layoutMode === 'NONE') return null;
  const direction = layout.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical';
  const parts = [`${direction} auto-layout`];
  if (typeof layout.itemSpacing === 'number') parts.push(`gap ${layout.itemSpacing}`);
  return parts.join(', ');
}

export function generateDesignDoc(frames: DesignDocFrame[], meta: DesignDocMeta): string {
  const nodes = frames.flatMap((frame) => flattenNodes(frame.core.uiSpec.root));
  const frameWord = frames.length === 1 ? 'frame' : 'frames';

  const colors = buildColorTokens(frames, nodes);
  const typography = buildTypographyTokens(nodes);
  const spacing = buildScale(collectSpacing(nodes), ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'xxxl']);
  const radii = collectRadii(nodes);
  // Pill radii (very large) are represented once as `full`, not in the sm/md/lg scale.
  const hasPill = radii.some((r) => r >= 999);
  const roundedScale = buildScale(
    radii.filter((r) => r < 999),
    ['sm', 'md', 'lg', 'xl']
  );
  const rounded: Array<{ key: string; value: number }> = [{ key: 'none', value: 0 }, ...roundedScale];
  if (hasPill) rounded.push({ key: 'full', value: 9999 });
  const components = buildComponentTokens(frames, colors.byValue);
  const shadows = collectShadows(nodes);

  const description = `Design tokens extracted by DesignAgent from ${frames.length} Figma ${frameWord}.`;

  const out: string[] = [];
  out.push(
    emitFrontmatter(meta, description, colors, typography, spacing, rounded, components)
  );

  // ---- canonical prose body ----
  const frameNames = frames.map((f) => f.core.selectedNode.name).filter(Boolean);

  out.push('## Overview');
  const overview: string[] = [
    `**${meta.fileName}** — tokens and guidance derived from ${frames.length} Figma ${frameWord}` +
      (frameNames.length ? `: ${frameNames.map((n) => `\`${n}\``).join(', ')}.` : '.'),
    '',
    'The YAML frontmatter above holds the normative token values; the prose below is context for applying them. Token values are inferred from the design, so verify names before relying on them as a formal system.'
  ];
  if (meta.omittedFrameCount && meta.omittedFrameCount > 0) {
    overview.push(
      '',
      `_Note: ${meta.omittedFrameCount} additional selected ${meta.omittedFrameCount === 1 ? 'frame was' : 'frames were'} omitted to keep this focused._`
    );
  }
  out.push(overview.join('\n'));

  if (colors.ordered.length > 0) {
    out.push('## Colors');
    out.push(colors.ordered.map((c) => `- \`${c.key}\` — ${c.value}`).join('\n'));
  }

  if (typography.length > 0) {
    out.push('## Typography');
    out.push(
      typography
        .map((t) => {
          const bits = [`${t.fontSize}px`, `weight ${t.fontWeight}`];
          if (t.fontFamily) bits.unshift(t.fontFamily);
          return `- \`${t.key}\` — ${bits.join(', ')}`;
        })
        .join('\n')
    );
  }

  out.push('## Layout');
  const layoutLines = frames
    .map((f) => {
      const desc = describeLayout(f.core.uiSpec);
      return desc ? `- \`${f.core.selectedNode.name}\`: ${desc}` : null;
    })
    .filter((line): line is string => Boolean(line));
  out.push(
    layoutLines.length > 0
      ? layoutLines.join('\n')
      : 'No auto-layout on the analyzed roots — positions are freeform. Spacing tokens above reflect the gaps and padding observed in nested layers.'
  );

  out.push('## Elevation & Depth');
  out.push(
    shadows.length > 0
      ? `Shadows in use:\n${shadows.slice(0, 6).map((s) => `- \`${s}\``).join('\n')}`
      : 'Flat — no drop shadows detected. Use borders and surface contrast for depth.'
  );

  out.push('## Shapes');
  out.push(
    roundedScale.length > 0
      ? `Corner radii: ${rounded.map((r) => `\`${r.key}\` ${r.value}px`).join(', ')}.`
      : 'Square corners throughout (no corner radius detected).'
  );

  if (components.length > 0) {
    out.push('## Components');
    out.push(components.map((c) => `- \`${c.key}\``).join('\n'));
  }

  out.push("## Do's and Don'ts");
  const dos: string[] = [
    '- **Do** use the token values in the frontmatter verbatim; treat them as the source of truth.',
    '- **Do** reference color tokens (e.g. `{colors.primary}`) rather than hardcoding hexes.',
    "- **Don't** introduce new colors, type sizes, or spacing values outside the scales above without reason."
  ];
  const annotations = frames.flatMap((f) => collectAnnotationEntries(f.core.uiSpec));
  if (annotations.length > 0) {
    dos.push('', '**Designer notes**');
    for (const entry of annotations.slice(0, 20)) dos.push(`- ${entry}`);
  }
  out.push(dos.join('\n'));

  return out.join('\n\n') + '\n';
}
