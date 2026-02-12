import type { Intent } from './types';

const SCREEN_NAME_HINT = /(screen|page|login|home|settings|dashboard|profile|checkout|onboarding)/i;

function isInComponentSetContext(node: SceneNode): boolean {
  let cursor: BaseNode | null = node;
  while (cursor) {
    if (cursor.type === 'COMPONENT' || cursor.type === 'COMPONENT_SET') {
      return true;
    }
    cursor = cursor.parent;
  }
  return false;
}

export function isScreenLikeNode(node: SceneNode): boolean {
  if (node.type !== 'FRAME') {
    return false;
  }

  const width = typeof node.width === 'number' ? node.width : 0;
  const height = typeof node.height === 'number' ? node.height : 0;
  const topLevelParent = node.parent?.type === 'PAGE' || node.parent?.type === 'SECTION';

  const commonScreenSize = width >= 320 && height >= 568;
  const largeSurface = width * height >= 180000;
  const nameHint = SCREEN_NAME_HINT.test(node.name);

  return (topLevelParent && (commonScreenSize || largeSurface)) || nameHint;
}

export function classifyIntent(node: SceneNode): Intent {
  if (
    node.type === 'INSTANCE' ||
    node.type === 'COMPONENT' ||
    node.type === 'COMPONENT_SET' ||
    isInComponentSetContext(node)
  ) {
    return 'component';
  }

  if (isScreenLikeNode(node)) {
    return 'screen';
  }

  return 'section';
}
