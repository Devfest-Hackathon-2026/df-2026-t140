// Discord への通知（lib/discord.mjs）。送る処理は fetch を差し替え、本物には送らない。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANNELS, COLORS, editDiscord, humanLink, ledgerEvent, mentionIds, postDiscord, messageText, prNumbersFromSubjects, renderDone, renderHuman, renderRun, renderStart, webhookFor } from '../lib/discord.mjs'

const ledger = (over = {}) => ({
  title: 'しおりに食事と宿を入れる',
  owner: 'Paralysis',
  agent: 'Claude Code',
  status: '進行中',
  issue: 341,
  branch: 'feat/shiori-meals',
  scope: ['web/src/widgets/route-timeline/**'],
  sections: { 目的: '<!-- 書き方 -->\n食事の時間をしおりに入れる\n2 行目' },
  doneCriteria: [{ label: '食事が出る' }, { label: '`宿` が出る' }],
  ...over,
})

test('作業宣言の前後から、着手と完了を見分ける（同じ状態のままなら流さない）', () => {
  assert.equal(ledgerEvent(undefined, ledger()), 'start')
  assert.equal(ledgerEvent(ledger(), ledger({ status: '完了' })), 'done')
  assert.equal(ledgerEvent(undefined, ledger({ status: '完了' })), 'done', '宣言と作業が一度に入ったとき')
  assert.equal(ledgerEvent(ledger(), ledger()), undefined, '進行中のまま中身だけ変わった')
  assert.equal(ledgerEvent(ledger({ status: '完了' }), ledger({ status: '完了' })), undefined)
  assert.equal(ledgerEvent(ledger({ status: '完了' }), ledger()), undefined, '完了から戻ったときは着手として流さない')
  assert.equal(ledgerEvent(ledger(), undefined), undefined)
})

const embed = (message) => message.embeds[0]
const field = (message, name) => embed(message).fields?.find((item) => item.name === name)?.value

test('担当：名簿に Discord の ID があればメンション、なければ GitHub のアカウント名', () => {
  const members = [{ github: 'Mah110hat', names: ['Paralysis'], discord: '123456789012345678' }]
  assert.equal(field(renderStart(ledger(), { members }), '担当'), '<@123456789012345678> の Claude Code')
  assert.equal(field(renderDone(ledger(), { members }), '担当'), '<@123456789012345678> の Claude Code')
  assert.equal(field(renderStart(ledger(), { members: [{ github: 'Mah110hat', names: ['Paralysis'], discord: '' }] }), '担当'), 'Mah110hat の Claude Code')
})

test('#着手：青いカード。題は Issue か PR へのリンク、目的の 1 行目、担当、触る範囲', () => {
  const message = renderStart(ledger(), { repoUrl: 'https://github.com/o/r', pr: { number: 342, url: 'https://github.com/o/r/pull/342' } })
  assert.equal(embed(message).title, '🟡 着手：しおりに食事と宿を入れる')
  assert.equal(embed(message).url, 'https://github.com/o/r/pull/342')
  assert.equal(embed(message).color, COLORS.start)
  assert.equal(embed(message).description, '食事の時間をしおりに入れる', 'コメントの書き方の案内は出さない')
  assert.equal(field(message, '担当'), 'Paralysis の Claude Code')
  assert.equal(field(message, 'PR'), '#342')
  assert.match(field(message, '触る範囲'), /route-timeline/)
  assert.equal(embed(renderStart(ledger(), { repoUrl: 'https://github.com/o/r' })).url, 'https://github.com/o/r/issues/341')
  assert.equal(field(renderStart(ledger(), {}), 'PR'), undefined, '値のない欄は出さない')
})

test('#完了：緑のカード。完了条件を 3 つまで、画像の有無、残った人間待ち', () => {
  const message = renderDone(ledger({ status: '完了' }), { pr: { number: 342, url: 'u' }, waiting: [{ title: '本番の設定' }], hasMedia: true })
  assert.equal(embed(message).title, '✅ 完了：しおりに食事と宿を入れる')
  assert.equal(embed(message).color, COLORS.done)
  assert.match(embed(message).description, /・宿 が出る/)
  assert.ok(field(message, '📷 画面'))
  assert.equal(field(message, '⏸ 人間待ちが 1 件残っています'), '・本番の設定')
  assert.equal(field(renderDone(ledger(), {}), '📷 画面'), undefined)
})

test('#人間待ち：人間待ちは赤、決まって対応中は黄、完了は緑。題のリンクは止めている Issue', () => {
  const todo = { title: 'トークンを登録する', kind: '権限', blocks: '#317', status: 'open', path: 'todo/humans/x.md', sections: { 決めてほしいこと: '<!-- 案内 -->\n登録してよいか\n手順…' } }
  const waiting = renderHuman(todo, { url: 'U' })
  assert.equal(embed(waiting).title, '⏸ 人間待ち：トークンを登録する')
  assert.equal(embed(waiting).url, 'U')
  assert.equal(embed(waiting).color, COLORS.waiting)
  assert.equal(COLORS.waiting, 0xcf222e)
  assert.equal(embed(waiting).description, '**必要なこと**\n登録してよいか')
  assert.equal(field(waiting, '止まっていること'), '#317')
  assert.equal(field(waiting, '種類'), '権限')
  const decidedTodo = { ...todo, status: 'done', decision: '登録した', decidedBy: 'かめ', decidedAt: '2026-11-16', sections: { 判断の理由: '安いから' } }
  const working = renderHuman(decidedTodo, { url: 'U', phase: 'working', assignee: '<@1>' })
  assert.equal(embed(working).title, '🔧 対応中：トークンを登録する')
  assert.equal(embed(working).color, COLORS.working)
  assert.equal(COLORS.working, 0xd29922)
  assert.equal(embed(working).description, '**決めたこと**\n登録した')
  assert.equal(field(working, '決めた人'), 'かめ')
  assert.equal(field(working, '対応する人'), '<@1>')
  assert.equal(field(working, '理由'), '安いから')
  // phase がなければ対応中として出す
  assert.equal(embed(renderHuman(decidedTodo, { url: 'U' })).title, '🔧 対応中：トークンを登録する')
  const done = renderHuman(decidedTodo, { url: 'U', phase: 'done', assignee: '<@1>' })
  assert.equal(embed(done).title, '✅ 完了：トークンを登録する')
  assert.equal(embed(done).color, COLORS.done)
  assert.equal(COLORS.done, 0x2ea043)
  assert.equal(field(done, '対応する人'), undefined)
  assert.equal(humanLink(todo, { repoUrl: 'R', targets: [317] }), 'R/issues/317')
  assert.equal(humanLink(todo, { repoUrl: 'R', targets: [] }), 'R/blob/main/todo/humans/x.md')
  assert.match(messageText(waiting), /^⏸ 人間待ち：トークンを登録する\nU\n\*\*必要なこと\*\*/)
})

test('#本番反映：反映の成功（紫）と失敗（赤）、main の失敗（赤）だけを流す', () => {
  const run = (over) => ({ name: 'CI', conclusion: 'success', head_branch: 'main', html_url: 'L', actor: { login: 'kame' }, head_commit: { message: 'Merge pull request #331\n\n本文' }, ...over })
  const deployed = renderRun(run({ name: 'Deploy', head_branch: 'deploy' }), { prs: [{ number: 319, title: '旅の合言葉' }] })
  assert.equal(embed(deployed).title, '🚀 本番に反映しました')
  assert.equal(embed(deployed).color, COLORS.release)
  assert.equal(embed(deployed).description, '・#319 旅の合言葉')
  assert.equal(field(deployed, '反映した人'), 'kame')
  assert.match(embed(renderRun(run({ name: 'Deploy', head_branch: 'deploy' }))).description, /出し直し/)
  assert.equal(embed(renderRun(run({ name: 'Deploy', conclusion: 'failure', head_branch: 'deploy' }))).color, COLORS.failure)
  assert.equal(renderRun(run({ name: 'Deploy', conclusion: 'cancelled' })), undefined)
  const broken = renderRun(run({ conclusion: 'failure' }))
  assert.equal(embed(broken).title, '🔴 main のテストが落ちています')
  assert.match(embed(broken).description, /直前の commit：Merge pull request #331/)
  assert.equal(embed(renderRun(run({ name: 'Kanban', conclusion: 'failure' }))).title, '🔴 カンバンの同期が失敗しました')
  assert.equal(renderRun(run({})), undefined, '成功は流さない')
  assert.equal(renderRun(run({ conclusion: 'failure', head_branch: 'feat/x' })), undefined, 'PR のブランチの失敗は流さない')
})

test('カードは Discord の上限に収める（題 256・本文 4096・欄 1024 文字）', () => {
  const long = 'あ'.repeat(5000)
  const message = renderHuman({ title: long, kind: long, blocks: long, status: 'open', path: 'p', sections: { 決めてほしいこと: long } }, { url: 'U' })
  assert.ok(embed(message).title.length <= 256)
  assert.ok(embed(message).description.length <= 4096)
  assert.ok(embed(message).fields.every((item) => item.value.length <= 1024))
})

test('送るときはメンションを飛ばさない。Discord が失敗を返したら例外にする', async () => {
  const calls = []
  const ok = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return { ok: true, status: 204 }
  }
  await postDiscord('https://discord.invalid/hook', '@everyone テスト', { fetchImpl: ok })
  assert.deepEqual(calls[0].body, { content: '@everyone テスト', allowed_mentions: { parse: [] } })
  await postDiscord('https://discord.invalid/hook', { embeds: [{ title: '@everyone カード' }] }, { fetchImpl: ok })
  assert.deepEqual(calls[1].body, { embeds: [{ title: '@everyone カード' }], allowed_mentions: { parse: [] } }, 'カードもメンションを飛ばさない')
  await assert.rejects(postDiscord('h', 'x', { fetchImpl: async () => ({ ok: false, status: 404 }) }), /404/)
})

test('Webhook は secret から読み、未登録なら送らない。チャンネルは 4 つ', () => {
  assert.deepEqual(Object.values(CHANNELS).map((channel) => channel.name), ['着手', '完了', '人間待ち', '本番反映'])
  assert.equal(webhookFor('start', { DISCORD_WEBHOOK_START: 'https://discord.invalid/1' }), 'https://discord.invalid/1')
  assert.equal(webhookFor('release', {}), undefined)
  assert.equal(webhookFor('done', { DISCORD_WEBHOOK_DONE: '' }), undefined)
})

test('wait: true で送ると、あとで書き換えるためのメッセージの番号を返す。書き換えは同じ Webhook の messages/<番号> に PATCH', async () => {
  const calls = []
  const fake = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({ id: '1234567890' }) }
  }
  const id = await postDiscord('https://discord.invalid/api/webhooks/1/abc', '⏸ 人間待ち', { fetchImpl: fake, wait: true })
  assert.equal(id, '1234567890')
  assert.equal(calls[0].url, 'https://discord.invalid/api/webhooks/1/abc?wait=true')
  await editDiscord('https://discord.invalid/api/webhooks/1/abc', id, { embeds: [{ title: '✅ 決まりました' }] }, { fetchImpl: fake })
  assert.deepEqual(calls[1], { url: 'https://discord.invalid/api/webhooks/1/abc/messages/1234567890', method: 'PATCH', body: { embeds: [{ title: '✅ 決まりました' }], allowed_mentions: { parse: [] } } })
  await assert.rejects(editDiscord('h', '1', 'x', { fetchImpl: async () => ({ ok: false, status: 404 }) }), /404/)
})

test('本番に入った PR は、merge の commit と squash の commit の題の両方から拾う', () => {
  assert.deepEqual(prNumbersFromSubjects(['Merge pull request #319 from o/feat', 'feat: 合言葉 (#320)', 'docs: 宣言', 'Merge pull request #319 from o/feat', 'fix: x (#12) と y']), ['319', '320'])
})

test('#人間待ち のメンション：mention: に書いた人、なければ頼んだ人。名指しした人だけ鳴らし、決まったあとは鳴らさない', async () => {
  const members = [
    { github: 'Lazyturtle0852', names: ['たーとる'], discord: '679684163590160391' },
    { github: 'Takana-12', names: ['Takana'], discord: '1358622387834322944' },
    { github: 'NoId', names: [], discord: '' },
  ]
  const todo = { title: 'Calendar API を有効にする', kind: '権限', blocks: '#396', status: 'open', path: 'p', mention: '', sections: { 決めてほしいこと: '有効にしてよいか' } }
  assert.deepEqual(mentionIds(todo, { asker: 'Takana', members }), ['1358622387834322944'], '書いていなければ頼んだ人')
  assert.deepEqual(mentionIds({ ...todo, mention: 'たーとる' }, { asker: 'Takana', members }), ['679684163590160391'], '名指しした人（頼んだ人には鳴らさない）')
  assert.deepEqual(mentionIds({ ...todo, mention: '@Lazyturtle0852、Takana' }, { members }), ['679684163590160391', '1358622387834322944'])
  assert.deepEqual(mentionIds({ ...todo, mention: 'NoId 知らない人' }, { asker: 'Takana', members }), ['1358622387834322944'], '名指しした人がだれも引けなければ頼んだ人に戻す')
  assert.deepEqual(mentionIds({ ...todo, mention: 'たーとる 知らない人' }, { asker: 'Takana', members }), ['679684163590160391'], '引けた人だけを鳴らす')
  assert.deepEqual(mentionIds({ ...todo, mention: 'NoId' }, { members }), [], '頼んだ人も分からなければだれも鳴らさない')
  assert.deepEqual(mentionIds(todo, { members }), [])

  const waiting = renderHuman(todo, { url: 'U', mentions: ['679684163590160391'] })
  assert.equal(waiting.content, '<@679684163590160391> 人間待ちです')
  assert.equal(embed(waiting).title, '⏸ 人間待ち：Calendar API を有効にする')
  assert.equal(renderHuman(todo, { url: 'U' }).content, undefined, '相手がいなければ本文を付けない')
  const decided = renderHuman({ ...todo, status: 'done', decision: 'A', decidedBy: 'かめ', decidedAt: 'd', sections: {} }, { url: 'U', phase: 'working', mentions: ['679684163590160391'] })
  assert.equal(decided.content, '', '決まったあとのカードでは鳴らさず、前の本文のメンションも消す')

  const calls = []
  const ok = async (url, init) => {
    calls.push(JSON.parse(init.body))
    return { ok: true, status: 204 }
  }
  await postDiscord('https://discord.invalid/hook', waiting, { fetchImpl: ok })
  assert.deepEqual(calls[0].allowed_mentions, { parse: [], users: ['679684163590160391'] }, '名指しした人だけ鳴らし、@everyone とロールは鳴らさない')
  await postDiscord('https://discord.invalid/hook', { content: '@everyone', allowed_mentions: { parse: ['everyone'], users: ['x'] } }, { fetchImpl: ok })
  assert.deepEqual(calls[1].allowed_mentions, { parse: [] }, 'ID でない名指しや parse は通さない')
})
