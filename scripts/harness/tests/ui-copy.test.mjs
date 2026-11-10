// 画面の文言の抜き出し（lib/ui-copy.mjs）と、文言を足した編集で yomiyasu を思い出させるフック（hook.mjs の post-edit）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { addedCopy, extractCopy, isCopyFile, undoEdits } from '../lib/ui-copy.mjs'

const texts = (source) => extractCopy(source).map((item) => item.text)

test('文字列、テンプレート、JSX のテキストから日本語の文言を拾う', () => {
  const source = [
    "const a = '名前を入れてください'",
    'const b = "温泉"',
    'const c = `名前は ${max} 文字までです`',
    'const d = <p className="x">ページが見つかりません</p>',
  ].join('\n')
  assert.deepEqual(texts(source), ['名前を入れてください', '温泉', '名前は 〇 文字までです', 'ページが見つかりません'])
  assert.deepEqual(
    extractCopy(source).map((item) => [item.line, item.kind]),
    [
      [1, 'string'],
      [2, 'string'],
      [3, 'template'],
      [4, 'jsx'],
    ],
  )
})

test('JSX のテキストの中の {…} は 〇 にして、次のタグまで 1 つの文言にする', () => {
  const source = `<p>
    建物が {need} つ建つと、ルート案が {count} つ出ます（いま {built} つ）。
  </p>`
  assert.deepEqual(texts(source), ['建物が 〇 つ建つと、ルート案が 〇 つ出ます（いま 〇 つ）。'])
  assert.deepEqual(texts('<span>{name} に投票しました</span>'), ['〇 に投票しました'])
})

test('閉じタグのあとに同じ行で続く文言も拾う（閉じタグの / を正規表現と読まない）', () => {
  assert.deepEqual(texts('<p><span>名前</span><span>メール</span></p>'), ['名前', 'メール'])
  assert.deepEqual(texts('<p>計 {xs.map((x) => <b>{x}</b>)} 件</p>\nconst after = "あとの文言"'), ['計 〇 件', 'あとの文言'])
})

test('JSX のテキストの中の {a}/{b} の / を正規表現と読まない（PR #35 のレビュー）', () => {
  // 文言は最後の {…} のあとからつなぐ（「件」を取りこぼさないことが目的）
  assert.deepEqual(texts('<p>{a}/{b} 件</p>'), ['〇 件'])
  assert.deepEqual(texts('<p>{a}/{b} 件\n</p>'), ['〇 件'])
  assert.deepEqual(texts('<p>合計 <b>{n}</b>/{max} 件</p>'), ['合計', '〇 件'])
  // コードの } のあとの正規表現は、今までどおり正規表現として読む
  assert.deepEqual(texts("if (x) {}\n/[ぁ-ん]+/.test(s)\nconst a = 'あと'"), ['あと'])
})

test('JSX のテキストの行番号は、文言が始まる行', () => {
  const source = '<ButtonLink to="/">\n  ホームへ\n</ButtonLink>\n<p>\n  {n} 件\n</p>'
  assert.deepEqual(
    extractCopy(source).map((item) => [item.line, item.text]),
    [
      [2, 'ホームへ'],
      [5, '〇 件'],
    ],
  )
})

test('JSX の {…} の中の文字列も拾う', () => {
  assert.deepEqual(texts("<span>{wisher ? `${wisher.name}の希望：` : '希望：'}</span>"), ['〇の希望：', '希望：'])
})

test('コメント、正規表現、日本語のない文字列は拾わない', () => {
  const source = [
    '// コメントの日本語',
    '/* 複数行の',
    '   コメント */',
    "const re = /[ぁ-ん]+'/u",
    "const ok = 'hello'",
    "const ratio = a / b / 'ピン'.length",
  ].join('\n')
  assert.deepEqual(texts(source), ['ピン'])
})

test('点検の対象は web/src の .ts と .tsx だけ（テストと型の宣言は除く）', () => {
  assert.equal(isCopyFile('web/src/pages/x/ui/X.tsx'), true)
  assert.equal(isCopyFile('web/src/entities/pin/model/pins.ts'), true)
  assert.equal(isCopyFile('web/src/x.test.ts'), false)
  assert.equal(isCopyFile('web/src/vite-env.d.ts'), false)
  assert.equal(isCopyFile('functions/src/index.ts'), false)
  assert.equal(isCopyFile('web/src/app/App.css'), false)
})

test('addedCopy は、前になかった文言だけを返す', () => {
  const before = "const a = '温泉'"
  const after = "const a = '温泉'\nconst b = 'スキー'\nconst c = 'スキー'"
  assert.deepEqual(addedCopy(before, after).map((item) => item.text), ['スキー'])
  assert.deepEqual(addedCopy(after, before), [])
})

test('undoEdits：new_string が前にもあると戻し方が決まらないので、候補をすべて返す（PR #35 のレビュー）', () => {
  // 前から「温泉」があり、あとの OLD を「温泉」に置き換えた。最初の出現だけを戻すと、違う所を戻す
  const after = "const a = '温泉'\nconst b = '温泉'"
  const befores = undoEdits(after, [{ old_string: 'OLD', new_string: '温泉' }])
  assert.deepEqual(befores, ["const a = 'OLD'\nconst b = '温泉'", "const a = '温泉'\nconst b = 'OLD'"])
  // どちらの戻し方でも「温泉」は前からあったので、足した文言はない
  assert.ok(befores.every((before) => addedCopy(before, after).length === 0))
  // Edit の決まり（old_string は 1 か所だけ）に合わない戻し方は外す
  // 後ろの X を戻すと OLDX が 2 か所になるので、前の X を戻した 'OLDOLDX X' だけが残る
  assert.deepEqual(undoEdits('OLDX X', [{ old_string: 'OLDX', new_string: 'X' }]), ['OLDOLDX X'])
  assert.deepEqual(undoEdits("a 'スキー' b 'スキー'", [{ old_string: '温泉', new_string: 'スキー', replace_all: true }]), ["a '温泉' b '温泉'"])
  assert.deepEqual(undoEdits('x', [{ old_string: 'y', new_string: '' }]), ['x'])
})

// ---- フック -----------------------------------------------------------------------

const hook = fileURLToPath(new URL('../hook.mjs', import.meta.url))
// 実在の画面に頼らないよう、一時フォルダに見本のプロジェクトを作る（画面の移動や削除でテストが落ちない）
const root = mkdtempSync(join(tmpdir(), 'konbu-ui-copy-'))
const PAGE = 'web/src/pages/fixture/ui/FixturePage.tsx'
const pageCopy = 'ページが見つかりません'
mkdirSync(join(root, 'web/src/pages/fixture/ui'), { recursive: true })
mkdirSync(join(root, 'scripts'), { recursive: true })
writeFileSync(join(root, PAGE), `export function FixturePage() {\n  return <p className="x">${pageCopy}</p>\n}\n`)
writeFileSync(join(root, 'scripts/copy-check.mjs'), "console.log('日本語')\n")
process.on('exit', () => rmSync(root, { recursive: true, force: true }))

function postEdit(toolInput) {
  const result = spawnSync(process.execPath, [hook, 'claude', 'post-edit'], {
    input: JSON.stringify({ session_id: 'test-ui-copy', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: toolInput }),
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HARNESS_OFFLINE: '1' },
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined
}

test('フック：web/src に日本語の文言を足した Edit では、止めずに yomiyasu を思い出させる', () => {
  const out = postEdit({ file_path: `${root}/${PAGE}`, old_string: 'NOT_FOUND_TITLE', new_string: pageCopy })
  assert.equal(out?.decision, undefined)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
  assert.match(out.hookSpecificOutput.additionalContext, /yomiyasu/)
  assert.ok(out.hookSpecificOutput.additionalContext.includes(pageCopy))
})

test('フック：日本語の文言を足していない Edit では何も出さない', () => {
  assert.equal(postEdit({ file_path: `${root}/${PAGE}`, old_string: 'className="y"', new_string: 'className="x"' }), undefined)
  assert.equal(postEdit({ file_path: `${root}/${PAGE}`, old_string: pageCopy, new_string: '', replace_all: true }), undefined)
  assert.equal(postEdit({ file_path: `${root}/scripts/copy-check.mjs`, old_string: 'x', new_string: '日本語' }), undefined)
})

test('フック：編集したファイルの場所が別の書き方（シンボリックリンク経由）でも、web/src の文言だと見分ける', () => {
  // macOS では一時フォルダが /var と /private/var の 2 通りに書かれ、git は後者を返す。Linux の CI でも同じ食い違いを作るため、
  // 見本のプロジェクトへのリンクを経由した場所で編集したことにする
  const link = `${root}-link`
  symlinkSync(root, link)
  try {
    const out = postEdit({ file_path: `${link}/${PAGE}`, old_string: 'NOT_FOUND_TITLE', new_string: pageCopy })
    assert.match(out?.hookSpecificOutput?.additionalContext ?? '', /yomiyasu/, 'リンク経由の場所で、web/src の文言だと見分けられなかった')
  } finally {
    rmSync(link, { force: true })
  }
})
