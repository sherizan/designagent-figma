import type {
  Intent,
  Mode,
  Preset,
  ScoreResult,
  SelectedNodeInfo,
  UiNodeSpec,
  UiSpec
} from './types';
import { PRESET_DEFINITIONS } from './types';

interface PromptInput {
  preset: Preset;
  intent: Intent;
  selectedNode: SelectedNodeInfo;
  uiSpec: UiSpec;
  score: ScoreResult;
  mode: Mode;
  fallbackReasons: string[];
}

function flattenNodes(root: UiNodeSpec): UiNodeSpec[] {
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

function buildTreeSummary(root: UiNodeSpec, maxLines = 80): string {
  const lines: string[] = [];

  function walk(node: UiNodeSpec, depth: number): void {
    if (lines.length >= maxLines) {
      return;
    }

    const indent = '  '.repeat(depth);
    const size =
      typeof node.width === 'number' && typeof node.height === 'number'
        ? ` ${Math.round(node.width)}x${Math.round(node.height)}`
        : '';
    const layout = node.layout?.layoutMode ? ` layout=${node.layout.layoutMode}` : '';
    lines.push(`${indent}- ${node.name} [${node.type}]${size}${layout}`);

    for (const child of node.children) {
      walk(child, depth + 1);
      if (lines.length >= maxLines) {
        return;
      }
    }
  }

  walk(root, 0);

  if (lines.length >= maxLines) {
    lines.push('- ... truncated for brevity');
  }

  return lines.join('\n');
}

function buildLayoutRules(uiSpec: UiSpec): string {
  const nodes = flattenNodes(uiSpec.root);
  const autoLayoutNodes = nodes.filter(
    (node) => node.layout?.layoutMode && node.layout.layoutMode !== 'NONE'
  );
  const absoluteNodes = nodes.filter((node) => node.layout?.layoutPositioning === 'ABSOLUTE');

  const lines: string[] = [
    `- Preserve detected Auto Layout semantics from Figma (count=${autoLayoutNodes.length}).`,
    `- Absolute-positioned nodes detected=${absoluteNodes.length}; keep only when needed for overlays/decorative elements.`
  ];

  for (const node of autoLayoutNodes.slice(0, 10)) {
    lines.push(
      `- ${node.name} (${node.id}): mode=${node.layout?.layoutMode}, gap=${node.layout?.itemSpacing ?? 0}, padding=[${node.layout?.paddingTop ?? 0}, ${node.layout?.paddingRight ?? 0}, ${node.layout?.paddingBottom ?? 0}, ${node.layout?.paddingLeft ?? 0}], align=${node.layout?.primaryAxisAlignItems ?? 'MIN'} / ${node.layout?.counterAxisAlignItems ?? 'MIN'}.`
    );
  }

  if (autoLayoutNodes.length === 0) {
    lines.push('- No reliable Auto Layout containers detected; infer minimal deterministic layout hierarchy.');
  }

  return lines.join('\n');
}

function buildTokenSection(uiSpec: UiSpec): string {
  const nodes = flattenNodes(uiSpec.root);
  const tokenNodes = nodes.filter(
    (node) => node.tokenHints.styleRefs + node.tokenHints.variableRefs > 0
  );
  const rawNodes = nodes.filter((node) => node.tokenHints.rawValueHints > 0);

  const lines: string[] = [
    `- Token/style refs: styles=${uiSpec.tokenization.styleRefs}, variables=${uiSpec.tokenization.variableRefs}, coverage=${Math.round(uiSpec.tokenization.coverage * 100)}%.`,
    '- Prefer variable/style references over literal values. If a token exists in MCP, never guess literal token values.'
  ];

  if (tokenNodes.length > 0) {
    lines.push('- Known tokenized nodes:');
    for (const node of tokenNodes.slice(0, 12)) {
      lines.push(
        `  - ${node.name} (${node.id}): styleRefs=${node.tokenHints.styleRefs}, variableRefs=${node.tokenHints.variableRefs}`
      );
    }
  }

  if (rawNodes.length > 0) {
    lines.push('- Raw-value fallbacks (use only when MCP has no token reference):');
    for (const node of rawNodes.slice(0, 12)) {
      lines.push(`  - ${node.name} (${node.id}): rawHints=${node.tokenHints.rawValueHints}`);
    }
  }

  return lines.join('\n');
}

function buildComponentMapping(uiSpec: UiSpec): string {
  const nodes = flattenNodes(uiSpec.root).filter((node) => node.type === 'INSTANCE');
  if (nodes.length === 0) {
    return '- No instance nodes detected. Map interactive candidates to design-system components where possible.';
  }

  const lines = ['- Instance to component mapping:'];
  for (const node of nodes.slice(0, 20)) {
    const props = node.instance?.componentProperties
      ? Object.entries(node.instance.componentProperties)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(', ')
      : 'no variant props detected';

    lines.push(
      `  - ${node.name} (${node.id}) -> ${node.instance?.mainComponentName ?? 'unknown component'} | key=${node.instance?.mainComponentKey ?? 'n/a'} | props: ${props}`
    );
  }

  return lines.join('\n');
}

function buildInteractionGuidance(intent: Intent, preset: Preset): string {
  const baseLines = [
    '- Implement only obvious control states from design evidence: default, focus/pressed, disabled where relevant.',
    '- Do not invent multi-step flows or hidden states not implied by the selected node.'
  ];

  if (preset === 'nextjs-tailwind-shadcn') {
    baseLines.push('- Use semantic HTML elements and shadcn state patterns for controls.');
  } else {
    baseLines.push('- Use RN Pressable/TextInput/Switch state handling with NativeWind classes.');
  }

  if (intent === 'component') {
    baseLines.push('- Treat output as reusable component API with deterministic props and state variants.');
  }

  return baseLines.join('\n');
}

function buildAccessibilityGuidance(preset: Preset): string {
  const lines = [
    '- Ensure interactive targets are at least 44x44 px/pt.',
    '- Add explicit labels/accessible names for actionable controls.',
    '- Keep focus order logical and visible focus/active affordances.'
  ];

  if (preset === 'react-native-expo-nativewind') {
    lines.push('- Use accessibilityRole/accessibilityLabel/accessibilityHint on RN interactive elements.');
  } else {
    lines.push('- Use aria-* attributes and keyboard focus handling for web components.');
  }

  return lines.join('\n');
}

function buildAcceptanceCriteria(mode: Mode): string {
  const lines = [
    '- Match hierarchy, spacing, and typography to extracted uiSpec within practical rendering tolerance.',
    '- Reuse DS components for interactive elements before creating custom primitives.',
    '- Preserve Auto Layout intent (direction, spacing, padding, alignment).',
    '- Do not guess token values when token references are available via MCP.',
    '- Keep implementation deterministic and avoid speculative behavior.'
  ];

  if (mode === 'fidelity') {
    lines.push('- Fidelity mode active: use primitives where DS mapping is insufficient, while still applying known tokens.');
  }

  return lines.join('\n');
}

function buildMcpInstructions(selectedNode: SelectedNodeInfo): string {
  return [
    '- Use Figma MCP to fetch missing truth for node properties, variables, and component definitions by node ID.',
    `- Primary node for MCP lookup: ${selectedNode.id}. Query descendants when a property is unclear or missing.`,
    '- Prefer MCP-fetched values over inference whenever a conflict appears.',
    '- Do not guess token values if MCP exposes variable/style bindings.'
  ].join('\n');
}

function buildModeSection(mode: Mode, fallbackReasons: string[]): string {
  if (mode === 'fidelity') {
    const reasons = fallbackReasons.length > 0 ? fallbackReasons.join(' | ') : 'Fallback triggers met.';
    return [
      '- Mode: Fidelity mode',
      `- Why: ${reasons}`,
      '- Build with primitives when DS mapping is unreliable, but still use tokens/styles wherever available.'
    ].join('\n');
  }

  return [
    '- Mode: System-first',
    '- Prioritize DS instances/components, token bindings, and Auto Layout semantics before primitive recreation.',
    '- Switch to fidelity tactics only for unresolved areas after MCP checks.'
  ].join('\n');
}

function buildProjectContext(preset: Preset): string {
  const definition = PRESET_DEFINITIONS[preset];
  return `- Preset: ${definition.label}\n- ${definition.projectContext}`;
}

function buildTaskLine(intent: Intent, preset: Preset): string {
  const definition = PRESET_DEFINITIONS[preset];
  return `- Build a production-grade ${intent} from the selected Figma node. ${definition.taskHint}`;
}

export function generateBuildPrompt(input: PromptInput): string {
  const { preset, intent, selectedNode, uiSpec, score, mode, fallbackReasons } = input;

  const sizeInfo =
    typeof selectedNode.width === 'number' && typeof selectedNode.height === 'number'
      ? `${Math.round(selectedNode.width)} x ${Math.round(selectedNode.height)}`
      : 'unknown size';

  return [
    '1. Project context',
    buildProjectContext(preset),
    '',
    '2. Task',
    buildTaskLine(intent, preset),
    '',
    '3. Design source',
    `- Selected node: ${selectedNode.name} (${selectedNode.type})`,
    `- Node ID(s): ${selectedNode.id}`,
    `- Size: ${sizeInfo}`,
    '',
    '4. UI structure',
    '- Recreate this hierarchy:',
    buildTreeSummary(uiSpec.root),
    '',
    '5. Layout rules',
    buildLayoutRules(uiSpec),
    '',
    '6. Tokens + variables',
    buildTokenSection(uiSpec),
    '',
    '7. Components mapping',
    buildComponentMapping(uiSpec),
    '',
    '8. Interactions/states',
    buildInteractionGuidance(intent, preset),
    '',
    '9. Accessibility',
    buildAccessibilityGuidance(preset),
    '',
    '10. Acceptance criteria',
    buildAcceptanceCriteria(mode),
    `- AI-ready score target: maintain or improve current ${score.total}/100 in generated output.`,
    '',
    '11. MCP instructions',
    buildMcpInstructions(selectedNode),
    '',
    '12. Mode: System-first or Fidelity mode',
    buildModeSection(mode, fallbackReasons)
  ].join('\n');
}
