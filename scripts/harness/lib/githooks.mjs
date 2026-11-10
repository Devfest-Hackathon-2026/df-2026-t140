// git hooks（.githooks/）を有効にする。AI の種類に関係なく、人にも効く層。
import { git, gitOut } from './proc.mjs'

export const HOOKS_PATH = '.githooks'

export function ensureGitHooks(cwd) {
  const current = gitOut(['config', '--local', '--get', 'core.hooksPath'], { cwd })
  if (current === HOOKS_PATH) return { changed: false, ok: true }
  const result = git(['config', '--local', 'core.hooksPath', HOOKS_PATH], { cwd })
  return { changed: result.ok, ok: result.ok, previous: current }
}
