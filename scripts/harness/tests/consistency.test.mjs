// 文書とコードがずれていないか。ルールを足したのに文書に書き忘れる、を機械で防ぐ。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatResults, hasFailure, runChecks, treeSource } from '../lib/checks.mjs'
import { MESSAGES } from '../lib/command-guard.mjs'
import { DESIGN_DOC, RULES } from '../lib/rules.mjs'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('設計方針のルールの ID は、すべて design-principles.md に書いてある', () => {
  const doc = read(DESIGN_DOC)
  for (const id of Object.keys(RULES)) assert.ok(doc.includes(`\`${id}\``), `${id} が ${DESIGN_DOC} にない`)
})

test('ガードのルールの ID は、すべて work.md の「止められたとき」に代わりの手順と一緒に書いてある', () => {
  const doc = read('docs/process/work.md')
  for (const id of [...Object.keys(MESSAGES), 'no-edit-on-main', 'no-secret-files', 'no-local-dir', 'no-git-internals', 'artifact-copy', 'harness-change', 'harness-config']) {
    assert.ok(doc.includes(`\`${id}\``), `${id} が docs/process/work.md にない`)
  }
})

test('評価軸 R1〜R10 は、評価軸とレビュー役の手順で同じ', () => {
  const rubric = read('docs/process/review-rubric.md')
  for (let i = 1; i <= 10; i++) assert.match(rubric, new RegExp(`\\| R${i} \\|`), `R${i} が review-rubric.md の表にない`)
  const reviewer = read('docs/process/reviewer.md')
  for (const word of ['APPROVE', 'REQUEST_CHANGES', 'COMMENT', 'blocker', 'major', 'minor', 'nit']) assert.ok(reviewer.includes(word), word)
})

test('このブランチの作業ツリーは、機械のチェックに通る（文書のリンク、宣言、人の判断、skill の写し）', () => {
  const results = runChecks({ source: treeSource(root), cwd: root, quick: true })
  assert.ok(!hasFailure(results), formatResults(results.filter((result) => result.status === 'fail')))
})
