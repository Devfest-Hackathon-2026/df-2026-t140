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
    mention: data.mention ?? '',
    created: data.created ?? '',
    blocks: data.blocks ?? '',
    issue: data.issue ?? '',
    decidedBy: data.decided_by ?? '',
    decidedAt: data.decided_at ?? '',
    decision: data.decision ?? '',
    sections,
    // 本番での確認のまとめから外す例外の理由（「@harness-exception prod-check-bundle <理由>」の <理由>。行がなければ undefined）
    exceptionReason: body.match(/@harness-exception prod-check-bundle[ \t]*(.*)/)?.[1].trim(),
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

export function renderHumanTemplate({ id, title, kind, askedBy, created, blocks = '', issue = '', mention = '' }) {
  return `---
id: ${id}
title: ${title}
status: ${HUMAN_STATUS.open}
kind: ${kind}
asked_by: ${askedBy}
mention: ${mention}
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

// 本番での確認（本番に出したあとでしか確かめられないこと）は、open なものを常に 1 件にまとめ、中をチェックリストにする。
// 人が見る場所を 1 つの項目と 1 つの Issue にするため（Takana の指示、2026-11-22。todo/humans/README.md「本番に出したあとでしか確かめられないこと」）。
// 足すのは `npm run human -- prod-check`。`add` で別に作ろうとすると止め、CI も 2 件以上を落とす。
export const PROD_CHECK_SLUG = 'prod-check'
export const PROD_CHECK_TITLE = '本番での確認（まとめ）'
// 設計方針の `@harness-exception <分類>/<名前>`（lib/source.mjs、コードの例外）とは別物。todo/humans/ の本文だけで読み、arch の検査は拾わない
export const PROD_CHECK_EXCEPTION = '@harness-exception prod-check-bundle'
/** add --not-prod-check が入れる仮の理由。このままでは例外として通さない */
export const PROD_CHECK_EXCEPTION_PLACEHOLDER = '（本番での確認でない理由）'

/**
 * 本番での確認のまとめの項目か（id が <日付>-prod-check か、同じ日に 2 つ目を作ったときの <日付>-prod-check-<n>、題がまとめの題）。
 * 前は個別の確認にも -prod-check を付けていた（2026-11-21-shiori-confirm-prod-check など）ので、末尾だけでは見分けない
 */
export const isProdCheckBundle = (todo) =>
  new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${PROD_CHECK_SLUG}(-\\d+)?$`).test(todo.id ?? '') && todo.title === PROD_CHECK_TITLE

/** 本番に出したあとの確認らしい題か。費用（Maps の使用量など）や権限の判断は別の項目のままにするので、kind がその他のときだけ見る */
export function looksLikeProdCheck({ title = '', kind = 'その他' }) {
  if (kind !== 'その他') return false
  return /(本番|実機|iPhone|iOS|Android|Safari|PWA|ホーム画面|deploy|デプロイ)/i.test(title) && /(確か|確認|チェック)/.test(title)
}

/** まとめの項目の本文（ひな形の「決めてほしいこと」「背景」「選択肢」を埋めたもの） */
export function renderProdCheckBundle({ id, askedBy, created, issue = '' }) {
  return renderHumanTemplate({ id, title: PROD_CHECK_TITLE, kind: 'その他', askedBy, created, issue })
    .replace(
      /(## 決めてほしいこと\n\n)<!--[^]*?-->\n/,
      `$1本番（main を deploy ブランチへ反映したあと）で、下のチェックリストを上から確かめてください。項目ごとに、OK なら印を付けます。だめな項目は、番号と画面のスクリーンショットを AI に伝えてください（AI が直す Issue を起票します）。

本番での確認は、この 1 件に足していきます（Takana の指示、2026-11-22）。全部に印が付いたら done にします。
`,
    )
    .replace(
      /(## 背景\n\n)<!--[^]*?-->\n/,
      '$1AI は、本番への反映（deploy ブランチ）も、実機と本物の地図での確認もできない。人が見る場所を 1 つにするため、本番での確認はこの 1 件と、その Issue にまとめる（todo/humans/README.md「本番に出したあとでしか確かめられないこと」）。\n',
    )
    .replace(/(## 選択肢\n\n)<!--[^]*?-->\n/, '$1なし（確かめるだけ）。だめな項目があれば、AI が直す Issue を起票する。\n')
    .replace(/(## AI の推奨\n\n)<!--[^]*?-->\n/, '$1なし\n')
}

/** まとめの項目の「決めてほしいこと」の最後に、確かめることの見出しと空のチェックを 1 つ足す。番号は続きから振る */
export function appendProdCheck(text, { heading, from = '' }) {
  const start = text.indexOf('## 決めてほしいこと')
  const end = text.indexOf('\n## ', start + 1)
  if (start < 0 || end < 0) throw new Error('「## 決めてほしいこと」と、そのあとの見出しが見つかりません')
  const number = (text.slice(start, end).match(/^### /gm) ?? []).length + 1
  const section = `### ${number}. ${heading}${from ? `（${from}）` : ''}\n\n- [ ] \n`
  // 手元の作業ツリーでは改行が CRLF のこともあるので、末尾の改行をまとめて落としてから空行を 1 つ置く
  return `${text.slice(0, end).replace(/[\r\n]*$/, '\n\n')}${section}${text.slice(end)}`
}

/** todo/humans/ 全体で、本番での確認が 1 件にまとまっているか（CI と commit で見る） */
export function validateProdCheckBundles(todos) {
  const open = todos.filter((todo) => todo.status !== HUMAN_STATUS.done)
  const bundles = open.filter(isProdCheckBundle)
  const errors = []
  if (bundles.length > 1) {
    errors.push(`本番での確認のまとめが ${bundles.length} 件 open です（${bundles.map((todo) => todo.path).join('、')}）。1 件に寄せ、ほかは done にします`)
  }
  const target = bundles[0]?.path ?? '`npm run human -- prod-check` で作るまとめ'
  const excused = (todo) => Boolean(todo.exceptionReason) && todo.exceptionReason !== PROD_CHECK_EXCEPTION_PLACEHOLDER
  for (const todo of open.filter((item) => item.exceptionReason !== undefined && !excused(item))) {
    errors.push(`${todo.path}：「${PROD_CHECK_EXCEPTION}」のあとに、本番での確認でない理由を書きます（仮の文言や空のままでは外しません）`)
  }
  for (const todo of open.filter((item) => !isProdCheckBundle(item) && item.exceptionReason === undefined && looksLikeProdCheck(item))) {
    errors.push(`${todo.path}：本番での確認は ${target} の 1 件にまとめます（\`npm run human -- prod-check --title "…"\` で足す）。本番での確認でないなら、本文に「${PROD_CHECK_EXCEPTION} <理由>」を書きます`)
  }
  return errors
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
