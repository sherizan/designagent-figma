// Machine-readable token export: ResolvedVariable[] -> CSS / Tailwind / Sass / DTCG.
// Pure and fixture-testable (run `node --loader ...` or the demo() self-check at bottom).
// The variables are already resolved upstream by enrichUiSpec (extract.ts); this only
// formats them. CSS and DTCG carry ALL Figma variable modes (light/dark round-trip);
// Tailwind and Sass emit the default mode only.
// ponytail: Tailwind/Sass = default-mode only; upgrade to per-mode maps if themes need it there.

import type { ResolvedVariable } from './types';

export type TokenFormat = 'css' | 'tailwind' | 'sass' | 'dtcg';

// "color/brand/Primary" -> ["color","brand","primary"]; sanitized, lowercased.
function pathParts(name: string): string[] {
  return name
    .split('/')
    .map((p) => p.trim().replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase())
    .filter(Boolean);
}

function slug(name: string): string {
  return pathParts(name).join('-') || 'token';
}

// First mode is the default (Figma's mode insertion order). Returns [modeName, value][].
function modeEntries(v: ResolvedVariable): Array<[string, string]> {
  return Object.entries(v.modes);
}

function defaultValue(v: ResolvedVariable): string {
  const first = modeEntries(v)[0];
  return first ? first[1] : '';
}

// De-dupe by slug (same logical token imported from several collections shows up twice).
function dedupe(vars: ResolvedVariable[]): ResolvedVariable[] {
  const seen = new Set<string>();
  const out: ResolvedVariable[] = [];
  for (const v of vars) {
    const key = `${slug(v.name)}|${JSON.stringify(v.modes)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function exportCss(vars: ResolvedVariable[]): string {
  // Collect all mode names across the set; :root = default mode, one [data-theme] block per other.
  const modeNames: string[] = [];
  for (const v of vars) {
    for (const [m] of modeEntries(v)) if (!modeNames.includes(m)) modeNames.push(m);
  }
  if (modeNames.length === 0) return ':root {\n}\n';

  const blocks: string[] = [];
  modeNames.forEach((mode, i) => {
    const selector = i === 0 ? ':root' : `[data-theme="${slug(mode)}"]`;
    const lines = vars
      .map((v) => {
        const val = v.modes[mode] ?? defaultValue(v);
        return val ? `  --${slug(v.name)}: ${val};` : null;
      })
      .filter(Boolean);
    blocks.push(`${selector} {\n${lines.join('\n')}\n}`);
  });
  return blocks.join('\n\n') + '\n';
}

function exportSass(vars: ResolvedVariable[]): string {
  const lines = vars
    .map((v) => {
      const val = defaultValue(v);
      return val ? `$${slug(v.name)}: ${val};` : null;
    })
    .filter(Boolean);
  return lines.join('\n') + '\n';
}

function exportTailwind(vars: ResolvedVariable[]): string {
  // Group by first path segment (e.g. color/*, spacing/*) into theme.extend.<group>.
  const groups: Record<string, Record<string, string>> = {};
  for (const v of vars) {
    const parts = pathParts(v.name);
    const group = parts.length > 1 ? parts[0]! : 'tokens';
    const key = (parts.length > 1 ? parts.slice(1) : parts).join('-') || 'DEFAULT';
    const val = defaultValue(v);
    if (!val) continue;
    (groups[group] ??= {})[key] = val;
  }
  const theme = { theme: { extend: groups } };
  // ponytail: plain comment, NOT the `@type {import('tailwindcss').Config}` JSDoc — Figma's plugin
  // sandbox rejects any literal `import(` in the bundled code, even inside a string. Not worth an
  // anti-constant-folding hack for editor autocomplete.
  return '// tailwind.config.js — design tokens exported from Figma by DesignAgent\nmodule.exports = ' + JSON.stringify(theme, null, 2) + ';\n';
}

function dtcgType(resolvedType: string): string {
  switch (resolvedType) {
    case 'COLOR':
      return 'color';
    case 'FLOAT':
      return 'number';
    case 'BOOLEAN':
      return 'boolean';
    default:
      return 'string';
  }
}

function exportDtcg(vars: ResolvedVariable[]): string {
  // Nest by path segments. $value = default mode; all modes preserved under $extensions
  // (DTCG has no standard multi-mode yet, so $extensions keeps it lossless + valid).
  const root: Record<string, unknown> = {};
  for (const v of vars) {
    const parts = pathParts(v.name);
    let node = root;
    parts.forEach((part, i) => {
      if (i === parts.length - 1) {
        const entry: Record<string, unknown> = {
          $type: dtcgType(v.resolvedType),
          $value: defaultValue(v)
        };
        const modes = v.modes;
        if (Object.keys(modes).length > 1) {
          entry.$extensions = { 'com.designagent.modes': modes };
        }
        node[part] = entry;
      } else {
        node[part] = (node[part] as Record<string, unknown>) ?? {};
        node = node[part] as Record<string, unknown>;
      }
    });
  }
  return JSON.stringify(root, null, 2) + '\n';
}

export function exportTokens(vars: ResolvedVariable[], format: TokenFormat): string {
  const deduped = dedupe(vars ?? []);
  if (deduped.length === 0) {
    return `/* No Figma variables resolved for this selection. Bind values to variables in Figma, or export ${format} after selecting a frame that uses tokens. */\n`;
  }
  switch (format) {
    case 'css':
      return exportCss(deduped);
    case 'sass':
      return exportSass(deduped);
    case 'tailwind':
      return exportTailwind(deduped);
    case 'dtcg':
      return exportDtcg(deduped);
    default:
      throw new Error(`Unknown token format: ${format}`);
  }
}

// ponytail: one runnable self-check. `npx tsx src/core/tokens.ts` or import demo() in a scratch run.
export function demo(): void {
  const vars: ResolvedVariable[] = [
    { id: '1', name: 'color/brand/Primary', collection: 'theme', resolvedType: 'COLOR', modes: { Light: '#d97757', Dark: '#e0896b' } },
    { id: '2', name: 'spacing/md', collection: 'theme', resolvedType: 'FLOAT', modes: { Light: '16' } },
    { id: '1', name: 'color/brand/Primary', collection: 'imported', resolvedType: 'COLOR', modes: { Light: '#d97757', Dark: '#e0896b' } } // dup
  ];
  const css = exportTokens(vars, 'css');
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error('demo failed: ' + msg); };
  assert(css.includes('--color-brand-primary: #d97757;'), 'css default mode var');
  assert(css.includes('[data-theme="dark"]') && css.includes('#e0896b'), 'css dark mode block');
  assert(!/#d97757[\s\S]*#d97757[\s\S]*#d97757/.test(css), 'dedup: primary appears at most twice (light+dark), not thrice');
  const sass = exportTokens(vars, 'sass');
  assert(sass.includes('$color-brand-primary: #d97757;'), 'sass var');
  assert(sass.includes('$spacing-md: 16;'), 'sass float');
  const tw = exportTokens(vars, 'tailwind');
  assert(tw.includes('module.exports') && /"color"[\s\S]*"brand-primary": "#d97757"/.test(tw), 'tailwind grouped');
  assert(!tw.includes('import('), 'no literal import( — Figma sandbox rejects it in the bundle');
  const dtcg = JSON.parse(exportTokens(vars, 'dtcg'));
  assert(dtcg.color.brand.primary.$type === 'color', 'dtcg $type');
  assert(dtcg.color.brand.primary.$value === '#d97757', 'dtcg $value default mode');
  assert(dtcg.color.brand.primary.$extensions['com.designagent.modes'].Dark === '#e0896b', 'dtcg modes preserved');
  assert(exportTokens([], 'css').includes('No Figma variables'), 'empty guard');
  // eslint-disable-next-line no-console
  console.log('tokens.ts demo: all assertions passed');
}
