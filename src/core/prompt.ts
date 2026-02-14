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
  flowCapable: boolean;
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
        stackName: 'Next.js App Router + TypeScript + Tailwind',
        stylingSystem: 'Tailwind CSS utility classes (shadcn/ui optional)',
        navConvention:
          'Use Next.js App Router route placeholders only when required by the selected UI; otherwise omit navigation'
      };
    case 'native-rn-expo':
      return {
        platformName: 'React Native',
        stackName: 'Expo + TypeScript',
        stylingSystem: 'NativeWind classes with React Native primitives',
        navConvention: 'Use expo-router placeholders only when required by the selected UI'
      };
    case 'web-html-css':
      return {
        platformName: 'Web (HTML/CSS)',
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
  const selectionType = input.flowCapable
    ? 'flow'
    : input.intent === 'screen'
    ? 'screen'
    : input.intent === 'component'
    ? 'component'
    : 'section';
  const selectionLink = input.selectedNode.link ?? '[REQUIRED] paste "Copy link to selection" URL';
  const flowOutputHeader = input.flowCapable
    ? [
        '### (1) Flow Spec',
        '- Screen order',
        '- Transitions (From → To + trigger)',
        '- Routes/params (or NO_NAV)',
        ''
      ]
    : [];
  const flowBuildSection = selectionType === 'screen'
    ? []
    : [
        '### 5.1 Selection type = flow (multi-screen)',
        '1) Produce a Flow Spec (internally) before coding:',
        '   - Screen order (explicit list; if ORDER_UNKNOWN, derive from prototype links)',
        '   - Transitions: From → To + trigger',
        '   - Routes/params (or NO_NAV if navigation not required)',
        '   - Shared components to extract (only if repeated 2+ times)',
        '2) Implement shared layer first:',
        '   - token bridge (only if needed)',
        '   - repeated components (only if repetition is proven by MCP)',
        '3) Implement screens in Flow Spec order:',
        '   - one file per screen',
        '   - wire navigation minimally and consistently (only if required)',
        '4) Interaction logic:',
        '   - implement only evidenced interactions (prototype links, interactive instances, component variants)',
        '   - no invented states beyond default + pressed/disabled if evidenced',
        ''
      ];

  return [
    'You are an implementation agent.',
    '',
    `Implement this ${input.selectedNode.name} (${selectionType}) as production-quality code.`,
    '',
    `Link: ${selectionLink}`,
    '',
    'Use the **Figma MCP** server as the ONLY ground-truth for design + interactions.',
    '',
    '## 1) Hard constraints (must follow)',
    '- Use **Figma MCP** tools only for design truth. Do NOT use any other MCP/server/tool for design extraction.',
    '- Do NOT guess values that can be retrieved from **Figma MCP** (layout, spacing, typography, colors, tokens, component bindings, interactions).',
    '- If missing/ambiguous, query **Figma MCP**. If still unresolved, add a TODO with exact missing detail + node id.',
    '- Prefer design-system components and tokens over primitives. Use primitives only when DS mapping is not supported by MCP evidence.',
    '- If Code Connect mapping exists for a node, you MUST use that mapped component/snippet.',
    '- You MAY NOT introduce new reusable components unless the same structure appears 2+ times in the MCP hierarchy.',
    '- Keep output deterministic: no alternate designs, no extra features, no speculative flows.',
    '',
    '## 2) Target stack',
    `- Platform: ${stack.platformName}`,
    `- Stack: ${stack.stackName}`,
    `- Styling: ${stack.stylingSystem}`,
    '- Navigation:',
    '  - Only if selection type = flow OR prototype links require it.',
    `  - ${stack.navConvention}`,
    '',
    '## 3) Figma MCP usage plan (token-efficient; execute in order)',
    'IMPORTANT: Use the actual Figma MCP tool names available. If names differ, use the closest equivalents.',
    '',
    'A) SHALLOW DESIGN CONTEXT FIRST',
    '- Fetch design context for the selection scope with shallow depth:',
    '  - root node + immediate children + key layout properties (auto-layout, padding/gap, constraints), text styles, fills/strokes/effects, radii.',
    '- Only descend into child nodes when needed to resolve:',
    '  - interactive elements, component instances, or ambiguous layout.',
    '',
    'B) TOKENS / VARIABLES / STYLES (USED ONLY)',
    '- Fetch variables/styles that are actually USED by the selection(s).',
    '- Record variable/style ids + names. Prefer referencing token identities over dumping raw values.',
    '',
    'C) CODE CONNECT',
    '- Fetch Code Connect mappings for the selection(s).',
    '- If mapping exists, treat it as authoritative imports/components/props guidance.',
    '',
    'D) INTERACTIONS / PROTOTYPE',
    '- Fetch prototype interactions/reactions for the relevant nodes/screens.',
    '- Derive a deterministic interaction contract: event → state change → navigation transition.',
    '',
    'E) SCREENSHOT (LAST RESORT ONLY)',
    '- Fetch screenshot only if a critical visual ambiguity cannot be resolved via structured MCP properties.',
    '',
    'Stop and re-query MCP for deeper descendants ONLY when strictly required.',
    '',
    '## 4) Assets (IMPORTANT: manual/local saving)',
    'Figma MCP may return image URLs. You MUST ensure assets are referenced locally in the codebase:',
    '- The best way to ensure images are always available is to download them to the codebase and reference local files instead.',
    '- You can do this by visiting each URL and saving the files manually, OR (depending on the client) ask the AI agent to save them to the folder of your choice.',
    'Implementation rules:',
    '- If the design contains raster images (PNG/JPG/WebP), plan to save them under: /assets/images/',
    '- If the design contains icons/illustrations intended as vectors, save as: /assets/icons/ (prefer SVG where applicable)',
    '- In code, reference the local asset paths (do not reference remote URLs in production code).',
    '- If you cannot download/save files in this environment, output ASSET_TODO items listing:',
    '  - node id',
    '  - asset type (png/svg/etc.)',
    '  - suggested filename',
    '  - target folder path',
    '  - the source URL returned by MCP (if provided)',
    '',
    '## 5) Build procedure (deterministic)',
    '',
    ...flowBuildSection,
    `### 5.2 Selection type = ${input.intent === 'screen' ? 'screen' : input.intent === 'component' ? 'component' : 'section'}`,
    input.intent === 'screen'
      ? '- Implement one screen file.'
      : input.intent === 'component'
      ? '- Implement component with props/variants based on MCP + Code Connect (if present).'
      : '- Implement this section as a reusable module and show how it mounts into a screen.',
    'Interaction logic:',
    '- implement only evidenced interactions (pressed/disabled if evidenced; prototype actions if present).',
    '',
    'Accessibility:',
    '- Add accessibilityLabel/accessibilityRole and hitSlop for small controls.',
    '- Ensure minimum touch target ~44x44.',
    '',
    '## 6) Interaction contract (derive from MCP; implement only what is evidenced)',
    'For each interactive element (buttons, chips, tabs, inputs, list items) that MCP indicates:',
    '- Node id + label/name',
    '- Event (tap/press/select/submit/change/back/close/swipe) only if evidenced',
    '- State changes (selected/expanded/input value/loading/error) only if evidenced',
    '- Navigation (route + params) only if in Flow Spec',
    'If uncertain, query MCP interactions; otherwise mark TODO.',
    '',
    '## 7) Output format (token-efficient; must follow)',
    'Return ONLY:',
    '',
    ...flowOutputHeader,
    '### (2) File Tree',
    '- List file paths created/modified (paths only)',
    '',
    '### (3) Code',
    '- Provide complete code for each file in separate fenced blocks labeled with filepath',
    '',
    '### (4) Open TODOs (ONLY if any)',
    '- Bullet list of unresolved items with exact missing MCP detail + node id',
    '',
    '## 8) Self-check (do silently; do not print)',
    '- No raw values when MCP vars/tokens exist',
    '- Layout matches MCP auto-layout semantics (direction, padding/gap, alignment)',
    '- No invented screens/features/flows',
    '- Interactions match MCP/prototype evidence',
    '- Any uncertainty becomes TODO with node id + missing MCP detail',
    '',
    'Execute now.'
  ].join('\n');
}

function buildShortPrompt(input: PromptInput): string {
  const definition = PRESET_DEFINITIONS[input.preset];
  const stack = getStackFields(definition.target);

  return [
    'You are an implementation agent using only Figma MCP for design truth.',
    `Implement ${input.selectedNode.name} (${input.flowCapable ? 'flow' : toIntentScope(input.intent)}).`,
    `Link: ${input.selectedNode.link ?? '[REQUIRED] paste selection link'}`,
    `Platform: ${stack.platformName} | Stack: ${stack.stackName}`,
    'Use MCP in order: shallow context -> used tokens/styles -> code connect -> interactions (if needed) -> screenshot (last resort).',
    'Output only: flow spec (if flow), file tree, code, open TODOs.'
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
