#!/usr/bin/env node
// npm install / npm ci のときに git hooks を有効にする（package.json の prepare）。失敗しても install は止めない。
import { ensureGitHooks } from './lib/githooks.mjs'
import { repoRoot } from './lib/proc.mjs'

try {
  const root = repoRoot(process.cwd())
  if (root) {
    const result = ensureGitHooks(root)
    if (result.changed) console.log('[ハーネス] git hooks を有効にしました（core.hooksPath = .githooks）')
  }
} catch {
  // Git のない環境（パッケージの展開だけなど）では何もしない
}
