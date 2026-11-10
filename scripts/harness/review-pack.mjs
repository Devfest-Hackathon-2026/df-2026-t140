#!/usr/bin/env node
// レビュー役に渡す「レビューパック」を作る。決まった処理（差分、宣言、機械のチェック、CI）はここで集め、
// レビュー役（別コンテキストの LLM）は判断が要るところだけを見る。
//   npm run review-pack -- <PR 番号かブランチ>  →  .harness/review/<名前>/pack.md と tree/（PR の head のチェックアウト）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatResults, refSource, runChecks } from './lib/checks.mjs'
import { ledgerPathFor } from './lib/conventions.mjs'
import { gh, git, gitOut, repoRoot, TIMEOUT_MS } from './lib/proc.mjs'
import { RULES } from './lib/rules.mjs'

const MAX_DIFF_LINES = 4000
const root = repoRoot(process.cwd()) ?? process.cwd()
const target = process.argv[2]
if (!target) {
  console.error('使い方：npm run review-pack -- <PR 番号かブランチ>')
  process.exit(1)
}

const view = gh(['pr', 'view', target, '--json', 'number,title,body,url,headRefName,baseRefName,author,isDraft,additions,deletions,changedFiles,statusCheckRollup'], { cwd: root })
const pr = view.ok ? JSON.parse(view.stdout) : undefined
const head = pr?.headRefName ?? target
const base = pr?.baseRefName ?? 'main'
git(['fetch', '--quiet', 'origin', head, base], { cwd: root, timeout: TIMEOUT_MS.network * 3 })
const headRef = `origin/${head}`
const baseRef = `origin/${base}`
if (!gitOut(['rev-parse', '--verify', '--quiet', headRef], { cwd: root })) {
  console.error(`${headRef} が見つかりません（push されているか確かめます）`)
  process.exit(1)
}

const name = pr ? `pr-${pr.number}` : head.replace('/', '-')
const dir = join(root, '.harness', 'review', name)
const tree = join(dir, 'tree')
mkdirSync(dir, { recursive: true })
if (existsSync(tree)) git(['worktree', 'remove', '--force', tree], { cwd: root })
const worktree = git(['worktree', 'add', '--detach', tree, headRef], { cwd: root })

const changed = gitOut(['diff', '--name-status', `${baseRef}...${headRef}`], { cwd: root }) ?? ''
const diffLines = (gitOut(['diff', '--no-color', `${baseRef}...${headRef}`], { cwd: root }) ?? '').split('\n')
const diff = diffLines.length > MAX_DIFF_LINES ? [...diffLines.slice(0, MAX_DIFF_LINES), `…（差分は ${diffLines.length} 行。残りは tree/ のファイルを読む）`] : diffLines
const ledger = gitOut(['show', `${headRef}:${ledgerPathFor(head)}`], { cwd: root }) ?? '（作業宣言がありません。R9 で指摘します）'
const results = runChecks({ source: refSource(headRef, root), cwd: root, branch: head, base: baseRef, head: headRef })
// 実行中のチェックは conclusion が空文字で来るので、「実行中」と書く（空欄だと結果がないのか分からない）
const checkState = (check) => check.conclusion || (check.status && check.status !== 'COMPLETED' ? `実行中（${check.status}）` : check.state) || '不明'
const checks = (pr?.statusCheckRollup ?? []).map((check) => `- ${check.name || check.context}：${checkState(check)}`).join('\n') || '- （取得できませんでした）'
const judgement = Object.entries(RULES)
  .filter(([, rule]) => rule.kind === 'judgement')
  .map(([id, rule]) => `- ${id}：${rule.summary}`)
  .join('\n')

const pack = `# レビューパック：${pr ? `PR #${pr.number} ${pr.title}` : head}

作ったもの：scripts/harness/review-pack.mjs（決まった処理）。判断は docs/process/reviewer.md の手順で、レビュー役が行う。

- PR：${pr?.url ?? '（gh で取得できませんでした）'}
- head の commit：${gitOut(['rev-parse', headRef], { cwd: root })}（レビューの目印の sha に書く）
- ブランチ：${head} → ${base}${pr ? `（${pr.isDraft ? 'draft、' : ''}+${pr.additions} / -${pr.deletions}、${pr.changedFiles} ファイル、作者 ${pr.author?.login}）` : ''}
- PR の head のチェックアウト：${worktree.ok ? tree.replaceAll('\\', '/') : '（作れませんでした。差分だけで判断する）'}
  - ファイルはここから読む。作業ツリー（今のブランチ）は PR の中身と違うことがある
  - このフォルダは Git の管理外（.harness/）の下なので、Glob では見えないことがある。下の「変更したファイル」の一覧のパスを Read で読む
  - 消したファイルの元の中身は、差分の - の行で見る

## 作業宣言（完了条件がレビューの基準）

\`\`\`markdown
${ledger}
\`\`\`

## 機械のチェック（ここは判断し直さない。NG と注意だけ R の項目に結びつける）

\`\`\`text
${formatResults(results)}
\`\`\`

## CI

${checks}

## 機械では見られない設計方針（判断で見る）

${judgement}

## PR の説明（実装した側の主張。うのみにせず、コードで確かめる）

${pr?.body ?? '（なし）'}

## 変更したファイル

\`\`\`text
${changed}
\`\`\`

## 差分

\`\`\`diff
${diff.join('\n')}
\`\`\`
`
writeFileSync(join(dir, 'pack.md'), pack)
console.log(join(dir, 'pack.md').replaceAll('\\', '/'))
