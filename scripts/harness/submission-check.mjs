#!/usr/bin/env node
// 提出用のコピーを push してよいかを確かめる。手順は docs/process/submission.md。
//   node scripts/harness/submission-check.mjs <提出用コピーのフォルダ>
// 開発用のリポジトリそのものに対して実行すると、内部資料が履歴にあるので必ず NG になる（それで正しい）。
import { gitOut } from './lib/proc.mjs'
import { INTERNAL_PATHS } from './lib/policy.mjs'
import { scanText } from './lib/secrets.mjs'

const target = process.argv[2]
if (!target) {
  console.error('使い方：node scripts/harness/submission-check.mjs <提出用コピーのフォルダ>')
  process.exit(1)
}
const problems = []

// 1. 内部資料が、どのコミットにも残っていない
const leaked = gitOut(['log', '--all', '--name-only', '--format=', '--', ...INTERNAL_PATHS], { cwd: target }) ?? ''
const files = [...new Set(leaked.split('\n').filter(Boolean))]
if (files.length > 0) problems.push(`内部資料が履歴に残っています（git filter-repo で消します）：${files.slice(0, 10).join(', ')}${files.length > 10 ? ' …' : ''}`)

// 2. 履歴のどこにも秘密情報がない
const history = gitOut(['log', '--all', '-p', '--no-color', '--format=commit %H'], { cwd: target }) ?? ''
const secrets = scanText(history)
if (secrets.length > 0) problems.push(`履歴に秘密情報らしい値があります（${secrets.length} 件。例：${secrets[0].label}）。キーを無効にし、履歴から消します`)

// 3. 企画書の内部向けの目印が残っていない
const proposal = gitOut(['show', 'HEAD:docs/product/proposal.md'], { cwd: target }) ?? ''
if (/議論済み|合意前の案/.test(proposal)) problems.push('docs/product/proposal.md に「議論済み」など内部向けの目印が残っています。提出用に整えます')

// 4. README にデプロイ URL がある
const readme = gitOut(['show', 'HEAD:README.md'], { cwd: target }) ?? ''
if (!/https:\/\/[\w.-]+\.(web\.app|firebaseapp\.com)/.test(readme)) problems.push('README.md にデプロイした URL がありません')

if (problems.length > 0) {
  console.error('提出用のコピーは、まだ push できません：')
  for (const problem of problems) console.error(`- ${problem}`)
  process.exit(1)
}
console.log('提出用のコピーのチェックに通りました。push の前に、人が docs/process/submission.md の最後の確認をします')
