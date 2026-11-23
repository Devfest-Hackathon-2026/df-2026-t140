// 人の判断の記録（todo/humans/）を、今のブランチに関係なく main へ直接入れる。
// 会話で人が AI とすり合わせて決めたら、それで決定とし、AI が記録して main まで入れる（かめの決定、
// todo/humans/2026-11-08-decide-in-chat.md）。人が git の命令を打つ手間をなくすため。
//
// やること：
// 1. origin/main を取り直し、一時的な作業ツリー（origin/main の上、detached）を作る
// 2. 今の作業ツリーにある todo/humans/ のファイルを、origin/main の今の版に重ねて（mergeWithMain）写し、それだけを commit する。
//    main で先に足された確認や、人が付けた印・done を、手元の古い版で消さないため。重ならなければ止める
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

// 手元の作業ツリーでは改行が CRLF のこともある（Windows の core.autocrlf）。版を比べるときと 3 方向で重ねるときは LF にそろえる。
// どちらかの版をそのまま使うときは、中身を変えない
const lf = (text) => text?.replace(/\r\n/g, '\n')

function showAt(root, rev, path, git) {
  const result = git(['show', `${rev}:${path}`], { cwd: root })
  return result.ok ? result.stdout : undefined
}

/** origin/main にある todo/humans/ の .md の名前（手元に origin/main がなければ空） */
export function humansOnMain(root, git = defaultGit) {
  const listed = git(['ls-tree', '--name-only', 'origin/main', `${HUMANS_DIR}/`], { cwd: root })
  return listed.ok ? listed.stdout.split('\n').filter(isHumansRecord).map((path) => path.slice(HUMANS_DIR.length + 1)) : []
}

// 手元の版を main のどの版から作ったか（prod-check が main の版を取って足したとき）。publish で重ねる元にし、入れたら消す。
// .harness/ は git に入らない。作業ツリーはブランチをまたいで共有されるので、ブランチごとに分けて置く
// （別のブランチの古い版に、ほかのブランチの記録を元として当てると、main の変更を手元の古い版で消しうる）
const baseRecord = (root, path, git = defaultGit) => {
  const branch = git(['branch', '--show-current'], { cwd: root }).stdout.trim() || '(detached)'
  return join(root, '.harness', 'humans-base', branch, path)
}

/** 手元の path を、main の版 text から作ったと記録する（mergeWithMain が重ねる元にする） */
export function rememberBase(root, path, text, git = defaultGit) {
  const record = baseRecord(root, path, git)
  mkdirSync(dirname(record), { recursive: true })
  writeFileSync(record, text)
}

/**
 * 手元の版を、origin/main の今の版に重ねる（origin/main は呼ぶ側が取り直しておく）。返り値：{ ok, text, main, message }
 * 同じファイルに、ほかの AI や人が main で書き足したり印や done を付けたりする（本番での確認のまとめなど）。
 * 手元の版で main を上書きすると、それが消えるので、手元の版の元（rememberBase の記録か、なければこのブランチが
 * main から分かれたときの版）を元に 3 方向で重ねる。重ならない（同じ所を両方で変えた）ときは ok: false にして、上書きしない。
 * main は origin/main の今の版（なければ undefined）
 */
export function mergeWithMain(root, path, git = defaultGit) {
  const ours = existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : undefined
  const theirs = showAt(root, 'origin/main', path, git)
  const result = mergeVersions(root, path, ours, theirs, git)
  return { ...result, main: theirs }
}

function mergeVersions(root, path, ours, theirs, git) {
  if (theirs === undefined || lf(ours) === lf(theirs)) return { ok: true, text: ours }
  if (ours === undefined) return { ok: true, text: theirs }
  const mergeBase = git(['merge-base', 'HEAD', 'origin/main'], { cwd: root })
  const record = baseRecord(root, path, git)
  const base = existsSync(record)
    ? readFileSync(record, 'utf8')
    : mergeBase.ok
      ? showAt(root, mergeBase.stdout.trim(), path, git)
      : undefined
  if (lf(base) === lf(theirs)) return { ok: true, text: ours } // main はこのブランチが分かれたときから変わっていない
  if (lf(base) === lf(ours)) return { ok: true, text: theirs } // 手元では変えていない。main の新しい版を使う
  const dir = mkdtempSync(join(tmpdir(), 'harness-merge-'))
  try {
    const files = { ours: join(dir, 'ours.md'), base: join(dir, 'base.md'), theirs: join(dir, 'theirs.md') }
    writeFileSync(files.ours, lf(ours))
    writeFileSync(files.base, lf(base) ?? '')
    writeFileSync(files.theirs, lf(theirs))
    const merged = git(['merge-file', '-p', files.ours, files.base, files.theirs], { cwd: root })
    if (merged.status === 0) return { ok: true, text: merged.stdout }
    return {
      ok: false,
      message: `${path} は、main でも手元でも同じ所が変わっていて、重ねられません。main の版（git show origin/main:${path}）に手元の変更を写し直してから、もう一度 publish します（main の版を上書きしないため）`,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * files（リポジトリの根からのパス）を main に入れる。返り値：{ ok, pushed, message }
 * pushed は main に入れた commit。何も変わらなければ ok で pushed は空。
 * 手元の版は、そのまま写さずに origin/main の今の版へ重ねてから入れる（mergeWithMain）
 */
export function publishHumans({ root, files, message, git = defaultGit, trailer = process.env.HARNESS_COMMIT_TRAILER }) {
  const targets = [...new Set(files)].filter(isHumansRecord)
  if (targets.length === 0) return { ok: false, message: `${HUMANS_DIR}/ の .md が指定されていません` }
  const missing = targets.filter((path) => !existsSync(join(root, path)))
  if (missing.length > 0) return { ok: false, message: `見つかりません：${missing.join('、')}` }

  const tree = mkdtempSync(join(tmpdir(), 'harness-humans-'))
  rmSync(tree, { recursive: true, force: true })
  try {
    let pushed
    let contents
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const fetched = git(['fetch', 'origin', 'main'], { cwd: root, timeout: TIMEOUT_MS.network * 5 })
      if (!fetched.ok) return { ok: false, message: `origin/main を取れませんでした：${fetched.stderr.trim()}` }
      contents = new Map()
      for (const path of targets) {
        const merged = mergeWithMain(root, path, git)
        if (!merged.ok) return { ok: false, message: merged.message }
        contents.set(path, merged.text)
      }
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
    const kept = restoreLocal(root, targets, contents, git)
    // 元の版の記録は、入れ終えたら消す。手元に main と同じ版を残したもの（kept）は、ブランチが main を取り込むまで
    // merge-base が古いままなので、いま main に入れた版を次に重ねる元として残す
    for (const path of targets) {
      if (kept.includes(path)) rememberBase(root, path, contents.get(path), git)
      else rmSync(baseRecord(root, path, git), { force: true })
    }
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
function restoreLocal(root, targets, contents, git) {
  const base = git(['merge-base', 'HEAD', 'origin/main'], { cwd: root }).stdout.trim()
  const kept = []
  for (const path of targets) {
    // このブランチで commit 済みの変更があるファイルは戻さない。戻すと古い版が残り、あとで main とぶつかる。
    // main に入れた版（main の変更を重ねたもの）を手元に置く。このブランチでも commit すれば同じ内容になり、ぶつからない
    const changedOnBranch = base && !git(['diff', '--quiet', base, 'HEAD', '--', path], { cwd: root }).ok
    if (changedOnBranch) {
      writeFileSync(join(root, path), contents.get(path))
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
