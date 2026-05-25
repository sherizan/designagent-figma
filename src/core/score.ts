import type {
  ChecklistItem,
  ScoreCategory,
  ScoreResult,
  UiNodeSpec,
  UiSpec
} from './types';
import { SCORE_WEIGHTS } from './types';

interface FlatNode {
  node: UiNodeSpec;
  parentId: string | null;
}

const INTERACTIVE_NAME_HINT =
  /(button|btn|input|field|toggle|switch|tab|chip|dropdown|select|nav)/i;

const GENERIC_NAME_PATTERN =
  /^(rectangle|frame|group|text|ellipse|line|vector|polygon|star|section|instance|component)\s*\d+$/i;
const GHOST_NAME_PATTERN = /\b(ghost|hidden)\b/i;
const DEVICE_CHROME_NAME_PATTERN =
  /^(status[\s-]*bar(?:\s*[-–]\s*iphone)?\b|home[\s-]*indicator\b)/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function flattenTree(root: UiNodeSpec): FlatNode[] {
  const queue: FlatNode[] = [{ node: root, parentId: null }];
  const result: FlatNode[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    result.push(current);

    for (const child of current.node.children) {
      queue.push({ node: child, parentId: current.node.id });
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

function isSkippableByType(node: UiNodeSpec): boolean {
  return node.type === 'COMPONENT' || node.type === 'COMPONENT_SET';
}

function nodeHasAnnotation(node: UiNodeSpec): boolean {
  return Array.isArray(node.annotations) && node.annotations.length > 0;
}

function hasWaiveredAncestor(
  nodeId: string,
  nodeById: Map<string, UiNodeSpec>,
  parentById: Map<string, string | null>
): boolean {
  let cursor = parentById.get(nodeId) ?? null;
  while (cursor) {
    const parent = nodeById.get(cursor);
    if (!parent) {
      return false;
    }
    if (nodeHasAnnotation(parent)) {
      return true;
    }
    cursor = parentById.get(cursor) ?? null;
  }
  return false;
}

function isScorableNode(
  node: UiNodeSpec,
  nodeById: Map<string, UiNodeSpec>,
  parentById: Map<string, string | null>
): boolean {
  if (!node.visible) {
    return false;
  }
  if (hasHiddenAncestor(node.id, nodeById, parentById)) {
    return false;
  }
  if (GHOST_NAME_PATTERN.test(node.name)) {
    return false;
  }
  if (DEVICE_CHROME_NAME_PATTERN.test(node.name.trim())) {
    return false;
  }
  if (isSkippableByType(node)) {
    return false;
  }
  // Skip nodes inside component set definitions (variant authoring context).
  if (hasAncestorType(node.id, 'COMPONENT_SET', nodeById, parentById)) {
    return false;
  }
  // Designer-annotated nodes (and their subtree) act as waivers — the
  // designer has explicitly accepted whatever pattern is in there, so we
  // don't audit them. They count neither as numerator nor denominator
  // for any category.
  if (nodeHasAnnotation(node)) {
    return false;
  }
  if (hasWaiveredAncestor(node.id, nodeById, parentById)) {
    return false;
  }
  return true;
}

function hasAncestorType(
  nodeId: string,
  type: string,
  nodeById: Map<string, UiNodeSpec>,
  parentById: Map<string, string | null>
): boolean {
  let cursor = parentById.get(nodeId) ?? null;

  while (cursor) {
    const parentNode = nodeById.get(cursor);
    if (!parentNode) {
      return false;
    }

    if (parentNode.type === type) {
      return true;
    }

    cursor = parentById.get(cursor) ?? null;
  }

  return false;
}

function hasHiddenAncestor(
  nodeId: string,
  nodeById: Map<string, UiNodeSpec>,
  parentById: Map<string, string | null>
): boolean {
  let cursor = parentById.get(nodeId) ?? null;

  while (cursor) {
    const parentNode = nodeById.get(cursor);
    if (!parentNode) {
      return false;
    }

    if (!parentNode.visible) {
      return true;
    }

    cursor = parentById.get(cursor) ?? null;
  }

  return false;
}

function isMappedComponentCandidate(
  node: UiNodeSpec,
  nodeById: Map<string, UiNodeSpec>,
  parentById: Map<string, string | null>
): boolean {
  if (node.type === 'INSTANCE' || node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return true;
  }

  // Children inside an instance are implementation details of a mapped DS component.
  if (hasAncestorType(node.id, 'INSTANCE', nodeById, parentById)) {
    return true;
  }

  return false;
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
  coverageWarnings: string[];
}

export function scoreUiSpec(uiSpec: UiSpec): ScoreComputationResult {
  const nodes = flattenTree(uiSpec.root);
  const nodeById = new Map(nodes.map(({ node }) => [node.id, node]));
  const parentById = new Map(nodes.map(({ node, parentId }) => [node.id, parentId]));
  const scorableNodes = nodes.filter(({ node }) =>
    isScorableNode(node, nodeById, parentById)
  );
  const checklist: ChecklistItem[] = [];

  const interactiveCandidates = scorableNodes.filter(
    ({ node }) =>
      isInteractiveCandidate(node) &&
      !hasAncestorType(node.id, 'INSTANCE', nodeById, parentById)
  );
  const mappedInteractiveCandidates = interactiveCandidates.filter(({ node }) =>
    isMappedComponentCandidate(node, nodeById, parentById)
  );

  const componentCoverageApplicable = interactiveCandidates.length > 0;
  const componentCoverageRatio = componentCoverageApplicable
    ? mappedInteractiveCandidates.length / interactiveCandidates.length
    : 0;
  const componentCoverage = componentCoverageApplicable
    ? Math.round(componentCoverageRatio * SCORE_WEIGHTS.componentCoverage)
    : 0;

  for (const candidate of interactiveCandidates) {
    if (!isMappedComponentCandidate(candidate.node, nodeById, parentById)) {
      checklist.push(
        checklistItem(
          'Component Coverage',
          candidate.node,
          'This interactive layer may not be using a reusable design-system component.',
          'Replace with DS component instance (Button/Input/Control) from your component library.'
        )
      );
    }
  }

  const tokenRefs = scorableNodes.reduce(
    (sum, { node }) => sum + node.tokenHints.styleRefs + node.tokenHints.variableRefs,
    0
  );
  const rawTokenCandidates = scorableNodes.reduce(
    (sum, { node }) => sum + node.tokenHints.rawValueHints,
    0
  );
  const tokenizationApplicable = tokenRefs + rawTokenCandidates > 0;
  const tokenizationRatio = tokenizationApplicable
    ? tokenRefs / (tokenRefs + rawTokenCandidates)
    : 0;
  const tokenizationCoverage = tokenizationApplicable
    ? Math.round(tokenizationRatio * SCORE_WEIGHTS.tokenizationCoverage)
    : 0;

  for (const { node } of scorableNodes) {
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

  const frameLikeNodes = scorableNodes.filter(({ node }) =>
    ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'].includes(node.type)
  );
  const autoLayoutNodes = scorableNodes.filter(
    ({ node }) => node.layout?.layoutMode && node.layout.layoutMode !== 'NONE'
  );
  const absoluteNodes = scorableNodes.filter(
    ({ node }) => node.layout?.layoutPositioning === 'ABSOLUTE'
  );
  const groupNodes = scorableNodes.filter(({ node }) => node.type === 'GROUP');

  // Children that *could* be positioned absolute are only those inside an
  // auto-layout container — use them as the absoluteRatio denominator so
  // the metric reflects density, not tree size.
  const autoLayoutChildCount = scorableNodes.filter(({ node, parentId }) => {
    if (!parentId) {
      return false;
    }
    const parent = nodeById.get(parentId);
    return Boolean(parent?.layout?.layoutMode && parent.layout.layoutMode !== 'NONE');
  }).length;

  const layoutApplicable = frameLikeNodes.length > 0;
  const autoLayoutRatio = layoutApplicable
    ? autoLayoutNodes.length / frameLikeNodes.length
    : 0;
  const absoluteRatio = autoLayoutChildCount > 0
    ? absoluteNodes.length / autoLayoutChildCount
    : 0;
  // Groups penalize relative to all container-like nodes (frames + groups).
  const groupContainerTotal = groupNodes.length + frameLikeNodes.length;
  const groupRatio = groupContainerTotal > 0 ? groupNodes.length / groupContainerTotal : 0;

  const layoutComposite = clamp(
    autoLayoutRatio * 0.7 + (1 - absoluteRatio) * 0.2 + (1 - groupRatio) * 0.1,
    0,
    1
  );

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
  const layoutSemantics = layoutApplicable
    ? Math.round(layoutComposite * SCORE_WEIGHTS.layoutSemantics)
    : 0;

  const genericNames = scorableNodes.filter(({ node }) => GENERIC_NAME_PATTERN.test(node.name));
  const namingApplicable = scorableNodes.length > 0;
  const semanticNameRatio = namingApplicable
    ? 1 - genericNames.length / scorableNodes.length
    : 0;
  const namingSemantics = namingApplicable
    ? Math.round(clamp(semanticNameRatio, 0, 1) * SCORE_WEIGHTS.namingSemantics)
    : 0;

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

  const instances = scorableNodes.filter(({ node }) => node.type === 'INSTANCE');
  const completeVariants = instances.filter(({ node }) => hasVariantProps(node));
  const variantApplicable = instances.length > 0;
  const variantRatio = variantApplicable
    ? completeVariants.length / instances.length
    : 0;
  const variantCompleteness = variantApplicable
    ? Math.round(variantRatio * SCORE_WEIGHTS.variantCompleteness)
    : 0;

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

  const applicable: Record<ScoreCategory, boolean> = {
    'Component Coverage': componentCoverageApplicable,
    'Tokenization Coverage': tokenizationApplicable,
    'Layout Semantics': layoutApplicable,
    'Naming + Semantics': namingApplicable,
    'Variant Completeness': variantApplicable
  };

  const applicableMax =
    (componentCoverageApplicable ? SCORE_WEIGHTS.componentCoverage : 0) +
    (tokenizationApplicable ? SCORE_WEIGHTS.tokenizationCoverage : 0) +
    (layoutApplicable ? SCORE_WEIGHTS.layoutSemantics : 0) +
    (namingApplicable ? SCORE_WEIGHTS.namingSemantics : 0) +
    (variantApplicable ? SCORE_WEIGHTS.variantCompleteness : 0);

  // Coverage warnings only fire for categories that actually apply, so an
  // empty selection or a section without instances doesn't spam the panel.
  const noComponentMatchTrigger =
    componentCoverageApplicable && componentCoverageRatio < 0.5;
  const tokenCoverageLowTrigger =
    tokenizationApplicable &&
    tokenizationCoverage < Math.round(SCORE_WEIGHTS.tokenizationCoverage * 0.5);
  const layoutAmbiguousTrigger =
    layoutApplicable && (absoluteRatio > 0.35 || layoutSemantics < Math.round(SCORE_WEIGHTS.layoutSemantics * 0.5));

  const coverageWarnings: string[] = [];
  if (noComponentMatchTrigger) {
    coverageWarnings.push(
      'Some buttons or inputs are not using design system components yet.'
    );
  }
  if (tokenCoverageLowTrigger) {
    coverageWarnings.push(
      'Many colors and text styles look hard-coded instead of using shared tokens.'
    );
  }
  if (layoutAmbiguousTrigger) {
    coverageWarnings.push(
      'Layout uses a lot of manual positioning, so structure may be hard to reproduce.'
    );
  }

  const score: ScoreResult = {
    total,
    applicableMax,
    applicable,
    breakdown: {
      componentCoverage,
      tokenizationCoverage,
      layoutSemantics,
      namingSemantics,
      variantCompleteness
    },
    details: {
      interactiveCandidates: interactiveCandidates.length,
      interactiveInstances: mappedInteractiveCandidates.length,
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
    coverageWarnings
  };
}
