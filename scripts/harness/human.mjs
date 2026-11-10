#!/usr/bin/env node
// 人にしかできない判断（todo/humans/）。書き方は todo/humans/README.md。
//   npm run human -- add <英小文字の短い名前> --title "…" --kind 費用|有料API|方針|秘密情報|権限|その他 [--blocks "#<Issue 番号> …"]
//   npm run human -- list [--all]
//   npm run human -- done <ファイル名か id> --decision "…" --by <決めた人> [--reason "…"]
//   npm run human -- sync [<ファイル名か id>]   open なものをカンバン（GitHub Projects の「人間待ち」）に載せ直す
//   npm run human -- publish [<ファイル名か id> …]   todo/humans/ の変更を、今のブランチのまま main へ直接入れる
// done にするのは、人が決めたときだけ。会話で人が AI とすり合わせて決めたら、それで決定として AI が記録してよい
// （--by は決めた人。todo/humans/2026-11-08-decide-in-chat.md）。人が決めていないことを AI が決めて done にはしない。
// done は記録したあと、そのまま main まで入れる（lib/publish-humans.mjs）。人が git の命令を打つ必要はない。--no-publish で入れない。
// add・done・sync はカンバンも動かす（lib/kanban.mjs）。動かせなくても todo/humans の読み書きは済ませる。--no-kanban で動かさない。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setFrontMatterValue } from './lib/frontmatter.mjs'
import { createKanban, linkHumanTodo, releaseHumanTodo, SCOPE_HINT } from './lib/kanban.mjs'
import { currentBranch, gh, gitOut, repoRoot } from './lib/proc.mjs'
import { HUMAN_KINDS, HUMAN_STATUS, HUMANS_DIR, markHumanDone, parseHumanTodo, renderHumanTemplate, validateHumanTodo } from './lib/humans.mjs'
import { changedHumansRecords, publishHumans } from './lib/publish-humans.mjs'

const root = repoRoot(process.cwd()) ?? process.cwd()
const dir = join(root, HUMANS_DIR)
const [command, ...rest] = process.argv.slice(2)
const option = (name) => {
  const index = rest.indexOf(`--${name}`)
  return index >= 0 ? rest[index + 1] : undefined
}
const today = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)

function die(message) {
  console.error(`[human] ${message}`)
  process.exit(1)
}

// カンバンを動かせないときも、todo/humans の書き込みは終わっている。警告とやり直しの方法だけ出す
function kanban() {
  if (rest.includes('--no-kanban') || process.env.HARNESS_OFFLINE === '1') return undefined
  return createKanban({ gh: (args) => gh(args, { cwd: root }) })
}

function report({ notes = [], warnings = [] }) {
  for (const note of notes) console.log(`カンバン：${note}`)
  for (const warning of warnings) console.log(`注意（カンバン）：${warning}`)
  if (warnings.length > 0) {
    console.log(`  todo/humans の記録は済んでいます。直したら \`npm run human -- sync\` でカンバンに載せ直します${warnings.some((w) => w.includes(SCOPE_HINT)) ? '' : `（project の権限がなければ \`${SCOPE_HINT}\`）`}`)
  }
}

/** open な人の判断をカンバンに載せ、起票した Issue の番号を issue 欄に書き戻す */
function link(name, board) {
  const path = join(dir, name)
  const todo = parseHumanTodo(readFileSync(path, 'utf8'), `${HUMANS_DIR}/${name}`)
  const result = linkHumanTodo({ todo, kanban: board })
  if (result.issue) writeFileSync(path, setFrontMatterValue(readFileSync(path, 'utf8'), 'issue', result.issue))
  report(result)
  return result
}

function files() {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md' && name !== '_template.md')
}

function add() {
  const slug = rest.find((arg) => !arg.startsWith('--') && !Object.values({ t: option('title'), k: option('kind'), b: option('blocks') }).includes(arg))
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) die('短い名前を英小文字とハイフンで付けます（例：npm run human -- add vertex-gemini --title "…" --kind 有料API）')
  const title = option('title') ?? die('--title が要ります')
  const kind = option('kind') ?? die(`--kind が要ります（${HUMAN_KINDS.join('、')}）`)
  if (!HUMAN_KINDS.includes(kind)) die(`kind は ${HUMAN_KINDS.join('、')} のどれかです`)
  const id = `${today()}-${slug}`
  const path = join(dir, `${id}.md`)
  if (existsSync(path)) die(`${HUMANS_DIR}/${id}.md はもうあります`)
  mkdirSync(dir, { recursive: true })
  const who = gitOut(['config', 'user.name'], { cwd: root }) ?? ''
  const askedBy = `${currentBranch(root) || '-'}（${process.env.HARNESS_AGENT ?? 'AI'}、${who} の端末）`
  writeFileSync(path, renderHumanTemplate({ id, title, kind, askedBy, created: today(), blocks: option('blocks') ?? '' }))
  console.log(`${HUMANS_DIR}/${id}.md を作りました。「決めてほしいこと」「背景」「選択肢」を書き、\`npm run human -- publish ${id}\` で main に入れます（今のブランチのままでよい）。`)
  const board = kanban()
  if (board) link(`${id}.md`, board)
  console.log('判断を待つあいだは、仮の形で進められる作業か、ほかの作業を先にします。')
}

function list() {
  const todos = files().map((name) => parseHumanTodo(readFileSync(join(dir, name), 'utf8'), `${HUMANS_DIR}/${name}`))
  const shown = rest.includes('--all') ? todos : todos.filter((todo) => todo.status !== HUMAN_STATUS.done)
  if (shown.length === 0) console.log('人の判断待ちはありません')
  for (const todo of shown) {
    const decided = todo.status === HUMAN_STATUS.done ? ` → ${todo.decision}（${todo.decidedBy}、${todo.decidedAt}）` : ''
    console.log(`- [${todo.status}] ${todo.title}（${todo.kind}）${todo.path}${decided}`)
    const { errors } = validateHumanTodo(todo)
    for (const error of errors) console.log(`    注意：${error}`)
  }
}

function done() {
  const key = rest.find((arg) => !arg.startsWith('--') && ![option('decision'), option('by'), option('reason')].includes(arg))
  const name = files().find((file) => file === key || file === `${key}.md` || file.includes(key ?? '\u0000'))
  if (!name) die(`${key} が ${HUMANS_DIR}/ に見つかりません`)
  const decision = option('decision') ?? die('--decision（決めた内容）が要ります')
  const by = option('by') ?? die('--by（決めた人）が要ります。AI が代わりに決めて done にはしません')
  const path = join(dir, name)
  const updated = markHumanDone(readFileSync(path, 'utf8'), { decision, decidedBy: by, decidedAt: today(), reason: option('reason') })
  writeFileSync(path, updated)
  const { warnings } = validateHumanTodo(parseHumanTodo(updated, `${HUMANS_DIR}/${name}`))
  console.log(`${HUMANS_DIR}/${name} を done にしました。`)
  for (const warning of warnings) console.log(`注意：${warning}`)
  const board = kanban()
  if (board) {
    const openTodos = files()
      .map((file) => parseHumanTodo(readFileSync(join(dir, file), 'utf8'), `${HUMANS_DIR}/${file}`))
      .filter((todo) => todo.status !== HUMAN_STATUS.done)
    report(releaseHumanTodo({ todo: parseHumanTodo(updated, `${HUMANS_DIR}/${name}`), openTodos, kanban: board }))
  }
  if (!rest.includes('--no-publish')) publishOrExplain([`${HUMANS_DIR}/${name}`], `docs: 人の判断を記録する（${name.replace(/\.md$/, '')}）`)
  console.log('技術の選定なら docs/architecture/decisions.md、企画の判断なら docs/product/proposal.md にも反映します。')
}

/** main に入れる。入れられなければ理由と、やり直しの命令を出す（記録そのものは済んでいる） */
function publishOrExplain(paths, message) {
  if (process.env.HARNESS_OFFLINE === '1') {
    console.log('HARNESS_OFFLINE=1 なので main には入れません。あとで `npm run human -- publish` を実行します')
    return
  }
  const result = publishHumans({ root, files: paths, message })
  if (result.ok) {
    console.log(result.message)
    return
  }
  console.log(`main に入れられませんでした：${result.message}`)
  console.log('  記録はこの作業ツリーにあります。直したら `npm run human -- publish` でやり直します')
  process.exitCode = 1
}

// todo/humans/ の変更（新しい項目、書き足し、issue 欄）を、今のブランチのまま main へ入れる
function publish() {
  const keys = rest.filter((arg) => !arg.startsWith('--'))
  const changed = changedHumansRecords(root)
  const paths = keys.length === 0
    ? changed
    : keys.map((key) => {
        const name = files().find((file) => file === key || file === `${key}.md` || file.includes(key))
        return name ? `${HUMANS_DIR}/${name}` : die(`${key} が ${HUMANS_DIR}/ に見つかりません`)
      })
  if (paths.length === 0) {
    console.log(`${HUMANS_DIR}/ に main へ入れる変更はありません`)
    return
  }
  // 1 行目は commit-msg の上限（120 文字）に収まるよう、名前を 1 つだけか件数にする。名前の一覧は本文に入る
  const subject = paths.length === 1 ? paths[0].replace(`${HUMANS_DIR}/`, '').replace(/\.md$/, '') : `${paths.length} 件`
  publishOrExplain(paths, `docs: 人の判断の記録を更新する（${subject}）`)
}

// open なものを、あとからまとめてカンバンに載せる（権限がなかったときのやり直し、仕組みを入れる前の分）
function sync() {
  const key = rest.find((arg) => !arg.startsWith('--'))
  const board = kanban() ?? die('--no-kanban か HARNESS_OFFLINE=1 のときは、カンバンに載せられません')
  const targets = files().filter((file) => !key || file === key || file === `${key}.md` || file.includes(key))
  let count = 0
  for (const name of targets) {
    const todo = parseHumanTodo(readFileSync(join(dir, name), 'utf8'), `${HUMANS_DIR}/${name}`)
    if (todo.status === HUMAN_STATUS.done) continue
    console.log(`- ${todo.title}（${todo.path}）`)
    link(name, board)
    count++
  }
  console.log(count === 0 ? '載せる open な人の判断はありません' : `${count} 件を確かめました。issue 欄が増えたファイルは \`npm run human -- publish\` で main に入れます。`)
}

const commands = { add, list, done, sync, publish }
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(command ? 1 : 0)
}
commands[command]()
