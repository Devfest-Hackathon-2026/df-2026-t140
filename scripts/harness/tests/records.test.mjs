// 作業宣言、人の判断、名前の決まり、秘密情報、グロブの評価用の入力セット
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { checkBranchName, checkCommitMessage, isWipPr, ledgerPathFor } from '../lib/conventions.mjs'
import {
  appendProdCheck,
  isProdCheckBundle,
  looksLikeProdCheck,
  markHumanDone,
  parseHumanTodo,
  renderHumanTemplate,
  renderProdCheckBundle,
  validateHumanTodo,
  validateProdCheckBundles,
} from '../lib/humans.mjs'
import { parseIssueNumber, parseLedger, renderLedgerTemplate, validateLedger } from '../lib/ledger.mjs'
import { globsOverlap, matchesAny } from '../lib/paths.mjs'
import { readAutonomy } from '../lib/autonomy.mjs'
import { forbiddenFileReason, scanAddedLines, scanText } from '../lib/secrets.mjs'

test('作業中の PR：ドラフトか「作業中」ラベルなら作業中（gh の {name} の形と、文字列の形のどちらも読む）', () => {
  assert.equal(isWipPr({ isDraft: true, labels: [] }), true)
  assert.equal(isWipPr({ isDraft: false, labels: [{ name: '作業中' }] }), true) // work-index（gh pr list の形）
  assert.equal(isWipPr({ isDraft: false, labels: ['作業中'] }), true) // hook（名前だけにした形）
  assert.equal(isWipPr({ isDraft: false, labels: [{ name: 'bug' }] }), false)
  assert.equal(isWipPr({ isDraft: false }), false)
  assert.equal(isWipPr(undefined), false)
})

test('ブランチ名：これまでの名前は通し、決まりに合わない名前は止める', () => {
  for (const name of ['chore/local-prod-parity', 'docs/screen-flow', 'docs/ui-meeting-2026-11-06', 'feat/trip-create', 'fix/pin-sync']) {
    assert.ok(checkBranchName(name).ok, name)
  }
  for (const name of ['main', 'my-branch', 'feature/x', 'feat/Trip', 'feat/trip_create', 'feat/a/b', 'feat/', `feat/${'a'.repeat(60)}`]) {
    assert.equal(checkBranchName(name).ok, false, name)
  }
  assert.equal(ledgerPathFor('feat/trip-create'), 'docs/work/feat-trip-create.md')
})

test('commit メッセージ：「種類: 説明」を通し、それ以外を止める', () => {
  for (const message of ['feat: 旅の作成画面を追加する', 'docs: 議事録を足す\n\n本文', 'fix(web): 直す', 'Merge pull request #1 from x', 'Revert "feat: x"', '# コメント\nchore: 片付ける']) {
    assert.ok(checkCommitMessage(message).ok, message)
  }
  for (const message of ['update', '旅の作成画面', 'feature: x', 'feat:x', 'feat:  ']) {
    assert.equal(checkCommitMessage(message).ok, false, message)
  }
})

const filledLedger = (overrides = {}) => {
  let text = renderLedgerTemplate({ branch: 'feat/trip-create', title: '旅の作成', issue: 12, owner: 'Takana', agent: 'Claude Code', started: '2026-11-07', scope: ['web/src/features/create-trip/**'] })
  text = text
    .replace(/(## 目的\n\n)<!--[^]*?-->/, '$1S01 で旅を作れるようにする')
    .replace(/- \[ \][ \t]*\n/, '- [ ] 2 つ目のブラウザで同じ旅に入れる\n')
    .replace(/(## 正本への影響\n\n)<!--[^]*?-->/, '$1なし')
  for (const [from, to] of Object.entries(overrides)) text = text.replace(from, to)
  return parseLedger(text, 'docs/work/feat-trip-create.md')
}

test('作業宣言：ひな形を埋めれば通り、空のままなら何が足りないかを言う', () => {
  assert.deepEqual(validateLedger(filledLedger(), { phase: 'declare', branch: 'feat/trip-create' }), [])
  const empty = parseLedger(renderLedgerTemplate({ branch: 'feat/x', title: 'x', owner: '', agent: '', started: '', scope: [] }), 'docs/work/feat-x.md')
  const errors = validateLedger(empty, { phase: 'declare' })
  assert.ok(errors.some((error) => error.includes('scope')))
  assert.ok(errors.some((error) => error.includes('目的')))
  assert.ok(errors.some((error) => error.includes('完了条件')))
  assert.ok(validateLedger(filledLedger(), { branch: 'feat/other' }).some((error) => error.includes('違います')))
})

test('作業宣言：完了のときは、結果・完了条件の印・issue 番号を求める', () => {
  const unfinished = filledLedger({ 'status: 進行中': 'status: 完了' })
  const errors = validateLedger(unfinished, { phase: 'finish' })
  assert.ok(errors.some((error) => error.includes('結果')))
  assert.ok(errors.some((error) => error.includes('未チェック')))
  const done = filledLedger({ 'status: 進行中': 'status: 完了', '- [ ] 2 つ目': '- [x] 2 つ目', '<!-- 完了時に書く：やったこと、確かめたこと、残したこと -->': '作った' })
  assert.deepEqual(validateLedger(done, { phase: 'finish' }), [])
  const partial = filledLedger({ 'status: 進行中': 'status: 完了', '同じ旅に入れる': '同じ旅に入れる（未達：Emulator が動かない）', '<!-- 完了時に書く：やったこと、確かめたこと、残したこと -->': '作った' })
  assert.deepEqual(validateLedger(partial, { phase: 'finish' }), [])

  // issue 番号の解釈と検証
  assert.equal(parseIssueNumber(15), 15)
  assert.equal(parseIssueNumber('#15'), 15)
  assert.equal(parseIssueNumber('https://github.com/Lazyturtle0852/konbu-devfest/issues/15'), 15)
  assert.equal(parseIssueNumber(''), undefined)
  assert.ok(Number.isNaN(parseIssueNumber('abc')))
  const badIssue = filledLedger({ 'issue: 12': 'issue: abc' })
  assert.ok(validateLedger(badIssue, { phase: 'declare' }).some((error) => error.includes('issue')))
  const missingIssueOnFinish = filledLedger({ 'issue: 12': 'issue: ', 'status: 進行中': 'status: 完了', '- [ ] 2 つ目': '- [x] 2 つ目', '<!-- 完了時に書く：やったこと、確かめたこと、残したこと -->': '作った' })
  assert.ok(validateLedger(missingIssueOnFinish, { phase: 'finish' }).some((error) => error.includes('issue')))
})

test('人の判断：open は問いが要り、done は決めた内容・人・日が要り、理由がなければ注意', () => {
  const template = renderHumanTemplate({ id: '2026-11-07-x', title: 'x', kind: '有料API', askedBy: 'feat/x', created: '2026-11-07' })
  assert.ok(validateHumanTodo(parseHumanTodo(template, 'todo/humans/x.md')).errors.some((error) => error.includes('決めてほしいこと')))
  const asked = template.replace(/(## 決めてほしいこと\n\n)<!--[^]*?-->/, '$1本番で Gemini を呼んでよいか')
  assert.deepEqual(validateHumanTodo(parseHumanTodo(asked, 'todo/humans/x.md')).errors, [])

  const doneWithoutReason = markHumanDone(asked, { decision: 'よい', decidedBy: 'Takana', decidedAt: '2026-11-07' })
  const result = validateHumanTodo(parseHumanTodo(doneWithoutReason, 'todo/humans/x.md'))
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)

  const done = markHumanDone(asked, { decision: 'よい', decidedBy: 'Takana', decidedAt: '2026-11-07', reason: 'デモで本物を見せたい' })
  const parsed = parseHumanTodo(done, 'todo/humans/x.md')
  assert.equal(parsed.status, 'done')
  assert.equal(parsed.decidedBy, 'Takana')
  assert.equal(parsed.sections['判断の理由'], 'デモで本物を見せたい')
  assert.deepEqual(validateHumanTodo(parsed), { errors: [], warnings: [] })

  const fakeDone = asked.replace('status: open', 'status: done')
  assert.ok(validateHumanTodo(parseHumanTodo(fakeDone, 'todo/humans/x.md')).errors.length >= 3, 'done なのに誰が何を決めたかがない')
  assert.ok(validateHumanTodo(parseHumanTodo(asked.replace('kind: 有料API', 'kind: なんでも'), 'x')).errors.length > 0)
})

test('本番での確認：open なまとめは 1 件だけで、確かめることは続きの番号で足し、別の項目は止める', () => {
  const bundle = renderProdCheckBundle({ id: '2026-11-22-prod-check', askedBy: 'chore/x（AI、Takana の端末）', created: '2026-11-22', issue: '627' })
  const parsed = parseHumanTodo(bundle, 'todo/humans/2026-11-22-prod-check.md')
  assert.ok(isProdCheckBundle(parsed))
  assert.equal(parsed.issue, '627')
  // 前の名前の付け方（個別の確認に -prod-check）は、まとめとして扱わない
  assert.equal(isProdCheckBundle({ id: '2026-11-21-shiori-confirm-prod-check', title: '#504 を本番に出したあと…' }), false)
  assert.equal(isProdCheckBundle({ id: '2026-11-22-prod-check', title: '別の題' }), false)
  assert.equal(isProdCheckBundle({ ...parsed, id: '2026-11-22-prod-check-2' }), true)
  assert.deepEqual(validateHumanTodo(parsed).errors, [], 'ひな形のままで「決めてほしいこと」が埋まっている')

  const once = appendProdCheck(bundle, { heading: '旅の再生の一時停止', from: '#374、PR #471' })
  const twice = appendProdCheck(once, { heading: 'PWA でしおりを開く' })
  const asked = parseHumanTodo(twice, 'x').sections['決めてほしいこと']
  assert.match(asked, /### 1\. 旅の再生の一時停止（#374、PR #471）\n\n- \[ \] /)
  assert.match(asked, /### 2\. PWA でしおりを開く\n\n- \[ \]$/)
  assert.ok(twice.indexOf('### 2.') < twice.indexOf('## 背景'), '背景より前に足す')

  // 題で見分ける：その他の本番・実機の確認だけ。費用（Maps の使用量）や、確認でない題は対象外
  assert.equal(looksLikeProdCheck({ title: 'iPhone の Safari で、しおりの拡大が戻るかを確かめる', kind: 'その他' }), true)
  assert.equal(looksLikeProdCheck({ title: '#504 を本番に出したあと、確定を確かめる', kind: 'その他' }), true)
  assert.equal(looksLikeProdCheck({ title: '本番に出したあと、Map Loads が上限に収まっているかを確かめる', kind: '費用' }), false)
  assert.equal(looksLikeProdCheck({ title: 'イベントの情報源を何にするか', kind: 'その他' }), false)

  const other = (title, extra = '') =>
    parseHumanTodo(
      renderHumanTemplate({ id: '2026-11-23-pwa', title, kind: 'その他', askedBy: 'feat/x', created: '2026-11-23' }).replace(/(## 決めてほしいこと\n\n)<!--[^]*?-->/, `$1確かめてほしい${extra}`),
      'todo/humans/2026-11-23-pwa.md',
    )
  assert.deepEqual(validateProdCheckBundles([parsed]), [])
  assert.equal(validateProdCheckBundles([parsed, other('PWA で開いて確かめる')]).length, 1, '別の項目で本番の確認を頼まない')
  assert.deepEqual(validateProdCheckBundles([parsed, other('PWA で開いて確かめる', '\n\n@harness-exception prod-check-bundle 本番でなく手元の確認')]), [])
  assert.equal(validateProdCheckBundles([parsed, other('PWA で開いて確かめる', '\n\n@harness-exception prod-check-bundle （本番での確認でない理由）')]).length, 1, '仮の理由のままでは外さない')
  assert.equal(validateProdCheckBundles([parsed, other('PWA で開いて確かめる', '\n\n@harness-exception prod-check-bundle')]).length, 1, '理由が空なら外さない')
  const second = parseHumanTodo(bundle.replaceAll('2026-11-22-prod-check', '2026-11-23-prod-check'), 'todo/humans/2026-11-23-prod-check.md')
  assert.equal(validateProdCheckBundles([parsed, second]).length, 1, 'まとめが 2 件 open')
  const closed = parseHumanTodo(markHumanDone(bundle, { decision: '全部 OK', decidedBy: 'Takana', decidedAt: '2026-11-23' }), 'todo/humans/2026-11-22-prod-check.md')
  assert.deepEqual(validateProdCheckBundles([closed, second, { ...other('PWA で開いて確かめる'), status: 'done' }]), [], 'done になったものは数えない')
})

test('秘密情報：本物に見える値と、置いてはいけないファイルを見つける', () => {
  const key = ['AI', 'za', 'Sy', 'A'.repeat(33)].join('')
  assert.equal(scanText(`const apiKey = '${key}'`)[0].id, 'google-api-key')
  assert.equal(scanText(['-----BEGIN ', 'PRIVATE KEY-----'].join(''))[0].id, 'private-key')
  assert.equal(scanText(['gh', 'p_', 'a'.repeat(36)].join('')).length, 1)
  assert.equal(scanText('VITE_GOOGLE_MAPS_API_KEY=').length, 0, '変数の名前だけなら通す')
  const diff = `+++ b/web/src/x.ts\n@@ -1,0 +1,2 @@\n+const a = 1\n+const key = '${key}'\n`
  assert.deepEqual(scanAddedLines(diff).map((item) => [item.file, item.line]), [['web/src/x.ts', 2]])
  for (const path of ['.env', 'web/.env.local', 'functions/.env.production', 'service-account.json', 'a/server.key', '.local/kickoff.pdf', 'poc/x.ts']) {
    assert.ok(forbiddenFileReason(path), path)
  }
  for (const path of ['.env.example', 'web/.env.example', 'docs/env.md', 'web/src/keys.ts']) assert.equal(forbiddenFileReason(path), undefined, path)
})

test('グロブ：範囲の重なりを多めに見つけ、無関係なものは重ならない', () => {
  assert.ok(matchesAny('web/src/features/create-trip/ui/A.tsx', ['web/src/features/create-trip/**']))
  assert.ok(matchesAny('web/src/app/App.tsx', ['web/src/app']))
  assert.ok(!matchesAny('web/src/apple/x.ts', ['web/src/app']))
  assert.ok(globsOverlap('web/src/**', 'web/src/features/x/**'))
  assert.ok(globsOverlap('firestore.rules', 'firestore.rules'))
  assert.ok(globsOverlap('web/src/app/App.tsx', 'web/src/app/**'))
  assert.ok(!globsOverlap('web/src/features/a/**', 'web/src/features/b/**'))
  assert.ok(!globsOverlap('functions/src/**', 'web/src/**'))
})

test('自動で進めてよい期間：期限の前だけ有効で、設定がなければ無効', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-autonomy-'))
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ autonomousUntil: '2026-11-07T10:00:00+09:00', decidedBy: 'Takana' }))
  assert.equal(readAutonomy(dir, new Date('2026-11-07T01:00:00+09:00')).active, true)
  assert.equal(readAutonomy(dir, new Date('2026-11-07T10:00:01+09:00')).active, false)
  writeFileSync(join(dir, 'harness.config.json'), JSON.stringify({ autonomousUntil: 'いつか' }))
  assert.equal(readAutonomy(dir).active, false, '読めない日付は無効')
  assert.equal(readAutonomy(join(dir, 'none')).active, false)
  rmSync(dir, { recursive: true, force: true })
})
