// Design → HTML serializer. Pure: turns an HtmlNode tree (built by the plugin from
// Figma nodes + their getCSSAsync output) into one self-contained HTML document.
// Kept side-effect-free so it's fixture-testable, like designdoc.ts.

export interface HtmlNode {
  tag: string;
  css: Record<string, string>;
  text?: string;
  asset?: { mime: string; dataUrl: string };
  children: HtmlNode[];
}

export interface HtmlDocMeta {
  title: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

export function generateHtml(root: HtmlNode, meta: HtmlDocMeta): string {
  const rules: string[] = [];
  let counter = 0;

  function render(node: HtmlNode, indent: string): string {
    const cls = `n${counter++}`;
    const cssText = Object.entries(node.css)
      .map(([key, value]) => `${key}: ${value};`)
      .join(' ');
    if (cssText) {
      rules.push(`.${cls} { ${cssText} }`);
    }

    if (node.tag === 'img' && node.asset) {
      return `${indent}<img class="${cls}" src="${node.asset.dataUrl}" alt="" />`;
    }

    const parts: string[] = [];
    if (node.text) {
      parts.push(escapeHtml(node.text));
    }
    for (const child of node.children) {
      parts.push('\n' + render(child, indent + '  '));
    }
    const inner = parts.join('');
    const close = node.children.length > 0 ? `\n${indent}` : '';
    return `${indent}<${node.tag} class="${cls}">${inner}${close}</${node.tag}>`;
  }

  const body = render(root, '    ');

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeAttr(meta.title)}</title>`,
    '  <style>',
    '    * { box-sizing: border-box; }',
    '    body { margin: 0; background: #ffffff; }',
    ...rules.map((rule) => `    ${rule}`),
    '  </style>',
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    ''
  ].join('\n');
}
