import type {
  Intent,
  Mode,
  Preset,
  PresetTarget,
  ScoreResult,
  SelectedNodeInfo,
  UiNodeSpec,
  UiSpec
} from './types';
import { PRESET_DEFINITIONS } from './types';

export interface PromptBundle {
  full: string;
  short: string;
  strict: string;
}

interface PromptInput {
  preset: Preset;
  mode: Mode;
  intent: Intent;
  selectedNode: SelectedNodeInfo;
  uiSpec: UiSpec;
  score: ScoreResult;
  coverageWarnings: string[];
}

interface StackFields {
  platformName: string;
  stackName: string;
  stylingSystem: string;
  navConvention: string;
}

function getStackFields(target: PresetTarget): StackFields {
  switch (target) {
    case 'web-nextjs':
      return {
        platformName: 'Web React',
        stackName: 'Next.js App Router + TypeScript + Tailwind + shadcn/ui',
        stylingSystem: 'Tailwind CSS utility classes + shadcn/ui component styling',
        navConvention:
          'Use Next.js App Router route placeholders only when required by the selected UI; otherwise omit navigation'
      };
    case 'native-rn-expo':
      return {
        platformName: 'React Native (Expo)',
        stackName: 'Expo + TypeScript + NativeWind',
        stylingSystem: 'NativeWind classes with React Native primitives',
        navConvention: 'Use expo-router placeholders only when required by the selected UI'
      };
    case 'web-html-css':
      return {
        platformName: 'Web (Pure HTML/CSS)',
        stackName: 'Semantic HTML + plain CSS',
        stylingSystem: 'CSS classes and variables (no framework assumptions)',
        navConvention:
          'No router/framework assumptions; add page/link placeholders only when required by selected UI'
      };
    case 'native-swiftui':
      return {
        platformName: 'iOS SwiftUI',
        stackName: 'SwiftUI',
        stylingSystem: 'SwiftUI modifiers + Theme struct (Color/Font/Spacing)',
        navConvention:
          'Use NavigationStack placeholders only when multiple screens are explicitly required by selected UI'
      };
    case 'native-compose':
      return {
        platformName: 'Android Jetpack Compose',
        stackName: 'Kotlin + Jetpack Compose + Material3',
        stylingSystem: 'Compose Material theme + Modifier chains + token constants',
        navConvention:
          'Use Navigation Compose placeholders only when required by selected UI; no flow generation in free mode'
      };
    default:
      return {
        platformName: 'Web React',
        stackName: 'TypeScript UI stack',
        stylingSystem: 'Design-system styling',
        navConvention: 'Navigation placeholders only when required'
      };
  }
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

function buildTreeSummary(root: UiNodeSpec, maxLines = 40): string {
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
    lines.push('- ... truncated');
  }

  return lines.join('\n');
}

function buildTokenHints(uiSpec: UiSpec): string {
  const nodes = flattenNodes(uiSpec.root);
  const tokenNodes = nodes.filter(
    (node) => node.tokenHints.styleRefs + node.tokenHints.variableRefs > 0
  );
  const rawNodes = nodes.filter((node) => node.tokenHints.rawValueHints > 0);

  const lines = [
    `- Token coverage estimate: ${Math.round(uiSpec.tokenization.coverage * 100)}% (styles=${uiSpec.tokenization.styleRefs}, vars=${uiSpec.tokenization.variableRefs}, rawCandidates=${uiSpec.tokenization.rawValueCandidates})`
  ];

  if (tokenNodes.length > 0) {
    lines.push('- Token/style-backed nodes:');
    for (const node of tokenNodes.slice(0, 10)) {
      lines.push(
        `  - ${node.name} (${node.id}) styleRefs=${node.tokenHints.styleRefs}, variableRefs=${node.tokenHints.variableRefs}`
      );
    }
  }

  if (rawNodes.length > 0) {
    lines.push('- Raw fallback candidates (only if MCP has no token binding):');
    for (const node of rawNodes.slice(0, 10)) {
      lines.push(`  - ${node.name} (${node.id}) rawHints=${node.tokenHints.rawValueHints}`);
    }
  }

  return lines.join('\n');
}

function buildInstanceHints(uiSpec: UiSpec): string {
  const instances = flattenNodes(uiSpec.root).filter((node) => node.type === 'INSTANCE');

  if (instances.length === 0) {
    return '- No instance nodes extracted in current selection.';
  }

  const lines = ['- Instance hints from extraction:'];
  for (const node of instances.slice(0, 15)) {
    const props = node.instance?.componentProperties
      ? Object.entries(node.instance.componentProperties)
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(', ')
      : 'no variant props';

    lines.push(
      `  - ${node.name} (${node.id}) -> ${node.instance?.mainComponentName ?? 'unknown component'} | ${props}`
    );
  }

  return lines.join('\n');
}

function toIntentScope(intent: Intent): string {
  if (intent === 'screen') {
    return 'screen';
  }

  if (intent === 'component') {
    return 'component';
  }

  return 'section (reusable module)';
}

function toModeLabel(mode: Mode): string {
  return mode === 'fidelity-first' ? 'Fidelity-first' : 'System-first';
}

function buildSelectionContext(input: PromptInput): string {
  const size =
    typeof input.selectedNode.width === 'number' && typeof input.selectedNode.height === 'number'
      ? `${Math.round(input.selectedNode.width)} x ${Math.round(input.selectedNode.height)}`
      : 'unknown';

  const warnings =
    input.coverageWarnings.length > 0
      ? input.coverageWarnings.map((warning) => `- ${warning}`).join('\n')
      : '- none';

  return [
    `- Intent scope: ${toIntentScope(input.intent)}`,
    `- Active mode: ${toModeLabel(input.mode)}`,
    `- Selected node: ${input.selectedNode.name} (${input.selectedNode.type})`,
    `- Node ID(s): ${input.selectedNode.id}`,
    `- Selection link: ${input.selectedNode.link ?? 'Unavailable (paste a link base in plugin Advanced panel if needed)'}`,
    `- Size: ${size}`,
    `- AI-ready score baseline: ${input.score.total}/100`,
    '- Coverage warnings:',
    warnings,
    '- Extracted hierarchy snapshot:',
    buildTreeSummary(input.uiSpec.root),
    '- Token/style extraction hints:',
    buildTokenHints(input.uiSpec),
    '- Component/instance extraction hints:',
    buildInstanceHints(input.uiSpec)
  ].join('\n');
}

function buildTemplatePrompt(input: PromptInput): string {
  const definition = PRESET_DEFINITIONS[input.preset];
  const stack = getStackFields(definition.target);
  const implementationScope =
    input.intent === 'screen'
      ? 'screen'
      : input.intent === 'component'
      ? 'component'
        : 'section module/view';
  const platformLayoutRule =
    definition.target === 'native-swiftui'
      ? [
          '   - SwiftUI layout mapping: use VStack/HStack/ZStack according to MCP hierarchy, axis direction, and nesting.'
        ]
      : [];

  return [
    'You are an implementation agent. Your job is to produce production-quality code that matches the user\'s selected Figma screen/component, using the **Figma MCP** server as the only ground-truth oracle.',
    '',
    '## 0) Hard constraints (must follow)',
    '- Use **Figma MCP** tools only for design truth. Do NOT use any other MCP/server/tool for design extraction.',
    '- Do NOT guess values that can be retrieved from **Figma MCP** (layout, spacing, typography, colors, tokens, component bindings).',
    '- If information is missing/ambiguous, query **Figma MCP**. If still unresolved, mark as TODO with the exact missing detail.',
    '- Prefer design-system components and tokens over primitives. Only use primitives when DS mapping is not supported by **Figma MCP** evidence.',
    '- If Code Connect mapping exists for a node, you MUST use that mapped component.',
    '- You MAY NOT introduce new reusable components unless the same structure appears 2+ times in the MCP hierarchy.',
    '- Keep output deterministic: no alternate designs, no extra features, no speculative flows.',
    '',
    '## 1) Target platform / stack (fill these)',
    `- Platform: ${stack.platformName}`,
    `- Stack / framework: ${stack.stackName}`,
    `- Styling system: ${stack.stylingSystem}`,
    `- Navigation: ${stack.navConvention}`,
    '',
    '## 2) Figma MCP tool usage plan (must execute in order)',
    'A) Call **Figma MCP**: get_design_context for the current user selection',
    '   - Include full hierarchy, auto-layout semantics, constraints, text styles, fills/strokes, effects, corner radii, spacing.',
    'B) Call **Figma MCP**: get_variable_defs for the same selection',
    '   - Extract all variables + styles actually used by the selection.',
    'C) Call **Figma MCP**: get_code_connect_map for the selection',
    '   - If mappings exist, use them as the primary component mapping.',
    'D) Call **Figma MCP**: get_screenshot for the selection',
    '   - Use only to resolve visual ambiguities not represented in structured properties.',
    '',
    'Stop and re-query **Figma MCP** for any child node ONLY when required to resolve a missing/ambiguous property.',
    '',
    '## 3) Build procedure (deterministic)',
    '1) Produce a “Design Extraction Summary” from **Figma MCP**:',
    '   - Screen sections (top-to-bottom)',
    '   - For each section: layout type, spacing, key components, and token usage',
    '   - You MUST avoid re-ordering sections; follow MCP child order.',
    '2) Produce a “Component & Token Mapping Table”:',
    `   - Figma node → ${stack.platformName} component (or DS component if Code Connect map exists)`,
    '   - Tokens/variables used (names/ids). Never guess raw values if tokens exist.',
    `3) Implement the ${implementationScope} for ${stack.platformName}:`,
    `   - Create the primary ${implementationScope} entry file appropriate for ${stack.platformName}/${stack.stackName}`,
    ...platformLayoutRule,
    '   - Create reusable subcomponents only if the **Figma MCP** hierarchy shows repetition (2+ instances).',
    '   - Create a tokens bridge only if needed:',
    '     - If variables resolve to semantic tokens, reference them (do not invent raw values)',
    '     - If **Figma MCP** provides raw values without tokens, encode them as constants in a single theme file',
    '4) States:',
    '   - Implement only safe minimal states derived from **Figma MCP**: default + pressed/disabled if evidenced.',
    '5) Accessibility:',
    '   - Add platform-appropriate accessibility semantics for interactive elements',
    '   - Ensure minimum touch target ~44x44 and add hitSlop/spacing where needed',
    '',
    '## 4) Output format (must match exactly)',
    'Return in this order:',
    '',
    '### (1) Figma MCP Calls Performed',
    'List each **Figma MCP** call you made with:',
    '- tool name',
    '- selection scope (current selection / node ids returned)',
    '- why it was needed',
    '',
    '### (2) Design Extraction Summary',
    'Bullet summary of hierarchy and layout decisions (grounded in **Figma MCP**).',
    '',
    '### (3) Component & Token Mapping Table',
    'A compact table: Node → Implementation → Tokens/Vars → Notes (UNKNOWN/TODO if any)',
    '',
    '### (4) File Tree',
    'Show the exact files you created/modified.',
    '',
    '### (5) Code',
    'Provide complete code for each file in separate fenced blocks, labeled with the filepath.',
    '',
    '## 5) Acceptance checks (self-check before final)',
    '- DS/token discipline: no raw values when **Figma MCP** tokens/vars exist.',
    '- Layout fidelity: auto-layout direction, spacing, padding, alignment matches **Figma MCP**.',
    '- No invented features or flows.',
    '- Any uncertainty is explicitly captured as TODO + what **Figma MCP** data was missing.',
    '',
    'Execute now.'
  ].join('\n');
}

function buildShortPrompt(input: PromptInput): string {
  const definition = PRESET_DEFINITIONS[input.preset];
  const stack = getStackFields(definition.target);

  return [
    'You are an implementation agent using only Figma MCP for design truth.',
    `Platform: ${stack.platformName}`,
    `Stack: ${stack.stackName}`,
    `Scope: ${toIntentScope(input.intent)} for node ${input.selectedNode.id} (${input.selectedNode.name})`,
    'Use get_design_context -> get_variable_defs -> get_code_connect_map -> get_screenshot in that order.',
    'Output: MCP calls, extraction summary, mapping table, file tree, full code, acceptance checks.'
  ].join('\n');
}

function buildStrictPrompt(input: PromptInput): string {
  return [
    buildTemplatePrompt(input),
    '',
    'Strict addendum',
    '- If any required value is unresolved after MCP queries, do not guess. Emit TODO with the exact missing MCP datum.',
    '- Do not output alternatives or multiple implementations.',
    '- Keep file structure minimal and production-ready for the selected platform.'
  ].join('\n');
}

export function generatePromptBundle(input: PromptInput): PromptBundle {
  return {
    full: buildTemplatePrompt(input),
    short: buildShortPrompt(input),
    strict: buildStrictPrompt(input)
  };
}

export function generateBuildPrompt(input: PromptInput): string {
  return generatePromptBundle(input).full;
}
