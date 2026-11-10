// 人の判断の記録（todo/humans/）を、今のブランチに関係なく main へ直接入れる。
// 会話で人が AI とすり合わせて決めたら、それで決定とし、AI が記録して main まで入れる（かめの決定、
// todo/humans/2026-11-08-decide-in-chat.md）。人が git の命令を打つ手間をなくすため。
//
// やること：
// 1. origin/main を取り直し、一時的な作業ツリー（origin/main の上、detached）を作る
// 2. 今の作業ツリーにある todo/humans/ のファイルを写し、それだけを commit する
// 3. `git push origin HEAD:main`。git の pre-push フック（git-hook.mjs）が「todo/humans/ だけの早送り」かを確かめる。
//    ほかの人が先に main を進めていたら、取り直して最大 3 回やり直す
// 4. 一時的な作業ツリーを消し、今の作業ツリーの写したファイルを元に戻す（main から取り込めば同じ内容が入る）。
//    今のブランチに未 commit の変更がほかになければ、origin/main を取り込む
//
// 写すのは todo/humans/ の下の .md だけ。ほかのファイルは混ぜない（docs/process/work.md の例外の条件）。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { HUMANS_DIR } from './humans.mjs'
import { git as defaultGit, TIMEOUT_MS } from './proc.mjs'
import { syncWithMain } from './sync-main.mjs'

const ATTEMPTS = 3

/** push の失敗が、ほかの人が先に main を進めたためか（取り直せば通る） */
export function isRacedWithMain(stderr) {
  if (/\[ハーネス\]/.test(stderr)) return /先に `git pull`/.test(stderr) && !/ほかのファイルが入っています/.test(stderr)
  return /non-fast-forward|fetch first|\[rejected\]/.test(stderr)
}

/** 写してよいパスか（todo/humans/ の下の .md。README と _template も含む） */
export function isHumansRecord(path) {
  return typeof path === 'string' && path.startsWith(`${HUMANS_DIR}/`) && path.endsWith('.md') && !path.includes('..')
}

/** 今の作業ツリーで、todo/humans/ の下で変わったファイル（未 commit と未追跡）。HEAD から main に入っていない commit の分も含める */
export function changedHumansRecords(root, git = defaultGit) {
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', HUMANS_DIR], { cwd: root })
  const fromStatus = status.ok
    ? status.stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
    : []
  const ahead = git(['diff', '--name-only', '--no-renames', 'origin/main...HEAD', '--', HUMANS_DIR], { cwd: root })
  const fromCommits = ahead.ok ? ahead.stdout.split('\n').filter(Boolean) : []
  return [...new Set([...fromStatus, ...fromCommits])].filter(isHumansRecord).filter((path) => existsSync(join(root, path)))
}

/**
 * files（リポジトリの根からのパス）を main に入れる。返り値：{ ok, pushed, message }
 * pushed は main に入れた commit。何も変わらなければ ok で pushed は空
 */
export function publishHumans({ root, files, message, git = defaultGit, trailer = process.env.HARNESS_COMMIT_TRAILER }) {
  const targets = [...new Set(files)].filter(isHumansRecord)
  if (targets.length === 0) return { ok: false, message: `${HUMANS_DIR}/ の .md が指定されていません` }
  const missing = targets.filter((path) => !existsSync(join(root, path)))
  if (missing.length > 0) return { ok: false, message: `見つかりません：${missing.join('、')}` }
  const contents = new Map(targets.map((path) => [path, readFileSync(join(root, path), 'utf8')]))

  const tree = mkdtempSync(join(tmpdir(), 'harness-humans-'))
  rmSync(tree, { recursive: true, force: true })
  try {
    let pushed
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const fetched = git(['fetch', 'origin', 'main'], { cwd: root, timeout: TIMEOUT_MS.network * 5 })
      if (!fetched.ok) return { ok: false, message: `origin/main を取れませんでした：${fetched.stderr.trim()}` }
      if (existsSync(tree)) git(['worktree', 'remove', '--force', tree], { cwd: root })
      const added = git(['worktree', 'add', '--detach', tree, 'origin/main'], { cwd: root })
      if (!added.ok) return { ok: false, message: `一時的な作業ツリーを作れませんでした：${added.stderr.trim()}` }
      for (const [path, text] of contents) {
        mkdirSync(dirname(join(tree, path)), { recursive: true })
        writeFileSync(join(tree, path), text)
      }
      git(['add', '--', ...targets], { cwd: tree })
      const staged = git(['diff', '--cached', '--name-only'], { cwd: tree })
      if (staged.ok && staged.stdout.trim() === '') return { ok: true, pushed: '', message: 'main と同じ内容なので、入れるものはありません' }
      const body = [message, '', ...targets.map((path) => `- ${path}`), ...(trailer ? ['', trailer] : [])].join('\n')
      const committed = git(['commit', '-q', '-m', body], { cwd: tree })
      if (!committed.ok) return { ok: false, message: `commit できませんでした：${(committed.stderr || committed.stdout).trim()}` }
      const result = git(['push', 'origin', 'HEAD:main'], { cwd: tree, timeout: TIMEOUT_MS.network * 10 })
      if (result.ok) {
        pushed = git(['rev-parse', '--short', 'HEAD'], { cwd: tree }).stdout.trim()
        break
      }
      // ほかの人が先に main を進めたなら、取り直してやり直す。git の non-fast-forward のほか、pre-push フックが
      // 「手元にない main の commit」を見て出す「先に `git pull`」もこれにあたる。ほかの理由でフックに止められたならやめる
      if (!isRacedWithMain(result.stderr)) {
        return { ok: false, message: `main に入れられませんでした：${result.stderr.trim()}` }
      }
    }
    if (!pushed) return { ok: false, message: `main が先に進み続けたので、${ATTEMPTS} 回で入れられませんでした。少し待ってやり直します` }
    const kept = restoreLocal(root, targets, git)
    const note = kept.length > 0 ? `。このブランチでも変えていた ${kept.join('、')} は手元に新しい版を残しました。このブランチでも commit します` : ''
    return { ok: true, pushed, kept, message: `main に入れました（${pushed}）${note}` }
  } finally {
    if (existsSync(tree)) git(['worktree', 'remove', '--force', tree], { cwd: root })
    git(['worktree', 'prune'], { cwd: root })
  }
}

/**
 * 写したファイルを今の作業ツリーで元に戻し、ほかに未 commit の変更がなければ origin/main を取り込む。
 * 戻すのは、いま main に入れた内容と同じものだけ（同じ内容が main から入ってくる）。HEAD にあれば HEAD の版、なければ消す
 */
function restoreLocal(root, targets, git) {
  const base = git(['merge-base', 'HEAD', 'origin/main'], { cwd: root }).stdout.trim()
  const kept = []
  for (const path of targets) {
    // このブランチで commit 済みの変更があるファイルは戻さない。戻すと古い版が残り、あとで main とぶつかる。
    // 手元の新しい版を、このブランチでも commit すれば同じ内容になり、ぶつからない
    const changedOnBranch = base && !git(['diff', '--quiet', base, 'HEAD', '--', path], { cwd: root }).ok
    if (changedOnBranch) {
      kept.push(path)
      continue
    }
    const tracked = git(['cat-file', '-e', `HEAD:${path}`], { cwd: root }).ok
    if (tracked) git(['checkout', 'HEAD', '--', path], { cwd: root })
    else rmSync(join(root, path), { force: true })
  }
  if (kept.length === 0) syncWithMain(root)
  return kept
}
