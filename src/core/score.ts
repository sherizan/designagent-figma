import type {
  ChecklistItem,
  Mode,
  ScoreCategory,
  ScoreResult,
  UiNodeSpec,
  UiSpec
} from './types';

interface FlatNode {
  node: UiNodeSpec;
  parent: UiNodeSpec | null;
}

const INTERACTIVE_NAME_HINT =
  /(button|btn|input|field|toggle|switch|tab|chip|dropdown|select|nav)/i;

const GENERIC_NAME_PATTERN =
  /^(rectangle|frame|group|text|ellipse|line|vector|polygon|star|section|instance|component)\s*\d+$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function flattenTree(root: UiNodeSpec): FlatNode[] {
  const queue: FlatNode[] = [{ node: root, parent: null }];
  const result: FlatNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    result.push(current);

    for (const child of current.node.children) {
      queue.push({ node: child, parent: current.node });
    }
  }

  return result;
}

function isInteractiveCandidate(node: UiNodeSpec): boolean {
  return node.type === 'INSTANCE' || INTERACTIVE_NAME_HINT.test(node.name);
}

function hasVariantProps(node: UiNodeSpec): boolean {
  const properties = node.instance?.componentProperties;
  return Boolean(properties && Object.keys(properties).length > 0);
}

function checklistItem(
  category: ScoreCategory,
  node: UiNodeSpec,
  reason: string,
  suggestion: string
): ChecklistItem {
  return {
    category,
    nodeId: node.id,
    nodeName: node.name,
    reason,
    suggestion
  };
}

function groupChecklist(checklist: ChecklistItem[]): Record<ScoreCategory, ChecklistItem[]> {
  return {
    'Component Coverage': checklist.filter((item) => item.category === 'Component Coverage'),
    'Tokenization Coverage': checklist.filter((item) => item.category === 'Tokenization Coverage'),
    'Layout Semantics': checklist.filter((item) => item.category === 'Layout Semantics'),
    'Naming + Semantics': checklist.filter((item) => item.category === 'Naming + Semantics'),
    'Variant Completeness': checklist.filter((item) => item.category === 'Variant Completeness')
  };
}

export interface ScoreComputationResult {
  score: ScoreResult;
  checklist: ChecklistItem[];
  checklistByCategory: Record<ScoreCategory, ChecklistItem[]>;
  mode: Mode;
  fallbackReasons: string[];
}

export function scoreUiSpec(uiSpec: UiSpec): ScoreComputationResult {
  const nodes = flattenTree(uiSpec.root);
  const checklist: ChecklistItem[] = [];

  const interactiveCandidates = nodes.filter(({ node }) => isInteractiveCandidate(node));
  const interactiveInstances = interactiveCandidates.filter(({ node }) => node.type === 'INSTANCE');

  const componentCoverageRatio =
    interactiveCandidates.length > 0
      ? interactiveInstances.length / interactiveCandidates.length
      : 1;
  const componentCoverage = Math.round(componentCoverageRatio * 30);

  for (const candidate of interactiveCandidates) {
    if (candidate.node.type !== 'INSTANCE') {
      checklist.push(
        checklistItem(
          'Component Coverage',
          candidate.node,
          'Interactive candidate is not mapped to a design system instance.',
          'Replace with DS component instance (Button/Input/Control) from your component library.'
        )
      );
    }
  }

  const tokenRefs = uiSpec.tokenization.styleRefs + uiSpec.tokenization.variableRefs;
  const rawTokenCandidates = uiSpec.tokenization.rawValueCandidates;
  const tokenizationRatio =
    tokenRefs + rawTokenCandidates > 0 ? tokenRefs / (tokenRefs + rawTokenCandidates) : 0.5;
  const tokenizationCoverage = Math.round(tokenizationRatio * 25);

  for (const { node } of nodes) {
    const hasRawValues = node.tokenHints.rawValueHints > 0;
    const hasTokenRefs = node.tokenHints.styleRefs + node.tokenHints.variableRefs > 0;
    if (hasRawValues && !hasTokenRefs) {
      checklist.push(
        checklistItem(
          'Tokenization Coverage',
          node,
          'Node uses raw visual values without style or variable bindings.',
          node.type === 'TEXT'
            ? 'Apply a text style and bind typography tokens/variables.'
            : 'Bind fill/stroke/effect to variables or apply design system styles.'
        )
      );
    }
  }

  const frameLikeNodes = nodes.filter(({ node }) =>
    ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(node.type)
  );
  const autoLayoutNodes = nodes.filter(
    ({ node }) => node.layout?.layoutMode && node.layout.layoutMode !== 'NONE'
  );
  const absoluteNodes = nodes.filter(
    ({ node }) => node.layout?.layoutPositioning === 'ABSOLUTE'
  );
  const groupNodes = nodes.filter(({ node }) => node.type === 'GROUP');

  const autoLayoutRatio =
    frameLikeNodes.length > 0 ? autoLayoutNodes.length / frameLikeNodes.length : 0;
  const absoluteRatio = nodes.length > 0 ? absoluteNodes.length / nodes.length : 0;
  const groupRatio = nodes.length > 0 ? groupNodes.length / nodes.length : 0;

  const layoutComposite = clamp(
    autoLayoutRatio * 0.7 + (1 - absoluteRatio) * 0.2 + (1 - groupRatio) * 0.1,
    0,
    1
  );
  const layoutSemantics = Math.round(layoutComposite * 20);

  for (const { node } of absoluteNodes) {
    checklist.push(
      checklistItem(
        'Layout Semantics',
        node,
        'Absolute positioning increases ambiguity for generated code layout.',
        'Convert to Auto Layout flow and avoid absolute positioning unless required for overlays.'
      )
    );
  }

  for (const { node } of frameLikeNodes) {
    if (node.children.length > 1 && node.layout?.layoutMode === 'NONE') {
      checklist.push(
        checklistItem(
          'Layout Semantics',
          node,
          'Container has multiple children but no Auto Layout semantics.',
          'Apply Auto Layout and set spacing/padding/alignment explicitly.'
        )
      );
    }
  }

  const genericNames = nodes.filter(({ node }) => GENERIC_NAME_PATTERN.test(node.name));
  const semanticNameRatio = nodes.length > 0 ? 1 - genericNames.length / nodes.length : 1;
  const namingSemantics = Math.round(clamp(semanticNameRatio, 0, 1) * 15);

  for (const { node } of genericNames) {
    checklist.push(
      checklistItem(
        'Naming + Semantics',
        node,
        'Layer name is generic and weakens deterministic UI mapping.',
        'Rename layer semantically (role + content), e.g., Primary CTA / Email Input / Header Card.'
      )
    );
  }

  const instances = nodes.filter(({ node }) => node.type === 'INSTANCE');
  const completeVariants = instances.filter(({ node }) => hasVariantProps(node));
  const variantRatio = instances.length > 0 ? completeVariants.length / instances.length : 1;
  const variantCompleteness = Math.round(variantRatio * 10);

  for (const { node } of instances) {
    if (!hasVariantProps(node)) {
      checklist.push(
        checklistItem(
          'Variant Completeness',
          node,
          'Instance does not expose variant/component properties in the extracted spec.',
          'Set explicit variant props (size/state/intent) on this instance.'
        )
      );
    }
  }

  const total =
    componentCoverage +
    tokenizationCoverage +
    layoutSemantics +
    namingSemantics +
    variantCompleteness;

  const noComponentMatchTrigger =
    interactiveCandidates.length > 0 && componentCoverageRatio < 0.5;
  const tokenCoverageLowTrigger = tokenizationCoverage < 13;
  const layoutAmbiguousTrigger = absoluteRatio > 0.35 || layoutSemantics < 10;

  const fallbackReasons: string[] = [];
  if (noComponentMatchTrigger) {
    fallbackReasons.push('No reliable component match for interactive candidates.');
  }
  if (tokenCoverageLowTrigger) {
    fallbackReasons.push('Token coverage is low, with many raw style values.');
  }
  if (layoutAmbiguousTrigger) {
    fallbackReasons.push('Layout semantics are ambiguous due to absolute/group-heavy structure.');
  }

  const mode: Mode = fallbackReasons.length > 0 ? 'fidelity' : 'system-first';

  const score: ScoreResult = {
    total,
    breakdown: {
      componentCoverage,
      tokenizationCoverage,
      layoutSemantics,
      namingSemantics,
      variantCompleteness
    },
    details: {
      interactiveCandidates: interactiveCandidates.length,
      interactiveInstances: interactiveInstances.length,
      tokenRefs,
      rawTokenCandidates,
      autoLayoutRatio: Number(autoLayoutRatio.toFixed(3)),
      absoluteRatio: Number(absoluteRatio.toFixed(3)),
      semanticNameRatio: Number(semanticNameRatio.toFixed(3)),
      variantRatio: Number(variantRatio.toFixed(3))
    }
  };

  const dedupedChecklist = Array.from(
    new Map(
      checklist.map((item) => [`${item.category}:${item.nodeId}:${item.reason}`, item])
    ).values()
  );

  return {
    score,
    checklist: dedupedChecklist,
    checklistByCategory: groupChecklist(dedupedChecklist),
    mode,
    fallbackReasons
  };
}
