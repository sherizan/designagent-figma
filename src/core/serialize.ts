import type { ResolvedVariable, UiNodeSpec, UiSpec } from './types';

// Shared UiSpec → Markdown serializers backing the DESIGN.md export
// (src/core/designdoc.ts).

export function flattenNodes(root: UiNodeSpec): UiNodeSpec[] {
  const queue: UiNodeSpec[] = [root];
  const result: UiNodeSpec[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    result.push(current);
    for (const child of current.children) {
      queue.push(child);
    }
  }

  return result;
}

export function buildCompositionSummary(uiSpec: UiSpec): string {
  const { stats } = uiSpec;
  const parts: string[] = [`${stats.totalNodes} nodes`];
  if (stats.frames > 0) parts.push(`${stats.frames} frames`);
  if (stats.instances > 0) parts.push(`${stats.instances} instances`);
  if (stats.textNodes > 0) parts.push(`${stats.textNodes} text`);
  if (stats.autoLayoutFrames > 0) parts.push(`${stats.autoLayoutFrames} auto-layout`);
  if (stats.absoluteNodes > 0) parts.push(`${stats.absoluteNodes} absolute-positioned`);
  return parts.join(', ');
}

// Format a flat list of resolved variables (de-duped) as a Markdown list.
// Works across one or many UiSpecs — pass the merged array for a shared appendix.
export function formatResolvedVariables(
  resolved: ResolvedVariable[],
  limit = 30
): string | null {
  if (!resolved || resolved.length === 0) {
    return null;
  }

  // De-dupe by collection+name+mode-values. Same logical token can show up
  // multiple times when it's imported from several collections.
  const seen = new Set<string>();
  const deduped: ResolvedVariable[] = [];
  for (const variable of resolved) {
    const sig = `${variable.collection}|${variable.name}|${JSON.stringify(variable.modes)}`;
    if (seen.has(sig)) {
      continue;
    }
    seen.add(sig);
    deduped.push(variable);
  }

  const lines: string[] = [];
  for (const variable of deduped.slice(0, limit)) {
    const modes = Object.entries(variable.modes)
      .map(([mode, value]) => `${mode}=${value}`)
      .join(', ');
    lines.push(`- ${variable.collection}/${variable.name} (${variable.resolvedType}): ${modes}`);
  }
  if (deduped.length > limit) {
    lines.push(`- (${deduped.length - limit} more omitted)`);
  }
  return lines.join('\n');
}

export function buildResolvedTokensSection(uiSpec: UiSpec): string | null {
  return formatResolvedVariables(uiSpec.tokenization.resolvedVariables ?? [], 30);
}

export function buildGroundTruthCss(uiSpec: UiSpec): string {
  const nodes = flattenNodes(uiSpec.root).filter((node) => node.css);
  if (nodes.length === 0) {
    return '- No ground-truth CSS captured for this selection.';
  }

  const lines = ['- Ground-truth CSS from Figma Inspect (computed values):'];
  for (const node of nodes.slice(0, 12)) {
    const css = node.css ?? {};
    const cssLines = Object.entries(css)
      .map(([key, value]) => `      ${key}: ${value};`)
      .join('\n');
    lines.push(`  - ${node.name} (${node.id}) [${node.type}]:`);
    lines.push(cssLines);
  }
  if (nodes.length > 12) {
    lines.push(`  - ...${nodes.length - 12} more nodes with CSS omitted (favour MCP for the rest)`);
  }
  return lines.join('\n');
}

// Returns one entry per annotation: "<node> (<id>): [category] label" (no bullet
// prefix), so callers can render their own list style. Used by both the prompt
// (indented sub-list) and DESIGN.md (top-level bullets).
export function collectAnnotationEntries(uiSpec: UiSpec): string[] {
  const nodes = flattenNodes(uiSpec.root).filter(
    (node) => node.annotations && node.annotations.length > 0
  );
  const entries: string[] = [];
  for (const node of nodes.slice(0, 20)) {
    for (const annotation of node.annotations ?? []) {
      const category = annotation.category ? `[${annotation.category}] ` : '';
      entries.push(`${node.name} (${node.id}): ${category}${annotation.label}`);
    }
  }
  return entries;
}

export function buildDesignerIntent(uiSpec: UiSpec): string {
  const entries = collectAnnotationEntries(uiSpec);
  if (entries.length === 0) {
    return '- No designer annotations on this selection.';
  }

  const lines = ['- Designer intent from Figma annotations:'];
  for (const entry of entries) {
    lines.push(`  - ${entry}`);
  }
  return lines.join('\n');
}

export function collectInstances(uiSpec: UiSpec): UiNodeSpec[] {
  return flattenNodes(uiSpec.root).filter((node) => node.type === 'INSTANCE');
}

// Group + format a flat list of instance nodes. Works across one or many
// UiSpecs — pass the merged array for a shared component inventory.
export function formatInstanceHints(instances: UiNodeSpec[], limit = 15): string | null {
  if (instances.length === 0) {
    return null;
  }

  // De-dupe repeats of the same component with the same variant props.
  const grouped = new Map<
    string,
    { name: string; componentName: string; props: string; count: number }
  >();
  for (const node of instances) {
    const componentName = node.instance?.mainComponentName ?? '?';
    const props = node.instance?.componentProperties
      ? Object.entries(node.instance.componentProperties)
          .map(([key, value]) => `${key}=${String(value)}`)
          .sort()
          .join(', ')
      : '';
    const key = `${componentName}|${props}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, { name: node.name, componentName, props, count: 1 });
    }
  }

  const entries = Array.from(grouped.values()).sort((a, b) => b.count - a.count);
  const lines: string[] = [];
  for (const entry of entries.slice(0, limit)) {
    const countSuffix = entry.count > 1 ? ` ×${entry.count}` : '';
    // Skip the "<instanceName> → <componentName>" arrow when they're the
    // same word (common when an instance is named after its component set).
    const headline =
      entry.name === entry.componentName
        ? entry.componentName
        : `${entry.name} → ${entry.componentName}`;
    const propsTail = entry.props ? ` — ${entry.props}` : '';
    lines.push(`- ${headline}${countSuffix}${propsTail}`);
  }
  if (entries.length > limit) {
    lines.push(`- (${entries.length - limit} more component groups omitted)`);
  }
  return lines.join('\n');
}

export function buildInstanceHints(uiSpec: UiSpec): string | null {
  return formatInstanceHints(collectInstances(uiSpec), 15);
}
