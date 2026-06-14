import type { AnalysisCore } from './analyze';
import {
  buildInstanceHints,
  collectAnnotationEntries,
  collectInstances,
  flattenNodes,
  formatInstanceHints,
  formatResolvedVariables
} from './serialize';
import { PRESET_DEFINITIONS, type Intent, type Preset, type ResolvedVariable, type UiSpec } from './types';

// DESIGN.md serializer. Produces one combined, human-readable Markdown spec
// (Google design-doc style) from one or more analyzed frames, ready for Claude
// Code to consume as durable project context. Reuses the shared serializers in
// ./serialize so the spec stays consistent with the code-gen prompt.

export interface DesignDocFrame {
  core: AnalysisCore;
  preset: Preset;
}

export interface DesignDocMeta {
  fileName: string;
  preset: Preset;
  omittedFrameCount?: number;
}

function intentLabel(intent: Intent): string {
  if (intent === 'screen') return 'Screen';
  if (intent === 'component') return 'Component';
  return 'Section';
}

function sizeLabel(width?: number, height?: number): string {
  if (typeof width !== 'number' || typeof height !== 'number') {
    return 'unknown';
  }
  return `${Math.round(width)}×${Math.round(height)}`;
}

function describeLayout(uiSpec: UiSpec): string {
  const layout = uiSpec.root.layout;
  if (!layout || !layout.layoutMode || layout.layoutMode === 'NONE') {
    return 'Freeform / absolute positioning (no auto-layout on the root).';
  }
  const direction = layout.layoutMode === 'HORIZONTAL' ? 'Horizontal' : 'Vertical';
  const parts: string[] = [`${direction} auto-layout`];
  if (typeof layout.itemSpacing === 'number') {
    parts.push(`gap ${layout.itemSpacing}`);
  }
  const pads = [layout.paddingTop, layout.paddingRight, layout.paddingBottom, layout.paddingLeft];
  if (pads.some((p) => typeof p === 'number' && p > 0)) {
    parts.push(
      `padding ${layout.paddingTop ?? 0}/${layout.paddingRight ?? 0}/${layout.paddingBottom ?? 0}/${layout.paddingLeft ?? 0}`
    );
  }
  if (layout.primaryAxisAlignItems) {
    parts.push(`primary ${layout.primaryAxisAlignItems}`);
  }
  if (layout.counterAxisAlignItems) {
    parts.push(`counter ${layout.counterAxisAlignItems}`);
  }
  return parts.join(', ');
}

function collectKeyText(uiSpec: UiSpec, limit = 12): string[] {
  const texts: string[] = [];
  for (const node of flattenNodes(uiSpec.root)) {
    const chars = node.text?.characters?.trim();
    if (chars) {
      texts.push(chars.replace(/\s+/g, ' '));
    }
    if (texts.length >= limit) {
      break;
    }
  }
  return texts;
}

function scoreLine(core: AnalysisCore): string {
  return `${core.score.total}/${core.score.applicableMax || 100}`;
}

function buildFrameSection(frame: DesignDocFrame, multiFrame: boolean): string {
  const { core } = frame;
  const node = core.selectedNode;
  const lines: string[] = [];

  lines.push(`### ${node.name}`);
  lines.push(
    `- **Type:** ${node.type} · **Size:** ${sizeLabel(node.width, node.height)} · **Intent:** ${intentLabel(core.intent)} · **AI-ready:** ${scoreLine(core)}`
  );
  if (node.link) {
    lines.push(`- **Figma:** ${node.link}`);
  }
  lines.push(`- **Layout:** ${describeLayout(core.uiSpec)}`);

  if (core.coverageWarnings.length > 0) {
    lines.push('- **Coverage warnings:**');
    for (const warning of core.coverageWarnings) {
      lines.push(`  - ${warning}`);
    }
  }

  const keyText = collectKeyText(core.uiSpec);
  if (keyText.length > 0) {
    lines.push('', '**Key text**');
    for (const text of keyText) {
      lines.push(`- "${text}"`);
    }
  }

  // With multiple frames, list each frame's components so the reader knows what
  // lives where. With a single frame the global "Components" section below is the
  // same list, so skip the per-frame duplicate.
  if (multiFrame) {
    const components = buildInstanceHints(core.uiSpec);
    if (components) {
      lines.push('', '**Components used**', components);
    }
  }

  const annotations = collectAnnotationEntries(core.uiSpec);
  if (annotations.length > 0) {
    lines.push('', '**Designer intent**');
    for (const entry of annotations) {
      lines.push(`- ${entry}`);
    }
  }

  return lines.join('\n');
}

function buildOverviewTable(frames: DesignDocFrame[]): string {
  const lines: string[] = [
    '| Frame | Type | Size | Intent | AI-ready |',
    '| --- | --- | --- | --- | --- |'
  ];
  for (const frame of frames) {
    const node = frame.core.selectedNode;
    lines.push(
      `| ${node.name} | ${node.type} | ${sizeLabel(node.width, node.height)} | ${intentLabel(frame.core.intent)} | ${scoreLine(frame.core)} |`
    );
  }
  return lines.join('\n');
}

function buildSharedTokens(frames: DesignDocFrame[]): string {
  const all: ResolvedVariable[] = [];
  for (const frame of frames) {
    all.push(...(frame.core.uiSpec.tokenization.resolvedVariables ?? []));
  }
  return formatResolvedVariables(all, 80) ?? '- No resolved design variables captured.';
}

function buildSharedComponents(frames: DesignDocFrame[]): string {
  const all = frames.flatMap((frame) => collectInstances(frame.core.uiSpec));
  return formatInstanceHints(all, 50) ?? '- No component instances detected.';
}

export function generateDesignDoc(frames: DesignDocFrame[], meta: DesignDocMeta): string {
  const presetLabel = PRESET_DEFINITIONS[meta.preset]?.label ?? meta.preset;
  const frameWord = frames.length === 1 ? 'frame' : 'frames';

  const sections: string[] = [];

  sections.push(`# Design Spec — ${meta.fileName}`);
  sections.push(
    `> Generated by DesignAgent from ${frames.length} Figma ${frameWord}. Target preset: **${presetLabel}**.`
  );
  if (meta.omittedFrameCount && meta.omittedFrameCount > 0) {
    sections.push(
      `> Note: ${meta.omittedFrameCount} additional selected ${meta.omittedFrameCount === 1 ? 'frame was' : 'frames were'} omitted to keep this doc focused. Export them separately if needed.`
    );
  }

  sections.push('## Overview');
  sections.push(buildOverviewTable(frames));

  const multiFrame = frames.length > 1;

  sections.push('## Frames');
  for (const frame of frames) {
    sections.push(buildFrameSection(frame, multiFrame));
  }

  sections.push(multiFrame ? '## Design tokens (shared)' : '## Design tokens');
  sections.push(buildSharedTokens(frames));

  sections.push(multiFrame ? '## Component inventory (shared)' : '## Components');
  sections.push(buildSharedComponents(frames));

  sections.push('---');
  sections.push('### How to use this doc in Claude Code');
  sections.push(
    [
      'Save this file as `DESIGN.md` in your project root, then add `@DESIGN.md` to your',
      '`CLAUDE.md` so Claude Code loads it automatically each session. Treat the values above',
      '(tokens, component names, layout, text) as the source of truth — use them verbatim and',
      'avoid guessing. Where detail is missing, query the Figma MCP using the per-frame links.'
    ].join('\n')
  );

  return sections.join('\n\n') + '\n';
}
