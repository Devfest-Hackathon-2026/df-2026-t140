import assert from 'node:assert/strict'
import { test } from 'node:test'
import { paneTitle } from '../lib/pane-title.mjs'

const ledger = { 'docs/work/fix-shiori-place-tap-close.md': '---\nbranch: fix/shiori-place-tap-close\ntitle: しおりで場所の情報を見ているとき、地図を押すとシートを閉じる\n---\n' }

test('作業宣言の title を pane の名前にする', () => {
  assert.equal(paneTitle({ branch: 'fix/shiori-place-tap-close', readLedger: (path) => ledger[path] }), 'しおりで場所の情報を見ているとき、地図を押すとシートを閉じる')
})

test('作業宣言がなければブランチ名', () => {
  assert.equal(paneTitle({ branch: 'feat/no-ledger', readLedger: () => undefined }), 'feat/no-ledger')
})

test('ブランチがなければ空', () => {
  assert.equal(paneTitle({ branch: '', readLedger: () => undefined }), '')
})

test('長い名前は切る', () => {
  const long = 'あ'.repeat(80)
  const title = paneTitle({ branch: 'x', readLedger: () => `---\ntitle: ${long}\n---\n` })
  assert.equal(title.length, 60)
  assert.ok(title.endsWith('…'))
})

test('端末に書く前に制御文字を除く（PR #62 のレビュー）', () => {
  const title = paneTitle({ branch: 'x', readLedger: () => '---\ntitle: "作業\u001b]0;evil\u0007の名前"\n---\n' })
  assert.equal(title, '作業]0;evilの名前')
  assert.equal(paneTitle({ branch: 'fix/\u001bx', readLedger: () => undefined }), 'fix/x')
})
