// Resolve the project directory the plugin's filesystem ops act on, and a short
// label for the picker UI. Pure + dependency-injected so it's unit-testable.
import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

export interface ResolveProjectRootOpts {
  projectDirEnv?: string | undefined; // DESIGNAGENT_PROJECT_DIR (explicit override)
  claudeProjectDir?: string | undefined; // CLAUDE_PROJECT_DIR (harness workspace)
  cwd: string;
  gitRootOf?: (start: string) => string | null; // injectable for tests
}

// Nearest ancestor containing a `.git` entry, walking up from `start`.
export function findGitRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(resolve(dir, '.git'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null; // reached filesystem root
    }
    dir = parent;
  }
}

// Priority: explicit override → harness workspace → git root → cwd.
export function resolveProjectRoot(opts: ResolveProjectRootOpts): string {
  const override = opts.projectDirEnv?.trim();
  if (override) {
    return resolve(override);
  }
  const workspace = opts.claudeProjectDir?.trim();
  if (workspace) {
    return resolve(workspace);
  }
  const gitRoot = (opts.gitRootOf ?? findGitRoot)(opts.cwd);
  if (gitRoot) {
    return resolve(gitRoot);
  }
  return resolve(opts.cwd);
}

// Last 1–2 path segments, e.g. /Users/me/Public/playground/figma → "playground/figma".
export function deriveProjectLabel(root: string): string {
  const parts = resolve(root)
    .split(sep)
    .filter(Boolean);
  if (parts.length === 0) {
    return resolve(root);
  }
  return parts.slice(-2).join('/');
}
