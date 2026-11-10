// 作業宣言（docs/work/<種類>-<内容>.md）。書き方は docs/work/README.md。
import { checkBranchName } from './conventions.mjs'
import { parseFrontMatter, parseSections } from './frontmatter.mjs'

export const STATUS = { active: '進行中', done: '完了', dropped: '中止' }
const STATUSES = Object.values(STATUS)

const REQUIRED_ON_DECLARE = ['目的', '完了条件', '正本への影響']

// 12、"#12"、"https://github.com/.../issues/12" から Issue 番号（正の整数）を取り出す。
// 未指定（空）は undefined、解釈できない文字列は Number.NaN を返す。
export function parseIssueNumber(value) {
  if (value === undefined || value === null || Array.isArray(value)) return undefined
  const text = String(value).trim()
  if (!text) return undefined
  const match = text.match(/(?:^|#|\/issues\/)(\d+)$/)
  if (!match) return Number.NaN
  const num = Number(match[1])
  return num > 0 ? num : Number.NaN
}

export function parseLedger(text, path) {
  const { data, body, hasFrontMatter } = parseFrontMatter(text)
  const sections = parseSections(body)
  const doneCriteria = (sections['完了条件'] ?? '')
    .split('\n')
    .map((line) => line.match(/^\s*-\s*\[( |x|X)\]\s*(.+)$/))
    .filter(Boolean)
    .map(([, mark, label]) => ({ checked: mark !== ' ', label: label.trim() }))
  return {
    path,
    hasFrontMatter,
    hasIssueField: Object.hasOwn(data, 'issue'),
    branch: data.branch ?? '',
    title: data.title ?? '',
    issue: parseIssueNumber(data.issue),
    rawIssue: Array.isArray(data.issue) ? '' : String(data.issue ?? ''),
    status: data.status ?? '',
    owner: data.owner ?? '',
    agent: data.agent ?? '',
    started: data.started ?? '',
    scope: Array.isArray(data.scope) ? data.scope.filter(Boolean) : [],
    blockedBy: Array.isArray(data.blocked_by) ? data.blocked_by.filter(Boolean) : [],
    sections,
    doneCriteria,
  }
}

// phase: 'declare'（作業の前）か 'finish'（PR をレビューに出す前）
export function validateLedger(ledger, { phase = 'declare', branch } = {}) {
  const errors = []
  const where = ledger.path ?? '作業宣言'
  if (!ledger.hasFrontMatter) errors.push(`${where}：先頭の --- で囲んだ欄がありません（docs/work/_template.md を写す）`)
  if (branch && ledger.branch !== branch) {
    errors.push(`${where}：branch が「${ledger.branch}」で、いまのブランチ「${branch}」と違います`)
  }
  const name = checkBranchName(ledger.branch)
  if (!name.ok) errors.push(`${where}：branch の名前が決まりに合いません。${name.reason}`)
  if (!ledger.title) errors.push(`${where}：title が空です`)
  if (Number.isNaN(ledger.issue)) {
    errors.push(`${where}：issue は Issue 番号（例：12 または #12）にします（今は「${ledger.rawIssue}」）`)
  }
  if (!STATUSES.includes(ledger.status)) {
    errors.push(`${where}：status は ${STATUSES.join('、')} のどれかにします（今は「${ledger.status}」）`)
  }
  if (ledger.scope.length === 0) errors.push(`${where}：scope（触るファイル）が空です`)
  for (const heading of REQUIRED_ON_DECLARE) {
    if (!ledger.sections[heading]) errors.push(`${where}：「## ${heading}」が空です`)
  }
  if (ledger.doneCriteria.length === 0) {
    errors.push(`${where}：「## 完了条件」に「- [ ] 確かめられる条件」を 1 つ以上書きます`)
  }

  if (phase === 'finish') {
    if (ledger.status === STATUS.active) {
      errors.push(`${where}：status を ${STATUS.done} か ${STATUS.dropped} にします`)
    }
    if (ledger.hasIssueField && !ledger.issue && ledger.status === STATUS.done) {
      errors.push(`${where}：issue（GitHub Issue 番号）が空です。\`npm run work -- issue\` か \`npm run work -- declare\` で Issue を起票して番号を書きます`)
    }
    if (!ledger.sections['結果']) errors.push(`${where}：「## 結果」に、やったこと・確かめたこと・残したことを書きます`)
    if (ledger.status === STATUS.done) {
      for (const item of ledger.doneCriteria) {
        if (!item.checked && !/未達/.test(item.label)) {
          errors.push(`${where}：完了条件「${item.label}」が未チェックです。満たしたら [x]、満たせないなら「（未達：理由）」を書きます`)
        }
      }
    }
  }
  return errors
}

export function renderLedgerTemplate({ branch, title, issue, owner, agent, started, scope = [], goal = '', todo = '', doneCriteria = [] }) {
  const scopeLines = scope.length > 0 ? scope.map((item) => `  - ${item}`).join('\n') : '  - '
  const goalBlock = goal.trim() || '<!-- 何のために、誰のどんな困りごとを解くか。企画書のどこに当たるか（例：企画書「ユーザー体験」2-1、画面 S04） -->'
  const todoBlock = todo.trim() || '<!-- 箇条書きで。やらないことも書くと、ほかの AI が判断しやすい -->'
  const doneLines =
    doneCriteria.length > 0
      ? doneCriteria.map((item) => (item.startsWith('- [') ? item : `- [ ] ${item.replace(/^-+\s*/, '')}`)).join('\n')
      : '- [ ]'
  return `---
branch: ${branch}
title: ${title}
issue: ${issue ?? ''}
status: ${STATUS.active}
owner: ${owner}
agent: ${agent}
started: ${started}
scope:
${scopeLines}
blocked_by:
---

# ${title}

## 目的

${goalBlock}

## やること

${todoBlock}

## 完了条件

<!-- 「動いた」ではなく確かめられる条件にする。PR のレビューはこれで測る -->
${doneLines}

## 正本への影響

<!-- 企画書・技術構成・画面の正本を変える必要があるか。あるなら、コードより先に直す（CLAUDE.md） -->

## 他の作業との調整

<!-- npm run work -- status で重なった作業と、どう分けたか -->

## 例外

<!-- 設計方針から外れる実装をするなら、どこで何を、なぜ。ファイル内にも @harness-exception で書く -->
なし

## 結果

<!-- 完了時に書く：やったこと、確かめたこと、残したこと -->
`
}
