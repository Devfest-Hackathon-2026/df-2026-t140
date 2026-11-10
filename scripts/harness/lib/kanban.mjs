// GitHub Projects のカンバン（Project #1「Konbu_DevFest」）と、人の判断（todo/humans/）をつなぐ。
// 人の判断を書いたら、止まっている Issue を Status「人間待ち」に動かし、決まったら「In Progress」に戻す。
// カンバンは補助で、正本は todo/humans/。gh がない・オフライン・project スコープがないときは警告だけ出し、
// 呼び出し側の todo/humans の読み書きは止めない。
// gh は注入する（テストでは本物を叩かない）。列やフィールドの id は直書きせず、名前で引く。

export const KANBAN = {
  owner: 'Lazyturtle0852',
  number: 1,
  statusField: 'Status',
  columns: { waiting: '人間待ち', inProgress: 'In Progress', done: 'Done' },
  label: { name: '人間待ち', color: 'd93f0b', description: '人の判断・作業を待っている（todo/humans/）' },
}

export const SCOPE_HINT = 'gh auth refresh -h github.com -s project'

// ---- 純関数 ------------------------------------------------------------------------

/** blocks 欄（自由な文）から「#123」の形の Issue・PR 番号を取り出す（重なりは 1 つに） */
export function parseBlockRefs(blocks) {
  const numbers = []
  for (const match of String(blocks ?? '').matchAll(/(?<![\w/&])#(\d+)\b/g)) {
    const number = Number(match[1])
    if (number > 0 && !numbers.includes(number)) numbers.push(number)
  }
  return numbers
}

/** issue 欄の値（「12」「#12」）を番号にする。なければ undefined */
export function parseIssueRef(value) {
  const match = String(value ?? '').trim().match(/^#?(\d+)$/)
  return match ? Number(match[1]) : undefined
}

/** `gh project field-list --format json` の結果から、Status の選択肢の id を名前で引く */
export function findStatusOption(fieldList, optionName, fieldName = KANBAN.statusField) {
  const fields = Array.isArray(fieldList) ? fieldList : (fieldList?.fields ?? [])
  const field = fields.find((item) => item?.name === fieldName && Array.isArray(item.options))
  if (!field) return { ok: false, reason: `Project に「${fieldName}」の選択肢のフィールドがありません` }
  const option = field.options.find((item) => item?.name === optionName)
  if (!option) {
    const names = field.options.map((item) => item.name).join('、')
    return { ok: false, reason: `「${fieldName}」に「${optionName}」の列がありません（今あるのは ${names}）` }
  }
  return { ok: true, fieldId: field.id, optionId: option.id }
}

/** gh の失敗を、案内の出し分けのために分類する */
export function classifyGhFailure(result = {}) {
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
  if (result.missing) return { kind: 'missing', message: 'gh がないので、カンバンは動かしていません' }
  if (result.timedOut || /could not resolve|dial tcp|network is unreachable|connection (refused|reset)|timed? ?out|no such host|ENOTFOUND|EAI_AGAIN/i.test(text)) {
    return { kind: 'offline', message: 'GitHub につながらないので、カンバンは動かしていません（オフライン？）' }
  }
  if (/scope/i.test(text) && /project/i.test(text)) {
    return { kind: 'scope', message: `gh に project の権限がないので、カンバンは動かしていません。1 回だけ \`${SCOPE_HINT}\` を実行してください` }
  }
  if (/gh auth login|not logged in|authentication|HTTP 401/i.test(text)) {
    return { kind: 'auth', message: 'gh にログインしていないので、カンバンは動かしていません（`gh auth login`）' }
  }
  const first = text.trim().split('\n').find(Boolean) ?? '理由不明'
  return { kind: 'other', message: `gh が失敗しました：${first.slice(0, 200)}` }
}

/** `gh project item-list --format json` の結果を、扱いやすい形にする */
export function parseProjectItems(json) {
  const items = Array.isArray(json) ? json : (json?.items ?? [])
  return items.map((item) => ({
    id: item.id ?? '',
    number: item.content?.number,
    type: item.content?.type ?? '',
    url: item.content?.url ?? '',
    title: item.title ?? item.content?.title ?? '',
    status: item.status ?? '',
  }))
}

export const itemsInColumn = (items, column) => items.filter((item) => item.status === column)

/** ref（Issue 番号）を、except 以外の open な人の判断がまだ止めているか */
export function stillBlocked(ref, openTodos, exceptPath) {
  return openTodos.some((todo) => todo.path !== exceptPath && parseBlockRefs(todo.blocks).includes(ref))
}

export function humanIssueTitle(title) {
  return `人間待ち：${title}`
}

export function renderHumanIssueBody({ title, kind, path, fileUrl }) {
  return `人にしかできない判断・作業です（kind：${kind}）。AI は決めず、実行もしません。

- 決めてほしいことと背景：[${path}](${fileUrl})
- 決めたら：\`npm run human -- done ${path.replace(/^.*\//, '').replace(/\.md$/, '')} --decision "…" --by <決めた人> --reason "…"\`（この Issue は閉じ、カンバンも動きます）

# ${title}

---
ハーネスが \`npm run human\` から起票しました（todo/humans/README.md）。`
}

// ---- gh を使う部分 -----------------------------------------------------------------

/**
 * カンバンを操作するもの。gh は (args) => { ok, stdout, stderr, missing, timedOut } を返す関数。
 * 一度つながらない・権限がないと分かったら、以降の呼び出しはせずに同じ警告を返す（待ち時間を重ねない）。
 */
export function createKanban({ gh, config = KANBAN }) {
  let broken
  const cache = {}
  const columnNames = Object.values(config.columns)

  function call(args) {
    if (broken) return { ok: false, warning: broken.message, kind: broken.kind }
    const result = gh(args)
    if (result.ok) return { ok: true, stdout: result.stdout ?? '' }
    const failure = classifyGhFailure(result)
    if (failure.kind !== 'other') broken = failure
    return { ok: false, warning: failure.message, kind: failure.kind }
  }

  function json(args) {
    const result = call(args)
    if (!result.ok) return result
    try {
      return { ok: true, value: JSON.parse(result.stdout || 'null') }
    } catch {
      return { ok: false, warning: `gh の出力を読めませんでした（${args.slice(0, 3).join(' ')}）` }
    }
  }

  const projectArgs = [String(config.number), '--owner', config.owner, '--format', 'json']

  function project() {
    if (cache.project) return cache.project
    const view = json(['project', 'view', ...projectArgs])
    if (!view.ok) return view
    const fields = json(['project', 'field-list', ...projectArgs])
    if (!fields.ok) return fields
    cache.project = { ok: true, id: view.value?.id, fields: fields.value }
    return cache.project
  }

  function repo() {
    if (cache.repo) return cache.repo
    const result = json(['repo', 'view', '--json', 'nameWithOwner,url'])
    if (!result.ok) return result
    cache.repo = { ok: true, name: result.value?.nameWithOwner, url: result.value?.url }
    return cache.repo
  }

  /** Issue（PR でも）を Project に入れ（入っていれば何もしない）、Status を column にする */
  function moveToColumn(number, column) {
    if (!columnNames.includes(column)) return { ok: false, warning: `カンバンの列「${column}」は使いません` }
    const meta = project()
    if (!meta.ok) return meta
    const option = findStatusOption(meta.fields, column, config.statusField)
    if (!option.ok) return { ok: false, warning: option.reason }
    const target = repo()
    if (!target.ok) return target
    const url = call(['api', `repos/${target.name}/issues/${number}`, '--jq', '.html_url'])
    if (!url.ok) return { ok: false, warning: `#${number} が見つかりません（${url.warning}）` }
    const item = json(['project', 'item-add', String(config.number), '--owner', config.owner, '--url', url.stdout.trim(), '--format', 'json'])
    if (!item.ok) return item
    const edited = call([
      'project', 'item-edit',
      '--id', item.value?.id,
      '--project-id', meta.id,
      '--field-id', option.fieldId,
      '--single-select-option-id', option.optionId,
    ])
    if (!edited.ok) return edited
    return { ok: true, number, column }
  }

  /** 人の作業そのものを Issue として起票する。番号を返す */
  function createHumanIssue({ title, kind, path }) {
    const target = repo()
    if (!target.ok) return target
    const label = config.label
    call(['label', 'create', label.name, '--color', label.color, '--description', label.description, '--force'])
    const fileUrl = `${target.url}/blob/main/${path}`
    const created = call(['issue', 'create', '--title', humanIssueTitle(title), '--body', renderHumanIssueBody({ title, kind, path, fileUrl }), '--label', label.name])
    if (!created.ok) return created
    const number = Number(created.stdout.trim().match(/\/issues\/(\d+)/)?.[1])
    if (!number) return { ok: false, warning: `起票した Issue の番号を読めませんでした（${created.stdout.trim()}）` }
    return { ok: true, number, url: created.stdout.trim() }
  }

  function closeIssue(number, comment) {
    const result = call(['issue', 'close', String(number), '--comment', comment])
    return result.ok ? { ok: true, number } : result
  }

  /** column の列にある項目。読めなければ ok: false と warning */
  function listColumn(column) {
    const result = json(['project', 'item-list', ...projectArgs, '--limit', '300'])
    if (!result.ok) return { ...result, items: [] }
    return { ok: true, items: itemsInColumn(parseProjectItems(result.value), column) }
  }

  return { moveToColumn, createHumanIssue, closeIssue, listColumn, config }
}

// ---- 人の判断とカンバンをつなぐ手順 -----------------------------------------------

/**
 * open な人の判断をカンバンに載せる。blocks に「#N」があればその Issue を「人間待ち」に、
 * なければ人の作業を Issue として起票して「人間待ち」に置く（issue 欄がもうあれば起票しない）。
 * 戻り値の issue は、新しく起票したときだけ入る（呼び出し側が issue 欄に書き戻す）。
 */
export function linkHumanTodo({ todo, kanban }) {
  const { waiting } = kanban.config.columns
  const notes = []
  const warnings = []
  const refs = parseBlockRefs(todo.blocks)
  let issue
  const own = parseIssueRef(todo.issue)
  const targets = refs.length > 0 ? refs : own ? [own] : []
  if (refs.length === 0 && !own) {
    const created = kanban.createHumanIssue({ title: todo.title, kind: todo.kind, path: todo.path })
    if (created.ok) {
      issue = created.number
      targets.push(created.number)
      notes.push(`人の作業を Issue #${created.number} として起票しました：${created.url}`)
    } else {
      warnings.push(created.warning)
    }
  }
  for (const number of targets) {
    const moved = kanban.moveToColumn(number, waiting)
    if (moved.ok) notes.push(`#${number} をカンバンの「${waiting}」に置きました`)
    else warnings.push(moved.warning)
  }
  return { issue, notes, warnings: unique(warnings) }
}

/**
 * done にした人の判断を、カンバンから外す。待っていた Issue は「In Progress」に戻す
 * （ほかの open な人の判断がまだ止めているなら戻さない）。人の作業の Issue は Done にして閉じる。
 */
export function releaseHumanTodo({ todo, openTodos = [], kanban }) {
  const { inProgress, done } = kanban.config.columns
  const notes = []
  const warnings = []
  for (const number of parseBlockRefs(todo.blocks)) {
    if (stillBlocked(number, openTodos, todo.path)) {
      notes.push(`#${number} は、ほかの人の判断もまだ待っているので「${kanban.config.columns.waiting}」のままにします`)
      continue
    }
    const moved = kanban.moveToColumn(number, inProgress)
    if (moved.ok) notes.push(`#${number} をカンバンの「${inProgress}」に戻しました`)
    else warnings.push(moved.warning)
  }
  const own = parseIssueRef(todo.issue)
  if (own) {
    const moved = kanban.moveToColumn(own, done)
    if (!moved.ok) warnings.push(moved.warning)
    const decided = [todo.decision, todo.decidedBy && `（${todo.decidedBy}、${todo.decidedAt}）`].filter(Boolean).join('')
    const closed = kanban.closeIssue(own, `決まりました：${decided || 'todo/humans を参照'}\n\n${todo.path}`)
    if (closed.ok) notes.push(`人の作業の Issue #${own} を閉じました`)
    else warnings.push(closed.warning)
  }
  return { notes, warnings: unique(warnings) }
}

const unique = (list) => [...new Set(list.filter(Boolean))]
