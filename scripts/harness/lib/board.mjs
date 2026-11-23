// 作業の状態を、一次の記録（todo/humans/、作業宣言、Issue と PR）から決める。純関数だけを置く。
// カンバン（GitHub Projects の Status）はこの結果を映すだけの表示で、正本ではない。
// GitHub Actions（kanban-sync.mjs）とセッションの始め（session-context.mjs）が同じ関数を使い、答えをそろえる。
// 列は Todo / In Progress / 人間待ち / Done の 4 つ（かめの決定、2026-11-16。In Review は使わない）。
import { HUMAN_STATUS } from './humans.mjs'
import { parseBlockRefs, parseIssueRef } from './kanban.mjs'
import { githubLogin } from './members.mjs'

export const COLUMNS = { todo: 'Todo', inProgress: 'In Progress', waiting: '人間待ち', done: 'Done' }

const isOpenTodo = (todo) => todo.status !== HUMAN_STATUS.done

/** 人の判断が止めている Issue・PR の番号（blocks の #番号と、人の作業として起票した issue 欄） */
export function humanTargets(todo) {
  const own = parseIssueRef(todo.issue)
  return [...new Set([...parseBlockRefs(todo.blocks), ...(own ? [own] : [])])]
}

/** 番号 → それを止めている open な人の判断の一覧 */
export function blockedBy(todos) {
  const map = new Map()
  for (const todo of todos.filter(isOpenTodo)) {
    for (const number of humanTargets(todo)) map.set(number, [...(map.get(number) ?? []), todo])
  }
  return map
}

/**
 * 人の判断が決まって、作業に戻る Issue（番号 → 決まった判断）。blocks の #番号だけ（人の作業として起票した issue 欄は、決まったら閉じるので入れない）。
 * 決まった直後にすぐ In Progress へ移し、頼んだ人を担当にする。Todo に戻すと、ほかの人が拾いたくなるため（かめの希望、2026-11-16）。
 * todos は最近決まったものだけを渡す（古い判断の Issue をいつまでも In Progress に置かない）
 */
export function resumedBy(todos) {
  const open = blockedBy(todos)
  const map = new Map()
  for (const todo of todos.filter((item) => !isOpenTodo(item))) {
    for (const number of parseBlockRefs(todo.blocks)) if (!open.has(number) && !map.has(number)) map.set(number, todo)
  }
  return map
}

/** 判断を頼んだ作業のブランチ（asked_by の先頭。例：「feat/x（AI、だれかの端末）」→ feat/x） */
export const askedBranch = (todo) => String(todo.askedBy ?? '').trim().split(/[\s（(]/)[0]

/**
 * 判断を頼んだ人（作業宣言の owner）。作業が見つからなければ、asked_by の「（AI、<名前> の端末）」の名前と完全に一致する名簿の人。
 * 部分一致にしない（短い名前がブランチ名などに当たって、関係のない人を担当にしないため）
 */
export function askerOf(todo, entries = [], members = []) {
  const branch = askedBranch(todo)
  const entry = branch && entries.find((item) => item.branch === branch)
  if (entry?.owner) return entry.owner
  const name = String(todo.askedBy ?? '').match(/[（(][^）)]*?([^\s、,（(]+)\s*の端末/)?.[1]
  if (!name) return undefined
  const same = (value) => String(value ?? '').toLowerCase() === name.toLowerCase()
  return members.find((item) => same(item.github) || (item.names ?? []).some(same))?.github
}

/** done の人の判断が、人の作業として起票した Issue の番号（判断が済んだら閉じる候補） */
export const doneOwnIssues = (todos) => todos.filter((todo) => !isOpenTodo(todo) && parseIssueRef(todo.issue)).map((todo) => parseIssueRef(todo.issue))

/** PR の説明に書く、Issue との結び付け。人間待ちが残る Issue は merge で閉じないよう Refs にする */
export const closingKeyword = (issue, blocked) => (blocked.has(Number(issue)) ? 'Refs' : 'Closes')

// GitHub が Issue を閉じるキーワードすべて（close、closes、closed、fix、fixes、fixed、resolve、resolves、resolved）。
// 「Closes: #N」のコロンも拾う。「Closes owner/repo#N」は別のリポジトリを指すことがあるので書き換えない
// （書き換えると、merge のあとにこのリポジトリの #N を merge 済みとして数え、関係のない Issue を閉じうる）
export const CLOSING = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(:?\s+#(\d+))\b/gi

/** 「Closes #N」のうち、人間待ちが残る N を「Refs #N」に書き換えた本文。変えなければ undefined */
export function rewriteClosing(body, blocked) {
  const changed = []
  // 書き換えた先は、どの形から来ても「Refs #N」にそろえる（heldIssues が同じ形で数え直せるように）
  const next = String(body ?? '').replace(CLOSING, (whole, _keyword, _rest, number) => {
    if (!blocked.has(Number(number))) return whole
    changed.push(Number(number))
    return `Refs #${number}`
  })
  if (changed.length === 0) return undefined
  const list = changed.map((n) => `#${n}`).join('、')
  return `${next.trimEnd()}\n\n<!-- harness:refs -->${list} は人の判断・作業を待っているので、merge しても閉じないよう Refs にしました（todo/humans/）。\n`
}

/**
 * merge 済みの PR の本文から、ハーネスが人間待ちのために Refs にした Issue の番号を集める。
 * 人が「関連」の意味で手で書いた Refs は数えない（無関係な Issue を閉じないため）
 */
export function heldIssues(body) {
  const text = String(body ?? '')
  if (!text.includes('<!-- harness:refs -->')) return []
  return [...text.matchAll(/\bRefs\s+#(\d+)\b/g)].map((match) => Number(match[1]))
}

/**
 * Issue ごとの、あるべき列と、開け直し・閉じる操作を決める。
 * issues：[{ number, state: 'OPEN'|'CLOSED', isPr }]（開いている Issue と、人の判断が指す番号）
 * todos：todo/humans/ のすべて。active：進行中の作業が結び付いた Issue 番号。
 * merged：人間待ちのため Refs にして merge した PR が結び付いた Issue 番号（heldIssues）
 * items：カンバンの今の列（番号 → 列の名前）。読めないときは undefined（列の移動は計画しない）
 * closedOnce：ハーネスが一度閉じ、人が開け直した Issue の番号（CLOSED_MARKER）。もう閉じない
 */
export function planBoard({ issues, todos, active = new Set(), merged = new Set(), items, closedOnce = new Set(), resumed = new Map() }) {
  const blocked = blockedBy(todos)
  const doneOwn = new Map(todos.filter((todo) => !isOpenTodo(todo) && parseIssueRef(todo.issue)).map((todo) => [parseIssueRef(todo.issue), todo]))
  const moves = []
  const reopen = []
  const close = []
  const want = (number, column) => {
    if (items && items.get(number) !== column) moves.push({ number, column })
  }
  for (const issue of issues) {
    if (issue.isPr) continue
    const { number } = issue
    const open = issue.state === 'OPEN'
    if (blocked.has(number)) {
      if (!open) reopen.push({ number, todos: blocked.get(number) })
      want(number, COLUMNS.waiting)
    } else if (!open) {
      if (items?.has(number)) want(number, COLUMNS.done)
    } else if (doneOwn.has(number) && !closedOnce.has(number)) {
      close.push({ number, reason: 'human-done', todo: doneOwn.get(number) })
      want(number, COLUMNS.done)
    } else if (active.has(number)) {
      want(number, COLUMNS.inProgress)
    } else if (merged.has(number) && !closedOnce.has(number)) {
      // 人間待ちのあいだ Refs で開けておいた Issue。人の判断が済み、残りの作業もない
      close.push({ number, reason: 'merged' })
      want(number, COLUMNS.done)
    } else if (resumed.has(number)) {
      // 人の判断が決まり、頼んだ作業に戻る。進行中の作業が見えなくても Todo にしない
      want(number, COLUMNS.inProgress)
    } else {
      want(number, COLUMNS.todo)
    }
  }
  return { moves, reopen, close }
}

// ---- 担当（assignee） -------------------------------------------------------------

/**
 * 進行中の作業が結び付いた Issue に、作業する人を担当として足す（かめとの合意、2026-11-16。割り振りはせず、着手した人が担当）。
 * entries：collectWork の進行中の作業。issues：[{ number, assignees: [login] }]（開いている Issue）。
 * assignable：担当にできるアカウント（リポジトリの collaborator）。読めないときは undefined（絞らない）。
 * 足すだけで外さない。人が手で付けた担当と、同じ Issue を手伝う別の人を消さないため
 */
export function planAssignees({ entries, issues, members = [], assignable }) {
  const open = new Map(issues.map((issue) => [issue.number, new Set((issue.assignees ?? []).map((login) => login.toLowerCase()))]))
  const add = []
  const seen = new Set()
  for (const entry of entries) {
    if (!entry.active || !entry.issue) continue
    const number = Number(entry.issue)
    const login = githubLogin(entry.owner, members) ?? entry.pr?.author?.login
    if (!login || !open.has(number) || open.get(number).has(login.toLowerCase())) continue
    if (assignable && !assignable.has(login.toLowerCase())) continue
    const key = `${number} ${login.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    add.push({ number, login, branch: entry.branch })
  }
  return add
}

// ---- 人間待ちのコメント ----------------------------------------------------------

export const commentMarker = (id) => `<!-- harness:human-wait ${id} -->`

/** 人間待ちのため開け直した Issue に付ける印。人の判断が済んだら、Refs で開けておいた Issue と同じく閉じる */
export const HELD_MARKER = '<!-- harness:held -->'
export const hasHeldMarker = (comments = []) => comments.some((comment) => String(comment.body ?? '').includes(HELD_MARKER))

/** ハーネスが「人間待ちが済んだ」として閉じたときの印。閉じるのは 1 回きりで、人が開け直したらもう閉じない */
export const CLOSED_MARKER = '<!-- harness:closed -->'
export const hasClosedMarker = (comments = []) => comments.some((comment) => String(comment.body ?? '').includes(CLOSED_MARKER))

/**
 * ハーネスが閉じたあと、人が開け直した Issue か。コメントは古い順に並んでいる。
 * 最後の「閉じた印」より後に「ハーネスが開け直した印」があれば、開け直したのはハーネス（新しい人間待ち）なので、また閉じてよい
 */
export function reopenedByHuman(comments = []) {
  const last = (marker) => comments.findLastIndex((comment) => String(comment.body ?? '').includes(marker))
  const closed = last(CLOSED_MARKER)
  return closed >= 0 && last(HELD_MARKER) < closed
}

/** カンバンの列を動かすのに使う今の列。merge 済みの一覧が取れなかった実行では、merge 済みの作業が進行中に見えるので動かさない */
export const boardItems = (items, mergedKnown) => (mergedKnown ? items : undefined)

/**
 * 最近閉じた Issue（番号の一覧）を、閉じた Issue として同期の対象に足す。すでに対象にある番号は足さない。
 * 閉じると Projects の組み込みの動きで Done に移るが、その直前に始まった同期が「開いていて作業中」と読んで
 * In Progress に戻すことがある（2026-11-18、#424 と #444）。閉じた Issue も毎回見て、次の実行で Done にそろえる
 */
export function withRecentlyClosed(issues, closedNumbers = []) {
  const seen = new Set(issues.map((issue) => issue.number))
  const added = closedNumbers.filter((number) => !seen.has(number)).map((number) => ({ number, state: 'CLOSED', isPr: false }))
  return [...issues, ...[...new Map(added.map((issue) => [issue.number, issue])).values()]]
}

const section = (todo, name) => (todo.sections?.[name] ?? '').replace(/<!--[\s\S]*?-->/g, '').trim()
const clip = (text, max = 1200) => (text.length > max ? `${text.slice(0, max)}…` : text)
const idOf = (todo) => todo.id || todo.path.replace(/^.*\//, '').replace(/\.md$/, '')

/** Discord の #人間待ち に送ったメッセージの番号を、Issue のコメントに覚えさせる印 */
// phase は、Discord のカードを今どの状態にしてあるか（waiting：人間待ち、working：対応中、done：完了）
export const discordMarker = (id, phase) => `<!-- harness:discord ${id}${phase ? ` ${phase}` : ''} -->`
export const discordIdFrom = (body) => String(body ?? '').match(/<!-- harness:discord (\d+)(?: \w+)? -->/)?.[1]
export const discordPhaseFrom = (body) => String(body ?? '').match(/<!-- harness:discord \d+ (\w+) -->/)?.[1]

export const HUMAN_PHASES = { waiting: 'waiting', working: 'working', done: 'done' }

/**
 * 人の判断の、Discord のカードの状態。決まっていなければ人間待ち。決まって、止めていた Issue・PR がまだ開いていれば対応中、
 * すべて閉じていれば完了。states：番号 → 'OPEN'|'CLOSED'（読めない番号は数えない）
 */
export function humanPhase(todo, states = new Map()) {
  if (isOpenTodo(todo)) return HUMAN_PHASES.waiting
  const known = humanTargets(todo).filter((number) => states.has(number))
  return known.length > 0 && known.every((number) => states.get(number) === 'CLOSED') ? HUMAN_PHASES.done : HUMAN_PHASES.working
}

/** 人の判断について、前に Discord に送ったメッセージの番号（止めている Issue のどれかのコメントにある） */
export function discordIdOf(todo, existing) {
  const marker = commentMarker(idOf(todo))
  for (const number of humanTargets(todo)) {
    const found = (existing.get(number) ?? []).find((comment) => String(comment.body ?? '').startsWith(marker))
    const id = found && discordIdFrom(found.body)
    if (id) return id
  }
  return undefined
}

/** Issue・PR に出す、人間待ちのコメント。決まったら同じコメントを「決まりました」に書き換える */
export function renderHumanComment(todo, fileUrl, { discordId, phase } = {}) {
  return [renderHumanCommentBody(todo, fileUrl), ...(discordId ? [discordMarker(discordId, phase)] : [])].join('\n')
}

function renderHumanCommentBody(todo, fileUrl) {
  const link = `詳しく：[${todo.path}](${fileUrl})`
  if (!isOpenTodo(todo)) {
    const reason = section(todo, '判断の理由')
    return [
      commentMarker(idOf(todo)),
      `## ✅ 決まりました：${todo.title}`,
      '',
      `**決めたこと**：${todo.decision || '（todo/humans を参照）'}（${[todo.decidedBy, todo.decidedAt].filter(Boolean).join('、')}）`,
      ...(reason ? ['', `**理由**：${clip(reason, 600)}`] : []),
      '',
      link,
    ].join('\n')
  }
  const need = section(todo, '決めてほしいこと') || todo.title
  const waiting = section(todo, '背景')
  return [
    commentMarker(idOf(todo)),
    `## ⏸ 人間待ち：${todo.title}`,
    '',
    `**必要なこと**（${todo.kind}）`,
    clip(need),
    '',
    '**止まっていること**',
    todo.blocks || '（この Issue そのもの）',
    ...(waiting ? ['', `<details><summary>背景</summary>\n\n${clip(waiting)}\n</details>`] : []),
    '',
    '**終わったら**',
    `決めた内容と決めた人を AI に伝えるか、\`npm run human -- done ${idOf(todo)} --decision "…" --by <名前>\` で記録します。記録すると、このコメントが「決まりました」に変わり、カンバンも動きます。`,
    '',
    link,
  ].join('\n')
}

/**
 * コメントの作成と書き換えを決める。existing：番号 → [{ id, body }]（その番号の既存のコメント）。
 * 決まった判断は、もう出したコメントを書き換えるだけで、新しくは出さない（古い判断で通知を増やさない）。
 * states：番号 → 'OPEN'|'CLOSED'。Discord のカードの状態（humanPhase）を決めるのに使い、コメントの印に覚えさせる。
 * update の discordChange：Discord のカードを今の状態に書き換えるとき（印に覚えた状態と違う）。初めて決まったときは decided も付く
 */
export function planHumanComments({ todos, existing, fileUrl, skip = new Set(), discordIds = new Map(), states = new Map() }) {
  const create = []
  const update = []
  for (const todo of todos) {
    // Discord の番号は、今回送ったもの（discordIds）か、前のコメントに覚えさせたもの
    const discordId = discordIds.get(todo.path) ?? discordIdOf(todo, existing)
    const phase = humanPhase(todo, states)
    const body = renderHumanComment(todo, fileUrl(todo.path), { discordId, phase })
    const marker = commentMarker(idOf(todo))
    for (const number of humanTargets(todo).filter((n) => !skip.has(n))) {
      const found = (existing.get(number) ?? []).find((comment) => String(comment.body ?? '').startsWith(marker))
      if (found) {
        // decided：人間待ちのコメントを「決まりました」に書き換えるとき
        const decided = !isOpenTodo(todo) && !found.body.includes('## ✅')
        // 印に状態がない古いコメントは、✅ なら「決まりました」（今の対応中か完了へ一度だけ書き換える）、なければ人間待ち
        const shown = discordPhaseFrom(found.body) ?? (found.body.includes('## ✅') ? 'decided' : HUMAN_PHASES.waiting)
        const discordChange = phase !== HUMAN_PHASES.waiting && phase !== shown && (Boolean(discordId) || decided)
        if (found.body.trim() !== body.trim()) update.push({ number, id: found.id, body, todo, decided, discordChange, discordId, phase })
      } else if (isOpenTodo(todo)) {
        create.push({ number, body, todo })
      }
    }
  }
  return { create, update }
}
