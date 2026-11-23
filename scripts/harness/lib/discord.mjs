// GitHub の出来事を Discord の 4 つのチャンネル（「GitHub 通知」カテゴリ）に知らせる文面と、送る処理。
// チャンネルと流すもの（かめの決定、2026-11-16。docs/process/work.md「Discord への通知」）：
//   #着手      作業宣言が main に入ったとき（誰の AI が何を始めたか）
//   #完了      作業が merge されたとき（作業宣言が「完了」で main に入ったとき）
//   #人間待ち  人間待ちが増えたとき・決まったとき（Issue のコメントと同じ中身を短く）
//   #本番反映  本番への反映の成功と失敗、main の CI とハーネスのワークフローの失敗
// commit、push、レビューのコメント、CI の成功は流さない（前の GitHub 通知チャンネルがうるさかったため）。
// Webhook の URL は秘密情報なので、リポジトリの secret（DISCORD_WEBHOOK_*）にだけ置く。登録は人の作業。
import { STATUS } from './ledger.mjs'
import { discordName, findMember } from './members.mjs'

export const CHANNELS = {
  start: { name: '着手', secret: 'DISCORD_WEBHOOK_START' },
  done: { name: '完了', secret: 'DISCORD_WEBHOOK_DONE' },
  human: { name: '人間待ち', secret: 'DISCORD_WEBHOOK_HUMAN' },
  release: { name: '本番反映', secret: 'DISCORD_WEBHOOK_RELEASE' },
}

const LIMIT = 1900 // Discord の 1 件は 2,000 文字まで
const clip = (text, max = LIMIT) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
const firstLine = (text) => String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').trim().split('\n').find((line) => line.trim()) ?? ''

/** 作業宣言の前後（old は前の版、なければ undefined）から、着手と完了を見分ける */
export function ledgerEvent(oldLedger, newLedger) {
  if (!newLedger) return undefined
  const before = oldLedger?.status
  if (newLedger.status === STATUS.active && before !== STATUS.active && before !== STATUS.done) return 'start'
  if (newLedger.status === STATUS.done && before !== STATUS.done) return 'done'
  return undefined
}

// 担当：人はメンション（名簿に Discord の ID があるとき）。カードの中のメンションは名前として出るだけで、通知は鳴らない
const who = (ledger, members = []) => {
  const person = ledger.owner && discordName(ledger.owner, members)
  return [person, ledger.agent].filter(Boolean).join(' の ') || '不明'
}

// カード（Discord の embed）の色。左の縦線に出る
// #人間待ち のカードは、人間待ちが赤、決まって対応中が黄、完了が緑（かめの希望、2026-11-16）
export const COLORS = { start: 0x1f6feb, waiting: 0xcf222e, working: 0xd29922, decided: 0x2ea043, done: 0x2ea043, release: 0x8957e5, failure: 0xcf222e }

/** カードを 1 枚だけ持つメッセージ。文字数は Discord の上限に収める */
function card({ title, url, description, color, fields = [], footer }) {
  const embed = { title: clip(title, 250), color }
  if (url) embed.url = url
  if (description) embed.description = clip(description, 3500)
  const kept = fields.filter((field) => field && field.value)
  if (kept.length > 0) embed.fields = kept.map((field) => ({ name: field.name, value: clip(String(field.value), 1000), inline: Boolean(field.inline) }))
  if (footer) embed.footer = { text: clip(footer, 200) }
  return { embeds: [embed] }
}

/** ログや試しの実行で見せるための、カードの文字だけの姿 */
export function messageText(message) {
  if (typeof message === 'string') return message
  return (message.embeds ?? [])
    .map((embed) => [embed.title, embed.url, embed.description, ...(embed.fields ?? []).map((field) => `${field.name}：${field.value}`), embed.footer?.text].filter(Boolean).join('\n'))
    .join('\n')
}

export function renderStart(ledger, { repoUrl, pr, members } = {}) {
  const goal = firstLine(ledger.sections?.['目的'])
  return card({
    title: `🟡 着手：${ledger.title}`,
    url: pr?.url ?? (ledger.issue && repoUrl ? `${repoUrl}/issues/${ledger.issue}` : undefined),
    description: goal && clip(goal, 300),
    color: COLORS.start,
    fields: [
      { name: '担当', value: who(ledger, members), inline: true },
      { name: 'Issue', value: ledger.issue && `#${ledger.issue}`, inline: true },
      { name: 'PR', value: pr && `#${pr.number}`, inline: true },
      ledger.scope.length > 0 && { name: '触る範囲', value: `\`${ledger.scope.slice(0, 5).join('`、`')}\`${ledger.scope.length > 5 ? ' …' : ''}` },
    ],
  })
}

export function renderDone(ledger, { pr, waiting = [], hasMedia = false, members } = {}) {
  const criteria = ledger.doneCriteria.slice(0, 3).map((item) => `・${clip(item.label.replace(/`/g, ''), 120)}`)
  return card({
    title: `✅ 完了：${ledger.title}`,
    url: pr?.url,
    description: criteria.join('\n'),
    color: COLORS.done,
    fields: [
      { name: '担当', value: who(ledger, members), inline: true },
      { name: 'PR', value: pr && `#${pr.number}`, inline: true },
      { name: 'Issue', value: ledger.issue && `#${ledger.issue}`, inline: true },
      hasMedia && { name: '📷 画面', value: 'スクリーンショットか動画があります（PR を開くと見られます）' },
      waiting.length > 0 && { name: `⏸ 人間待ちが ${waiting.length} 件残っています`, value: waiting.map((todo) => `・${todo.title}`).join('\n') },
    ],
  })
}

const section = (todo, name) => (todo.sections?.[name] ?? '').replace(/<!--[\s\S]*?-->/g, '').trim()

/**
 * 人間待ちを知らせる相手の Discord のユーザー ID（かめの希望、2026-11-18）。
 * 人間待ちのファイルの mention: に書いた人（Google の設定はたーとる、のように対応してほしい人を名指しする）。
 * 書いていないか、書いた人がだれも名簿で引けなければ、判断を頼んだ人（asker：作業宣言の owner か名簿の GitHub のアカウント名）。名簿に ID がない人は飛ばす
 */
export function mentionIds(todo, { asker, members = [] } = {}) {
  const named = String(todo.mention ?? '').split(/[,、\s]+/).map((name) => name.replace(/^@/, '')).filter(Boolean)
  const idsOf = (names) => [...new Set(names.map((name) => findMember(name, members)?.discord).filter((id) => /^\d{5,}$/.test(String(id ?? ''))).map(String))]
  const ids = idsOf(named)
  // 名指しした人がだれも名簿で引けない（打ち間違いなど）ときは、だれも鳴らさないより、頼んだ人に知らせる
  return ids.length > 0 ? ids : idsOf([asker])
}

/**
 * #人間待ち のカード。phase は board.mjs の humanPhase（waiting：人間待ち、working：決まって対応中、done：止めていた Issue が閉じて完了）。
 * 決まった判断で phase がなければ対応中として出す。assignee：対応する人（Discord のメンションか名前）。
 * mentions：人間待ちを知らせる人の Discord のユーザー ID。カードの上の本文でメンションし、その人だけに通知を鳴らす
 * （カードの中のメンションは鳴らないため）。決まったあとの書き換えでは鳴らさない
 */
export function renderHuman(todo, { url, phase, assignee, mentions = [] } = {}) {
  if (todo.status === 'done') {
    const finished = phase === 'done'
    // content は空で送る。書き換えでは送らなかった欄が前のまま残り、「<@ID> 人間待ちです」が決まったカードの上に残るため
    const decided = card({
      title: `${finished ? '✅ 完了' : '🔧 対応中'}：${todo.title}`,
      url,
      description: `**決めたこと**\n${todo.decision || '（記録を参照）'}`,
      color: finished ? COLORS.done : COLORS.working,
      fields: [
        { name: '決めた人', value: todo.decidedBy || '?', inline: true },
        { name: '日付', value: todo.decidedAt || '?', inline: true },
        !finished && assignee && { name: '対応する人', value: assignee, inline: true },
        { name: '理由', value: firstLine(section(todo, '判断の理由')) },
        { name: '止まっていたこと', value: todo.blocks || '（この Issue そのもの）' },
      ],
      footer: todo.path,
    })
    return { content: '', ...decided }
  }
  const waiting = card({
    title: `⏸ 人間待ち：${todo.title}`,
    url,
    description: `**必要なこと**\n${clip(firstLine(section(todo, '決めてほしいこと')) || todo.title, 600)}`,
    color: COLORS.waiting,
    fields: [
      { name: '止まっていること', value: todo.blocks || '（この Issue そのもの）', inline: true },
      { name: '種類', value: todo.kind, inline: true },
    ],
    footer: todo.path,
  })
  if (mentions.length === 0) return waiting
  return { content: `${mentions.map((id) => `<@${id}>`).join(' ')} 人間待ちです`, ...waiting, allowed_mentions: { parse: [], users: mentions } }
}

/** commit の題から PR の番号を拾う。merge の commit（Merge pull request #N）と、squash の commit（題の末尾の (#N)）の両方 */
export function prNumbersFromSubjects(subjects) {
  const numbers = subjects.map((line) => line.match(/^Merge pull request #(\d+)|\(#(\d+)\)$/)).filter(Boolean).map((match) => match[1] ?? match[2])
  return [...new Set(numbers)]
}

/** 人間待ちのリンク先。止めている Issue があればそれ、なければ todo/humans のファイル */
export function humanLink(todo, { repoUrl, targets = [] }) {
  return targets.length > 0 ? `${repoUrl}/issues/${targets[0]}` : `${repoUrl}/blob/main/${todo.path}`
}

/** workflow_run の結果から、#本番反映に流すカード。流さないなら undefined */
export function renderRun(run, { prs = [] } = {}) {
  const url = run.html_url
  if (run.name === 'Deploy') {
    if (run.conclusion === 'success') {
      const list = prs.slice(0, 15).map((pr) => `・#${pr.number} ${pr.title}`)
      return card({
        title: '🚀 本番に反映しました',
        url,
        description: list.length > 0 ? `${list.join('\n')}${prs.length > 15 ? `\nほか ${prs.length - 15} 件` : ''}` : '前の反映からの変更なし（出し直し）',
        color: COLORS.release,
        fields: [{ name: '反映した人', value: run.actor?.login ?? '?', inline: true }],
      })
    }
    if (run.conclusion === 'failure') return card({ title: '❌ 本番への反映に失敗しました', url, description: '本番は前の版のままです', color: COLORS.failure })
    return undefined
  }
  // main の CI とハーネスのワークフロー：失敗だけ流す（成功は流さない）
  if (run.conclusion !== 'failure' || run.head_branch !== 'main') return undefined
  const what = { CI: 'main のテストが落ちています', Harness: 'main のハーネスのチェックが落ちています', Kanban: 'カンバンの同期が失敗しました' }
  const hint = { CI: 'ほかの AI が取り込む前に直します', Kanban: '人間待ちのコメントやカンバンが止まっているかもしれません' }
  return card({
    title: `🔴 ${what[run.name] ?? `${run.name} が失敗しました`}`,
    url,
    description: [hint[run.name], firstLine(run.head_commit?.message) && `直前の commit：${firstLine(run.head_commit?.message)}`].filter(Boolean).join('\n'),
    color: COLORS.failure,
  })
}

// 文字列なら本文、オブジェクト（card）ならカードとして送る。メンションは飛ばさない。
// 例外は、メッセージが allowed_mentions.users に名指しした人だけ（#人間待ち の知らせる相手）。@everyone とロールは鳴らさない
const payload = (message) => {
  const body = typeof message === 'string' ? { content: message } : message
  const users = (body.allowed_mentions?.users ?? []).map(String).filter((id) => /^\d{5,}$/.test(id))
  return JSON.stringify({ ...body, allowed_mentions: users.length > 0 ? { parse: [], users } : { parse: [] } })
}

/**
 * Discord の Webhook に送る。メンションは飛ばさない（@everyone などを文面に含んでも通知しない。名指しした人だけは鳴らす）。
 * wait: true なら Discord が作ったメッセージの番号を返す（あとで editDiscord で書き換えるため）
 */
export async function postDiscord(url, message, { fetchImpl = fetch, wait = false } = {}) {
  const target = wait ? `${url}${url.includes('?') ? '&' : '?'}wait=true` : url
  const response = await fetchImpl(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload(message) })
  if (!response.ok) throw new Error(`Discord が ${response.status} を返しました`)
  if (!wait) return undefined
  const created = await response.json()
  return created?.id ? String(created.id) : undefined
}

/** 同じ Webhook で送ったメッセージを書き換える。書き換えでは Discord の通知は鳴らない */
export async function editDiscord(url, messageId, message, { fetchImpl = fetch } = {}) {
  const [base, query] = url.split('?')
  const target = `${base}/messages/${messageId}${query ? `?${query}` : ''}`
  const response = await fetchImpl(target, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: payload(message) })
  if (!response.ok) throw new Error(`Discord が ${response.status} を返しました`)
}

/** チャンネルの Webhook。secret が未登録なら undefined（送らずに飛ばす） */
export const webhookFor = (channel, env = process.env) => env[CHANNELS[channel].secret] || undefined
