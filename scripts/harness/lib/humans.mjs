// 人にしかできない判断（todo/humans/）。書き方は todo/humans/README.md。
import { parseFrontMatter, parseSections, setFrontMatterValue } from './frontmatter.mjs'

export const HUMANS_DIR = 'todo/humans'
export const HUMAN_STATUS = { open: 'open', done: 'done' }
export const HUMAN_KINDS = ['費用', '有料API', '方針', '秘密情報', '権限', 'その他']

// 「key:」だけで値のない欄は、空の文字列として扱う（空の一覧にしない。done の確認をすり抜けないように）
const text = (value) => (Array.isArray(value) ? value.join(', ') : (value ?? ''))

export function parseHumanTodo(source, path) {
  const { data: raw, body, hasFrontMatter } = parseFrontMatter(source)
  const data = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, text(value)]))
  const sections = parseSections(body)
  return {
    path,
    hasFrontMatter,
    id: data.id ?? '',
    title: data.title ?? '',
    status: data.status ?? '',
    kind: data.kind ?? '',
    askedBy: data.asked_by ?? '',
    created: data.created ?? '',
    blocks: data.blocks ?? '',
    issue: data.issue ?? '',
    decidedBy: data.decided_by ?? '',
    decidedAt: data.decided_at ?? '',
    decision: data.decision ?? '',
    sections,
  }
}

// errors は直すまで CI が落ちるもの。warnings は書いてほしいもの（理由など）。
export function validateHumanTodo(todo) {
  const errors = []
  const warnings = []
  const where = todo.path
  if (!todo.hasFrontMatter) errors.push(`${where}：先頭の --- で囲んだ欄がありません（todo/humans/_template.md を写す）`)
  if (!todo.title) errors.push(`${where}：title が空です`)
  if (!Object.values(HUMAN_STATUS).includes(todo.status)) {
    errors.push(`${where}：status は open か done にします（今は「${todo.status}」）`)
  }
  if (!HUMAN_KINDS.includes(todo.kind)) {
    errors.push(`${where}：kind は ${HUMAN_KINDS.join('、')} のどれかにします（今は「${todo.kind}」）`)
  }
  if (!todo.sections['決めてほしいこと']) errors.push(`${where}：「## 決めてほしいこと」が空です`)
  if (todo.status === HUMAN_STATUS.done) {
    if (!todo.decision) errors.push(`${where}：done にしたら decision（決めた内容）を書きます`)
    if (!todo.decidedBy) errors.push(`${where}：done にしたら decided_by（決めた人）を書きます`)
    if (!todo.decidedAt) errors.push(`${where}：done にしたら decided_at（決めた日）を書きます`)
    if (!todo.sections['判断の理由']) warnings.push(`${where}：「## 判断の理由」が空です。分かる範囲で書いてください`)
  }
  return { errors, warnings }
}

export function renderHumanTemplate({ id, title, kind, askedBy, created, blocks = '', issue = '' }) {
  return `---
id: ${id}
title: ${title}
status: ${HUMAN_STATUS.open}
kind: ${kind}
asked_by: ${askedBy}
created: ${created}
blocks: ${blocks}
issue: ${issue}
decided_by:
decided_at:
decision:
---

# ${title}

## 決めてほしいこと

<!-- 人が答えられる形の問いにする。「はい / いいえ」や「A / B」で答えられるとよい -->

## 背景

<!-- なぜ AI では決められないか（費用、有料 API、方針、秘密情報、権限）。どの作業が止まっているか -->

## 選択肢

<!-- 案ごとに、良い点・悪い点・費用 -->

## AI の推奨

<!-- 参考。決めるのは人。推奨しないなら「なし」 -->

## 判断の理由

<!-- done にするとき、決めた人の言葉で理由を書く -->
`
}

export function markHumanDone(text, { decision, decidedBy, decidedAt, reason }) {
  let updated = text
  updated = setFrontMatterValue(updated, 'status', HUMAN_STATUS.done)
  updated = setFrontMatterValue(updated, 'decided_by', decidedBy)
  updated = setFrontMatterValue(updated, 'decided_at', decidedAt)
  updated = setFrontMatterValue(updated, 'decision', decision)
  if (reason) {
    updated = updated.replace(
      /(## 判断の理由\n)(?:\n?<!--[\s\S]*?-->\n?)?/,
      (_, heading) => `${heading}\n${reason}\n`,
    )
  }
  return updated
}
