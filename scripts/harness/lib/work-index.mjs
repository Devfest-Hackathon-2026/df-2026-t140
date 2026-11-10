// いま誰が何をしているかを集める。人が書いた要約ではなく、一次の記録から集める：
//   1. origin/main の docs/work/（main に入れた作業宣言）
//   2. 各リモートブランチの作業宣言と、実際に変えたファイル（git diff）
//   3. 開いている PR と Issue（gh。使えなければ飛ばす）
//   4. カンバン（GitHub Projects）の「人間待ち」の列（gh と project スコープ。使えなければ todo/humans だけ）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ledgerPathFor } from './conventions.mjs'
import { HUMAN_STATUS, HUMANS_DIR, parseHumanTodo } from './humans.mjs'
import { createKanban, KANBAN } from './kanban.mjs'
import { parseLedger, STATUS } from './ledger.mjs'
import { globsOverlap, matchesAny } from './paths.mjs'
import { gh, git, gitOut, TIMEOUT_MS } from './proc.mjs'

// 複数の作業がよく同時に触る。重なったら、小さく早く merge する
export const SHARED_FILES = [
  'firestore.rules',
  'storage.rules',
  'firestore.indexes.json',
  'package.json',
  'package-lock.json',
  'web/package.json',
  'web/package-lock.json',
  'functions/package.json',
  'functions/package-lock.json',
  'web/src/app/**',
  'functions/src/index.ts',
  'functions/src/app/**',
  'docs/product/proposal.md',
  'CLAUDE.md',
]

export function fetchOrigin(cwd) {
  return git(['fetch', '--prune', '--quiet', 'origin'], { cwd, timeout: TIMEOUT_MS.network })
}

function listFiles(ref, dir, cwd) {
  const out = gitOut(['ls-tree', '-r', '--name-only', ref, '--', dir], { cwd })
  return out ? out.split('\n').filter(Boolean) : []
}

const show = (ref, path, cwd) => gitOut(['show', `${ref}:${path}`], { cwd })

const isLedgerFile = (path) => /^docs\/work\/[^/]+\.md$/.test(path) && !/\/(README|_template)\.md$/.test(path)

export function collectWork({ cwd, withPrs = true } = {}) {
  const entries = new Map()
  const warnings = []

  if (gitOut(['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd }) === undefined) {
    warnings.push('origin/main が見つかりません。git fetch origin を試してください')
    return { entries: [], warnings }
  }

  for (const path of listFiles('origin/main', 'docs/work', cwd).filter(isLedgerFile)) {
    const text = show('origin/main', path, cwd)
    if (!text) continue
    const ledger = parseLedger(text, path)
    if (!ledger.branch) continue
    entries.set(ledger.branch, { branch: ledger.branch, ledger, source: 'main', remote: false, changed: [], ahead: 0 })
  }

  const refs = (gitOut(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'], { cwd }) ?? '')
    .split('\n')
    .filter((ref) => ref && ref !== 'origin' && ref !== 'origin/HEAD' && ref !== 'origin/main')
  for (const ref of refs) {
    const branch = ref.replace(/^origin\//, '')
    const ahead = Number(gitOut(['rev-list', '--count', `origin/main..${ref}`], { cwd }) ?? 0)
    const text = show(ref, ledgerPathFor(branch), cwd)
    const ledger = text ? parseLedger(text, ledgerPathFor(branch)) : entries.get(branch)?.ledger
    if (ahead === 0 && !ledger) continue // merge 済みで宣言もないブランチ
    const changed =
      ahead > 0 ? (gitOut(['diff', '--name-only', `origin/main...${ref}`], { cwd }) ?? '').split('\n').filter(Boolean) : []
    entries.set(branch, { branch, ledger, source: text ? 'branch' : entries.get(branch)?.source ?? 'none', remote: true, changed, ahead })
  }

  if (withPrs) {
    const result = gh(['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,headRefName,isDraft,author,url'], { cwd })
    if (result.ok) {
      for (const pr of JSON.parse(result.stdout || '[]')) {
        const entry = entries.get(pr.headRefName) ?? { branch: pr.headRefName, remote: true, changed: [], ahead: 0, source: 'none' }
        entry.pr = pr
        entries.set(pr.headRefName, entry)
      }
    } else {
      warnings.push(result.missing ? 'gh がないので、PR は調べていません' : 'gh で PR を調べられませんでした（ネットワークかログイン）')
    }
  }

  const list = [...entries.values()].map((entry) => {
    const status = entry.ledger?.status
    const finished = status === STATUS.done || status === STATUS.dropped
    return {
      ...entry,
      title: entry.ledger?.title ?? entry.pr?.title ?? '',
      issue: entry.ledger?.issue,
      owner: entry.ledger?.owner ?? entry.pr?.author?.login ?? '',
      status: status ?? '宣言なし',
      scope: entry.ledger?.scope ?? [],
      active: !finished && (entry.remote || Boolean(entry.pr)),
      // main に「進行中」で残っているのに、ブランチも PR もない
      stale: status === STATUS.active && !entry.remote && !entry.pr,
    }
  })
  return { entries: list.filter((entry) => entry.active || entry.stale), warnings }
}

// 開いている GitHub Issue を集め、進行中の作業ブランチと紐づける
export function collectOpenIssues(cwd, entries = []) {
  const result = gh(['issue', 'list', '--state', 'open', '--limit', '50', '--json', 'number,title,labels,assignees,url'], { cwd })
  if (!result.ok) return { issues: [], ok: false }
  const byIssue = new Map()
  for (const entry of entries) {
    if (entry.issue && entry.active) byIssue.set(entry.issue, entry)
  }
  const issues = JSON.parse(result.stdout || '[]').map((issue) => {
    const active = byIssue.get(issue.number)
    const labels = (issue.labels ?? []).map((item) => item.name).filter(Boolean)
    return {
      number: issue.number,
      title: issue.title ?? '',
      labels,
      assignees: (issue.assignees ?? []).map((item) => item.login).filter(Boolean),
      url: issue.url ?? '',
      activeBranch: active?.branch,
      activeOwner: active?.owner,
    }
  })
  return { issues, ok: true }
}

// AI が着手できる Issue。進行中のものと、人を待っているもの（ラベル「人間待ち」。カンバンの一覧に出す）は除く
export const backlogIssues = (issues) => issues.filter((item) => !item.activeBranch && !item.labels.includes(KANBAN.label.name))

// me：{ branch, scope, changed }。ほかの作業と、触る範囲や実際の変更が重なるところ
export function findOverlaps(me, entries) {
  const overlaps = []
  for (const other of entries) {
    if (other.branch === me.branch || !other.active) continue
    const paths = new Set()
    for (const mine of me.scope) {
      for (const theirs of other.scope) if (globsOverlap(mine, theirs)) paths.add(theirs)
    }
    for (const file of other.changed) if (matchesAny(file, me.scope)) paths.add(file)
    for (const file of me.changed ?? []) if (matchesAny(file, other.scope)) paths.add(file)
    if (paths.size > 0) {
      const list = [...paths]
      overlaps.push({ other, paths: list, shared: list.some((path) => SHARED_FILES.some((shared) => globsOverlap(path, shared))) })
    }
  }
  return overlaps
}

export function collectHumanTodos(cwd, { ref } = {}) {
  const files = ref
    ? listFiles(ref, HUMANS_DIR, cwd)
    : (gitOut(['ls-files', '--cached', '--others', '--exclude-standard', '--', HUMANS_DIR], { cwd }) ?? '').split('\n')
  const todos = []
  for (const path of files.filter((file) => /\.md$/.test(file) && !/\/(README|_template)\.md$/.test(file))) {
    const text = ref ? show(ref, path, cwd) : readWorking(cwd, path)
    if (text) todos.push(parseHumanTodo(text, path))
  }
  return todos
}

export const openHumanTodos = (todos) => todos.filter((todo) => todo.status !== HUMAN_STATUS.done)

function readWorking(cwd, path) {
  try {
    return readFileSync(join(cwd ?? process.cwd(), path), 'utf8')
  } catch {
    return undefined
  }
}

/**
 * カンバンの「人間待ち」の列にある項目。読めなければ ok: false と warning（project スコープがない、オフラインなど）。
 * runGh は差し替えられる（テスト用）
 */
export function collectHumanWaiting(cwd, { runGh = (args) => gh(args, { cwd }) } = {}) {
  const board = createKanban({ gh: runGh })
  const result = board.listColumn(board.config.columns.waiting)
  return { ...result, column: board.config.columns.waiting }
}
