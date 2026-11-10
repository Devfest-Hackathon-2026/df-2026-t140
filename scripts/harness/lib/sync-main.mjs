// AI の作業の始めに、origin/main の最新を今のブランチへ取り込む（docs/process/work.md「作業の流れ」）。
// セッションの始めのフックと `npm run work -- sync` が使う。古い main の上で作業して、あとでぶつかるのを防ぐ。
//
// 人の作業を壊さないことを先にする：
// - 未 commit の変更があるとき、merge や rebase の途中のときは、何もしない（取り込み方を AI に伝えるだけ）
// - main は fast-forward だけ。作業ブランチは `git merge origin/main`（rebase と force push はしない）
// - ぶつかったら `git merge --abort` で元に戻し、ぶつかったファイルを伝える
import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isProtectedBranch } from './conventions.mjs'
import { currentBranch, git, gitOut } from './proc.mjs'

const BASE = 'origin/main'

function inProgressOperation(cwd) {
  for (const ref of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (git(['rev-parse', '-q', '--verify', ref], { cwd }).ok) return ref
  }
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    const path = gitOut(['rev-parse', '--git-path', dir], { cwd })
    if (path && existsSync(isAbsolute(path) ? path : join(cwd, path))) return 'rebase'
  }
  return undefined
}

const firstLine = (text) => text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''

/**
 * origin/main を今のブランチへ取り込む。fetch は呼ぶ側で済ませておく。
 * 返す state：up-to-date、fast-forwarded、merged、dirty、busy、conflict、diverged、timeout、failed、detached、no-base
 * mergeTimeout は merge を打ち切るまでの時間（テスト用。既定は proc.mjs の手元の操作の上限）
 */
export function syncWithMain(cwd, { mergeTimeout } = {}) {
  const branch = currentBranch(cwd)
  if (!branch) return { state: 'detached', behind: 0 }
  if (!git(['rev-parse', '-q', '--verify', BASE], { cwd }).ok) return { state: 'no-base', behind: 0 }
  const behind = Number(gitOut(['rev-list', '--count', `HEAD..${BASE}`], { cwd }) ?? 0)
  if (behind === 0) return { state: 'up-to-date', behind }

  const busy = inProgressOperation(cwd)
  if (busy) return { state: 'busy', behind, detail: busy }
  // 追跡していないファイルは数えない（ぶつかるときは git が merge を始める前に止める）
  const dirty = (gitOut(['status', '--porcelain', '--untracked-files=no'], { cwd }) ?? '').split('\n').filter(Boolean)
  if (dirty.length > 0) return { state: 'dirty', behind, detail: `${dirty.length} ファイル` }

  if (isProtectedBranch(branch)) {
    const forward = git(['merge', '--ff-only', '--quiet', BASE], { cwd, timeout: mergeTimeout })
    if (forward.timedOut) return recoverFromTimeout(cwd, behind)
    if (forward.ok) return { state: 'fast-forwarded', behind }
    return { state: 'diverged', behind, detail: firstLine(forward.stderr || forward.stdout) }
  }

  const merged = git(['merge', '--no-edit', '--quiet', BASE], { cwd, timeout: mergeTimeout })
  if (merged.timedOut) return recoverFromTimeout(cwd, behind)
  if (merged.ok) return { state: 'merged', behind }
  if (git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd }).ok) {
    const conflicts = (gitOut(['diff', '--name-only', '--diff-filter=U'], { cwd }) ?? '').split('\n').filter(Boolean)
    const aborted = git(['merge', '--abort'], { cwd }).ok
    return { state: 'conflict', behind, conflicts, aborted }
  }
  return { state: 'failed', behind, detail: firstLine(merged.stderr || merged.stdout) }
}

/**
 * merge が打ち切られたとき（git を途中で止めたとき）の後始末。途中の merge が残っていれば取り消す。
 * index.lock は、ほかの git がまだ動いているかもしれないので消さずに、残っていることを伝える
 */
function recoverFromTimeout(cwd, behind) {
  const pending = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd }).ok
  const aborted = pending ? git(['merge', '--abort'], { cwd }).ok : true
  const lockPath = gitOut(['rev-parse', '--git-path', 'index.lock'], { cwd })
  const locked = Boolean(lockPath && existsSync(isAbsolute(lockPath) ? lockPath : join(cwd, lockPath)))
  return { state: 'timeout', behind, aborted, locked }
}

/** syncWithMain の結果を、AI と人に見せる 1 行にする */
export function describeSync(result, branch) {
  const n = `${result.behind} commit`
  const how = '`git merge origin/main`'
  switch (result.state) {
    case 'fast-forwarded':
      return `main の最新（${n}）を取り込みました（fast-forward）`
    case 'merged':
      return `main の最新（${n}）を ${branch} へ merge しました。merge の commit は次の push で送ります`
    case 'dirty':
      return `main が ${n} 先に進んでいますが、未 commit の変更（${result.detail}）があるので取り込みませんでした。commit してから ${how} で取り込みます`
    case 'busy':
      return `main が ${n} 先に進んでいますが、${result.detail} の途中なので取り込みませんでした。終えてから ${how} で取り込みます`
    case 'conflict':
      return result.aborted
        ? `main の最新（${n}）を取り込もうとしましたが、ぶつかったので取り消しました（${result.conflicts.join(', ') || '不明'}）。作業の前に ${how} でぶつかりを直します`
        : `main の最新を取り込む途中でぶつかり、取り消せませんでした（${result.conflicts.join(', ') || '不明'}）。ぶつかりを直して commit するか、\`git merge --abort\` で戻します`
    case 'diverged':
      return `手元の main が origin/main と分かれているので、取り込みませんでした（${result.detail}）。手元の commit が todo/humans/ だけなら push してから、ほかの変更なら \`npm run work -- start\` で作業ブランチへ移してから取り込みます`
    case 'timeout': {
      const notes = []
      if (!result.aborted) notes.push('途中の merge を取り消せませんでした。`git status` を見て、`git merge --abort` で戻します')
      if (result.locked) notes.push('.git/index.lock が残っています。ほかの git が動いていないことを確かめてから消します')
      return `main の最新（${n}）の取り込みが時間内に終わらず、打ち切りました。${notes.join('。') || '作業ツリーは元のままです'}。${how} を自分で実行します`
    }
    case 'failed':
      return `main の最新を取り込めませんでした（${result.detail}）。${how} を自分で実行します`
    default:
      return undefined
  }
}
