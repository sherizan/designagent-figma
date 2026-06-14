import type {
  ExportedAsset,
  Intent,
  Mode,
  Preset,
  PresetTarget,
  ScoreResult,
  SelectedNodeInfo,
  UiSpec
} from './types';
import { PRESET_DEFINITIONS } from './types';
import {
  buildCompositionSummary,
  buildDesignerIntent,
  buildGroundTruthCss,
  buildInstanceHints,
  buildResolvedTokensSection,
  flattenNodes
} from './serialize';

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
  assets?: ExportedAsset[];
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

function buildVisualReference(assets: ExportedAsset[] | undefined): string {
  if (!assets || assets.length === 0) {
    return '- No visual reference attached.';
  }
  const lines: string[] = ['- An image of the selection is attached to this conversation:'];
  for (const asset of assets) {
    const sizeKb = Math.round(asset.byteLength / 102.4) / 10;
    lines.push(
      `  - ${asset.format}@${asset.scale}x of ${asset.nodeName} (${asset.nodeId}) — ${sizeKb} KB`
    );
  }
  lines.push(
    '- Use vision: inspect the image to verify layout, alignment, spacing, and any visual nuance not captured by the CSS above.',
    '- If no image is attached, ask the user to use the DesignAgent plugin\'s "Save PNG" action and drop the file into the chat.'
  );
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

function appendSection(lines: string[], title: string, body: string | null): void {
  if (!body) {
    return;
  }
  lines.push('', `### ${title}`, body);
}

function buildDesignContext(input: PromptInput): string {
  const size =
    typeof input.selectedNode.width === 'number' && typeof input.selectedNode.height === 'number'
      ? `${Math.round(input.selectedNode.width)}×${Math.round(input.selectedNode.height)}`
      : 'unknown';

  const link = input.selectedNode.link;
  const resolvedVariables = input.uiSpec.tokenization.resolvedVariables ?? [];
  const hasModes = resolvedVariables.some((variable) => Object.keys(variable.modes).length > 1);
  const hasAnnotations = flattenNodes(input.uiSpec.root).some(
    (node) => node.annotations && node.annotations.length > 0
  );
  const hasVisual = !!input.assets && input.assets.length > 0;

  const lines: string[] = [
    '## Design context (authoritative — use values verbatim)',
    `- Selection: ${input.selectedNode.name} [${input.selectedNode.type}] ${size}, id=${input.selectedNode.id}`,
    `- Composition: ${buildCompositionSummary(input.uiSpec)}`,
    link
      ? `- Figma link (use this for any MCP queries): ${link}`
      : '- Figma link: unavailable (no fileKey)'
  ];

  if (input.coverageWarnings.length > 0) {
    lines.push('- Coverage warnings:');
    for (const warning of input.coverageWarnings) {
      lines.push(`  - ${warning}`);
    }
  }

  appendSection(lines, 'Resolved design variables', buildResolvedTokensSection(input.uiSpec));
  if (hasModes) {
    lines.push(
      '',
      '> Variables have 2+ modes. Emit mode-aware code (Tailwind `dark:` variants, SwiftUI dynamic colors, Compose color schemes).'
    );
  }

  appendSection(lines, 'Ground-truth CSS (Figma Inspect, computed)', buildGroundTruthCss(input.uiSpec));
  appendSection(lines, 'Component / instance hints', buildInstanceHints(input.uiSpec));

  if (hasAnnotations) {
    appendSection(
      lines,
      'Designer intent (Figma annotations — priority requirements)',
      buildDesignerIntent(input.uiSpec)
    );
    lines.push(
      '',
      '> Annotations are explicit designer requirements. They override generic conventions.'
    );
  }

  appendSection(lines, 'Visual reference', buildVisualReference(input.assets));
  if (hasVisual) {
    lines.push(
      '',
      '> Inspect the attached image. If CSS conflicts with what you see, trust the image and emit a TODO.'
    );
  }

  return lines.join('\n');
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

  const outputSections: string[] = [];
  let n = 1;
  if (input.flowCapable) {
    outputSections.push(
      `(${n}) Flow Spec — screen order, transitions (from→to + trigger), routes/params or NO_NAV`
    );
    n += 1;
  }
  outputSections.push(`(${n}) File Tree — paths only`);
  n += 1;
  outputSections.push(`(${n}) Code — one fenced block per file, label each with its filepath`);
  n += 1;
  outputSections.push(`(${n}) Open TODOs — only if any; each with node id + exact missing detail`);

  const flowBuildLine = input.flowCapable
    ? [
        '- Flow: produce screen order + transitions internally before coding. Implement shared components only when a structure repeats 2+ times in the hierarchy.'
      ]
    : [];

  return [
    `# Build ${input.selectedNode.name} (${selectionType}) — ${stack.platformName}`,
    '',
    `Stack: ${stack.stackName}. Styling: ${stack.stylingSystem}. Navigation: ${stack.navConvention}.`,
    '',
    '## Source of truth (in order)',
    '1. **Embedded Design context below — authoritative.** Use values verbatim. Do not re-fetch CSS, variables, annotations, or the visual.',
    '2. **Figma MCP (optional).** If anything is unclear, query MCP using the Figma link in the Design context — it points directly at this node. Use MCP for: Code Connect mappings, prototype interactions, additional raster/icon assets inside the frame, or subtree details deeper than what is extracted.',
    '3. **Unresolved → TODO** with node id + exact missing detail. Do not guess.',
    '',
    '## Rules',
    '- Use resolved variables, not raw values. If a variable has 2+ modes, emit mode-aware code (light/dark, density, locale).',
    '- Treat designer annotations as priority requirements — they override generic conventions.',
    '- The Visual reference is a real image; use it to verify alignment, spacing intent, and visual nuance the CSS cannot capture.',
    '- Use design-system components when Code Connect or instance hints map them; otherwise primitives.',
    '- New shared components only if the same structure repeats 2+ times in the hierarchy.',
    '- Determinism: no alternates, no speculative states/screens/flows. Implement only what is evidenced.',
    '- Accessibility: semantic roles + labels; minimum touch target ~44×44.',
    '',
    '## Assets',
    '- For raster/icon assets inside the frame: save under `/assets/images/` (raster) or `/assets/icons/` (vector) and reference local paths.',
    '- If the environment cannot save files, emit `ASSET_TODO: nodeId="..." type=png|svg filename="..." path="..." source="<url|inline>"`.',
    '',
    '## Output (return ONLY these sections)',
    ...outputSections,
    '',
    '## Self-check (silent, do not print)',
    '- No raw values when a resolved variable covers it',
    '- Layout matches the Auto Layout semantics in the CSS',
    '- Mode-aware code wherever variables have 2+ modes',
    '- Every designer annotation is satisfied',
    '- Code matches the Visual reference',
    '- No invented states or screens',
    ...flowBuildLine,
    '',
    buildDesignContext(input),
    '',
    'Execute.'
  ].join('\n');
}

function buildShortPrompt(input: PromptInput): string {
  const definition = PRESET_DEFINITIONS[input.preset];
  const stack = getStackFields(definition.target);
  const selectionType = input.flowCapable ? 'flow' : toIntentScope(input.intent);

  return [
    `Build ${input.selectedNode.name} (${selectionType}) — ${stack.platformName} (${stack.stackName}).`,
    'Source of truth: Embedded Design context (authoritative) > Figma MCP (only for Code Connect, prototype interactions, extra assets) > TODO with node id.',
    'Use resolved variables (mode-aware if 2+ modes). Annotations = priority. Visual reference = base64 image; inspect it. Determinism only.',
    'Output: file tree, code (fenced per file), open TODOs. Flow Spec first if selection type = flow.',
    '',
    buildDesignContext(input)
  ].join('\n');
}

function buildStrictPrompt(input: PromptInput): string {
  return [
    buildTemplatePrompt(input),
    '',
    '## Strict addendum',
    '- Unresolved → TODO. Never guess.',
    '- No alternatives, no multiple implementations.',
    '- Minimal file structure; production-ready for the selected platform.'
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
