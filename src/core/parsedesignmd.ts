// Minimal, tolerant parser for the DESIGN.md token frontmatter we emit (see
// designdoc.ts). We control the format, so this only needs to handle the shallow
// `colors` / `typography` / `spacing` / `rounded` maps — not arbitrary YAML.
// Used by the sandbox to apply a project's DESIGN.md back into Figma.

export interface ParsedTypographyToken {
  key: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: string;
  letterSpacing?: string;
}

export interface ParsedDesignMd {
  colors: Record<string, string>;
  spacing: Record<string, number>;
  rounded: Record<string, number>;
  typography: ParsedTypographyToken[];
}

const SECTIONS = new Set(['colors', 'typography', 'spacing', 'rounded', 'components']);

function frontmatterLines(content: string): string[] | null {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.indexOf('---', 1);
  if (end === -1) return null;
  return lines.slice(1, end);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function leadingNumber(value: string): number | null {
  const m = value.trim().match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

export function parseDesignMd(content: string): ParsedDesignMd {
  const out: ParsedDesignMd = { colors: {}, spacing: {}, rounded: {}, typography: [] };
  const lines = frontmatterLines(content);
  if (!lines) return out;

  let section = '';
  let current: ParsedTypographyToken | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const indent = indentOf(line);
    const trimmed = line.trim();
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();

    if (indent === 0) {
      section = SECTIONS.has(key) ? key : '';
      current = null;
      continue;
    }

    if (section === 'colors' && value) {
      out.colors[key] = stripQuotes(value);
    } else if (section === 'spacing' && value) {
      const n = leadingNumber(value);
      if (n !== null) out.spacing[key] = n;
    } else if (section === 'rounded' && value) {
      const n = leadingNumber(value);
      if (n !== null) out.rounded[key] = n;
    } else if (section === 'typography') {
      if (indent === 2 && !value) {
        current = { key };
        out.typography.push(current);
      } else if (indent >= 4 && current && value) {
        if (key === 'fontFamily') current.fontFamily = stripQuotes(value);
        else if (key === 'fontSize') {
          const n = leadingNumber(value);
          if (n !== null) current.fontSize = n;
        } else if (key === 'fontWeight') {
          const n = leadingNumber(value);
          if (n !== null) current.fontWeight = n;
        } else if (key === 'lineHeight') current.lineHeight = stripQuotes(value);
        else if (key === 'letterSpacing') current.letterSpacing = stripQuotes(value);
      }
    }
    // `components` is intentionally ignored — there's nothing to apply for it.
  }

  return out;
}
