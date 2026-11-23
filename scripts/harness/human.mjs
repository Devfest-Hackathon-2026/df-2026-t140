#!/usr/bin/env node
// 人にしかできない判断（todo/humans/）。書き方は todo/humans/README.md。
//   npm run human -- add <英小文字の短い名前> --title "…" --kind 費用|有料API|方針|秘密情報|権限|その他 [--blocks "#<Issue 番号> …"] [--mention <知らせる人>] [--not-prod-check]
//   npm run human -- prod-check --title "<確かめること>" [--from "#<Issue>、PR #<番号>"]   本番での確認は、open なまとめの 1 件に足す（add では作らない）
//   npm run human -- list [--all]
//   npm run human -- done <ファイル名か id> --decision "…" --by <決めた人> [--reason "…"]
//   npm run human -- sync   GitHub Actions のカンバンの同期をすぐ動かす（ふだんは main に入れれば数分で動く）
//   npm run human -- publish [<ファイル名か id> …]   todo/humans/ の変更を、今のブランチのまま main へ直接入れる
// done にするのは、人が決めたときだけ。会話で人が AI とすり合わせて決めたら、それで決定として AI が記録してよい
// （--by は決めた人。todo/humans/2026-11-08-decide-in-chat.md）。人が決めていないことを AI が決めて done にはしない。
// done は記録したあと、そのまま main まで入れる（lib/publish-humans.mjs）。人が git の命令を打つ必要はない。--no-publish で入れない。
// カンバンの列、Issue への人間待ちのコメント、Issue の開け閉めは、main に入ったあと GitHub Actions が行う（kanban-sync.mjs）。
// 手元では、blocks に #番号がないとき、人の作業そのものを Issue として起票するだけ。--no-kanban で起票しない。
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setFrontMatterValue } from './lib/frontmatter.mjs'
import { createKanban, parseBlockRefs, parseIssueRef } from './lib/kanban.mjs'
import { currentBranch, gh, git, gitOut, repoRoot, TIMEOUT_MS } from './lib/proc.mjs'
import {
  appendProdCheck,
  HUMAN_KINDS,
  HUMAN_STATUS,
  HUMANS_DIR,
  isProdCheckBundle,
  looksLikeProdCheck,
  markHumanDone,
  parseHumanTodo,
  PROD_CHECK_EXCEPTION,
  PROD_CHECK_EXCEPTION_PLACEHOLDER,
  PROD_CHECK_SLUG,
  renderHumanTemplate,
  renderProdCheckBundle,
  validateHumanTodo,
} from './lib/humans.mjs'
import { changedHumansRecords, humansOnMain, mergeWithMain, publishHumans, rememberBase } from './lib/publish-humans.mjs'
import { findMember, loadMembers } from './lib/members.mjs'

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

function github() {
  if (rest.includes('--no-kanban') || process.env.HARNESS_OFFLINE === '1') return undefined
  return createKanban({ gh: (args) => gh(args, { cwd: root }) })
}

/** 止めている Issue の番号がなければ、人の作業そのものを Issue として起票し、issue 欄に書き戻す */
function ensureIssue(name, board) {
  const path = join(dir, name)
  const todo = parseHumanTodo(readFileSync(path, 'utf8'), `${HUMANS_DIR}/${name}`)
  if (parseBlockRefs(todo.blocks).length > 0 || parseIssueRef(todo.issue)) return
  const created = board.createHumanIssue({ title: todo.title, kind: todo.kind, path: todo.path })
  if (!created.ok) {
    console.log(`注意：人の作業の Issue を起票できませんでした（${created.warning}）。--blocks "#<番号>" を足すか、あとで起票します`)
    return
  }
  writeFileSync(path, setFrontMatterValue(readFileSync(path, 'utf8'), 'issue', created.number))
  console.log(`人の作業を Issue #${created.number} として起票しました：${created.url}`)
}

const AFTER_PUBLISH = 'main に入ると、GitHub Actions が止めている Issue に「人間待ち」のコメントを付け、カンバンの「人間待ち」に置きます'

function files() {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md' && name !== '_template.md')
}

function add() {
  const slug = rest.find((arg) => !arg.startsWith('--') && !Object.values({ t: option('title'), k: option('kind'), b: option('blocks'), m: option('mention') }).includes(arg))
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) die('短い名前を英小文字とハイフンで付けます（例：npm run human -- add vertex-gemini --title "…" --kind 有料API）')
  const title = option('title') ?? die('--title が要ります')
  const kind = option('kind') ?? die(`--kind が要ります（${HUMAN_KINDS.join('、')}）`)
  if (!HUMAN_KINDS.includes(kind)) die(`kind は ${HUMAN_KINDS.join('、')} のどれかです`)
  const notProdCheck = rest.includes('--not-prod-check')
  if (looksLikeProdCheck({ title, kind }) && !notProdCheck) {
    die(`本番での確認は、open なまとめの 1 件に足します：npm run human -- prod-check --title "${title}" [--from "#<Issue>、PR #<番号>"]（todo/humans/README.md「本番に出したあとでしか確かめられないこと」）。本番での確認でなければ --not-prod-check を付け、本文の「${PROD_CHECK_EXCEPTION}」のあとに理由を書きます`)
  }
  if (new RegExp(`(^|-)${PROD_CHECK_SLUG}(-\\d+)?$`).test(slug)) die(`名前の末尾の ${PROD_CHECK_SLUG} は、本番での確認のまとめ（npm run human -- prod-check で作る）だけに使います。ほかの名前にします`)
  const id = `${today()}-${slug}`
  const path = join(dir, `${id}.md`)
  if (existsSync(path)) die(`${HUMANS_DIR}/${id}.md はもうあります`)
  mkdirSync(dir, { recursive: true })
  const who = gitOut(['config', 'user.name'], { cwd: root }) ?? ''
  const askedBy = `${currentBranch(root) || '-'}（${process.env.HARNESS_AGENT ?? 'AI'}、${who} の端末）`
  const unknown = String(option('mention') ?? '').split(/[,、\s]+/).map((name) => name.replace(/^@/, '')).filter((name) => name && !findMember(name, loadMembers(root))?.discord)
  if (unknown.length > 0) console.log(`注意：--mention の ${unknown.join('、')} は名簿（scripts/harness/members.json）に Discord の ID がないので、メンションできません。だれも引けなければ、判断を頼んだ人をメンションします`)
  const rendered = renderHumanTemplate({ id, title, kind, askedBy, created: today(), blocks: option('blocks') ?? '', mention: option('mention') ?? '' })
  // 本番での確認らしい題を --not-prod-check で通したときは、CI に止められないよう例外の行を先に置く（理由は書く人が足す）
  const body = notProdCheck && looksLikeProdCheck({ title, kind }) ? rendered.replace(/(## 背景\n\n)/, `$1${PROD_CHECK_EXCEPTION} ${PROD_CHECK_EXCEPTION_PLACEHOLDER}\n\n`) : rendered
  writeFileSync(path, body)
  console.log(`${HUMANS_DIR}/${id}.md を作りました。「決めてほしいこと」「背景」「選択肢」を書き、\`npm run human -- publish ${id}\` で main に入れます（今のブランチのままでよい）。`)
  console.log(`「決めてほしいこと」がそのまま Issue のコメントの「必要なこと」、「背景」が折りたたみの背景になります。${AFTER_PUBLISH}`)
  const board = github()
  if (board) ensureIssue(`${id}.md`, board)
  console.log('判断を待つあいだは、仮の形で進められる作業か、ほかの作業を先にします。')
}

// 本番での確認を、open なまとめの 1 件（<日付>-prod-check）に足す。なければ作り、人の作業の Issue も起票する。
// まとめにはどのブランチの AI も書き足し、人は main で印や done を付ける。手元の版は古いことがあるので、
// origin/main を取り直し、main の版に手元の変更を重ねたもの（mergeWithMain）を見て、そこに足す
function prodCheck() {
  const heading = option('title') ?? die('--title（確かめることの見出し。例：「しおりの時刻を直したあとの画面の拡大」）が要ります')
  // origin はあるのに取れなかったときは、main にもうまとめがあるか分からない。新しく作ると、別のブランチと 2 件・Issue 2 つになりうる
  const unreachable = process.env.HARNESS_OFFLINE !== '1'
    && git(['remote', 'get-url', 'origin'], { cwd: root }).ok
    && !git(['fetch', 'origin', 'main'], { cwd: root, timeout: TIMEOUT_MS.network * 5 }).ok
  if (unreachable) console.log('注意：origin/main を取れませんでした。手元の版を見て足します（publish のときに main の版と重ねます）')
  const bundleName = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${PROD_CHECK_SLUG}(-\\d+)?\\.md$`)
  const latest = new Map()
  for (const name of new Set([...files(), ...humansOnMain(root)])) {
    if (!bundleName.test(name)) continue
    const merged = mergeWithMain(root, `${HUMANS_DIR}/${name}`)
    if (!merged.ok) die(merged.message)
    latest.set(name, merged)
  }
  const todos = [...latest].map(([name, { text }]) => ({ name, todo: parseHumanTodo(text, `${HUMANS_DIR}/${name}`) }))
  const open = todos.filter(({ todo }) => todo.status !== HUMAN_STATUS.done && isProdCheckBundle(todo))
  if (open.length > 1) die(`本番での確認のまとめが ${open.length} 件 open です（${open.map(({ name }) => name).join('、')}）。先に 1 件に寄せます`)
  let name = open[0]?.name
  const board = github()
  if (name) {
    writeFileSync(join(dir, name), latest.get(name).text)
    // publish で main の版と重ねるとき、手元の版はこの main の版から作ったものとして重ねる
    if (latest.get(name).main !== undefined) rememberBase(root, `${HUMANS_DIR}/${name}`, latest.get(name).main)
  } else {
    if (unreachable) die('origin/main を取れないので、本番での確認のまとめを新しく作りません（main にもうあるかもしれないため）。つながってからやり直します')
    const taken = new Set([...files(), ...humansOnMain(root)])
    let id = `${today()}-${PROD_CHECK_SLUG}`
    for (let n = 2; taken.has(`${id}.md`); n += 1) id = `${today()}-${PROD_CHECK_SLUG}-${n}`
    name = `${id}.md`
    mkdirSync(dir, { recursive: true })
    const who = gitOut(['config', 'user.name'], { cwd: root }) ?? ''
    const askedBy = `${currentBranch(root) || '-'}（${process.env.HARNESS_AGENT ?? 'AI'}、${who} の端末）`
    writeFileSync(join(dir, name), renderProdCheckBundle({ id, askedBy, created: today() }))
    console.log(`本番での確認のまとめ ${HUMANS_DIR}/${name} を作りました`)
    if (board) ensureIssue(name, board)
  }
  const path = join(dir, name)
  writeFileSync(path, appendProdCheck(readFileSync(path, 'utf8'), { heading, from: option('from') ?? '' }))
  const issue = parseIssueRef(parseHumanTodo(readFileSync(path, 'utf8'), name).issue)
  console.log(`${HUMANS_DIR}/${name} の「決めてほしいこと」の最後に「${heading}」を足しました${issue ? `（Issue #${issue}）` : ''}。`)
  console.log('空のチェック（- [ ] ）に、どの画面で何をすれば OK かを 1 行ずつ書き、うまくいかないとき何を見るかも書きます。背景に、手元で確かめたことと元の PR を足します')
  console.log(`書いたら \`npm run human -- publish ${name.replace(/\.md$/, '')}\` で main に入れます（今のブランチのままでよい）。別の項目は作りません`)
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
  console.log('main に入ると、GitHub Actions が Issue のコメントを「決まりました」に書き換え、カンバンを動かします（ほかの判断を待っていなければ、すぐ In Progress へ移し、判断を頼んだ人を担当にします。Discord のカードは「対応中」に。人の作業の Issue は閉じます）')
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

// Actions の同期をすぐ動かす。ふだんは docs/work/・todo/humans/ が変わった main への push、Issue の開け閉め、1 日 1 回で動くので、要らない
function sync() {
  if (process.env.HARNESS_OFFLINE === '1') die('HARNESS_OFFLINE=1 のときは動かせません')
  const result = gh(['workflow', 'run', 'kanban.yml', '--ref', 'main'], { cwd: root })
  if (result.ok) console.log('カンバンの同期（.github/workflows/kanban.yml）を動かしました。1〜2 分で Issue のコメントとカンバンに反映されます')
  else die(`動かせませんでした：${(result.stderr || result.stdout).trim().split('\n')[0]}。main に入れてあれば、push のときか 1 日 1 回の実行で自動で動きます`)
}

const commands = { add, 'prod-check': prodCheck, list, done, sync, publish }
if (!commands[command]) {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(command ? 1 : 0)
}
commands[command]()
