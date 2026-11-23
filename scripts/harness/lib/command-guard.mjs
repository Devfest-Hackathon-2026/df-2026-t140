// AI が実行しようとしたシェルの命令を調べ、止めるべきものを返す。
// Claude Code（Bash、PowerShell）とほかの AI のアダプターが同じものを使う。
// 止めるときは必ず「代わりにどうするか」を書く。夜中に人がいなくても AI が先へ進めるように。
import { tmpdir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { checkBranchName, isDeployBranch, isProtectedBranch, isWipPr, WIP_LABEL } from './conventions.mjs'
import { toPosix } from './paths.mjs'
import { OTHER_AI_PACKAGES, onlyDirectToMain, PAID_AI_SWITCH, PAID_API_HOSTS, SUBMISSION_REMOTE } from './policy.mjs'
import { flattenCommands } from './shell.mjs'

const HUMAN = '人の判断が要るなら `npm run human -- add` で todo/humans/ に書き、ほかの作業を続けます'

export const MESSAGES = {
  'no-push-main': 'main へは直接 push しません（main は全員の開発の土台で、変更は PR とレビューを通します）。作業ブランチに push して PR を出します。ブランチがなければ `npm run work -- start <種類>/<内容>`。例外は todo/humans/ だけの変更で、`npm run human -- publish <名前>`（done は自動）が、今のブランチのまま main へ入れる。手で入れるなら main の上から `git push origin main`',
  'no-push-deploy': 'deploy ブランチには push も commit も merge もしません。deploy への反映が本番へのデプロイで、反映するのは人です（かめの決定：todo/humans/2026-11-07-deploy-branch.md）。AI は main に入れるところまで行い、本番に出したいときは人に頼みます（`npm run human -- add`。手順は docs/process/setup.md の「本番への反映」）',
  'no-force-push': 'force push はしません（ほかの人の commit を消すおそれがあります）。main の変更を取り込むときは `git merge origin/main` を使います。' + HUMAN,
  'no-verify-bypass': 'git hooks を飛ばしません（--no-verify、core.hooksPath の変更）。hooks に止められた理由のほうを直します',
  'no-destructive-git': 'この git の操作は、未 commit の変更や commit を戻せない形で消します。人の変更かもしれません。自分の変更を戻すなら、ファイルを指定して `git restore <ファイル>` か `git stash` を使います',
  'no-commit-on-main': 'main では commit も merge もしません。`npm run work -- start <種類>/<内容>` で作業ブランチを作ります（未 commit の変更はそのまま移ります）。例外は todo/humans/ だけを stage した commit（-a を付けず、`git add todo/humans/<ファイル>` のあとに `git commit`）。add と commit は && でつながず、別の命令で実行する（ガードは命令の前の stage を見る）',
  'branch-name': 'ブランチ名が決まりに合いません',
  'no-ai-merge': 'AI が main へ merge してよいのは、作業中（ドラフトか「作業中」ラベル）でなく、先頭の commit の手元の確認の記録があり（`npm run work -- finish`。CI は条件にしない）、main とぶつからず、レビューで承認された PR だけです。さらに、会話で人と合意した作業の PR に限ります（ガードはこれを確かめられません。人の merge 指示は待ちません）。作業宣言だけの PR（docs/work/ だけ）は別で、条件も指示も要りません。足りないもの：',
  'no-ai-approve': 'PR の承認は人が行います。AI のレビュー結果はコメントで残します（Claude Code なら /review-pr）',
  'no-deploy': 'デプロイと本番の確認テストは、人が deploy ブランチへ反映したあとに GitHub Actions だけが行います。手元から行うことも、AI が Deploy を走らせることもしません。本番に出したいときは人に頼みます（`npm run human -- add`）',
  'no-paid-api': '費用がかかる API（Cloud の Gemini、Maps Platform）を、許可なく呼んだり有効にしたりしません。' + HUMAN,
  'no-cloud-change': 'Google Cloud と Firebase の設定（API の有効化、上限、課金、権限、secret、本番データの削除）は人が行います。' + HUMAN,
  'no-repo-admin': 'リポジトリの設定、secret、variable は人が扱います。' + HUMAN,
  'no-submission-push': '提出用リポジトリへは push しません。開発用の履歴には内部資料があり、公開されます。提出は docs/process/submission.md の手順で人が行います',
  'no-history-rewrite': '履歴の書き換えは、提出の作業として人が行います（docs/process/submission.md）',
  'no-secret-read': '秘密情報のファイル（.env など）の中身は読みません。値が会話の記録に残ります。変数の名前は .env.example で確かめます。値の設定は人が行います（todo/humans/）',
  'no-dangerous-rm': 'この削除は戻せません。消してよいのは、プロジェクトの中の生成物（node_modules、dist、lib、.harness など）だけです',
  'no-other-ai-sdk': 'プロダクトに他社 AI の SDK を入れません（他社 AI を前面に出すと審査対象外）。AI は Gemini を使います',
  'no-inline-git': 'node -e や python -c の中から git や gh を動かしません。ガードを通らないためです。命令として直接書きます',
  'no-secret-files': '秘密情報のファイル（.env など）に AI は書きません。必要な変数の名前を .env.example に書き、値の設定は人に頼みます（`npm run human -- add`）',
  'harness-config': 'harness.config.json（自動で進めてよい期間など）は人が変えます。変えたいときは `npm run human -- add` で頼みます',
}

const READERS = new Set(['cat', 'type', 'less', 'more', 'head', 'tail', 'bat', 'nl', 'strings', 'grep', 'rg', 'findstr', 'get-content', 'gc', 'select-string', 'sls', 'od', 'xxd', 'base64', 'cp', 'copy', 'copy-item', 'scp', 'sed', 'awk', 'gawk', 'cut', 'sort', 'uniq', 'diff', 'cmp', 'jq', 'yq', 'source', '.', 'dotenv'])
// 書き込み先を取る命令（最後の引数か、-Path などの値）
const COPIERS = new Set(['cp', 'mv', 'copy', 'move', 'copy-item', 'move-item', 'cpi', 'mi', 'install', 'rsync'])
const PS_WRITERS = new Set(['set-content', 'add-content', 'out-file', 'sc', 'ac', 'new-item', 'ni'])
const CONFIG_FILE = /(^|[\\/])harness\.config\.json$/i
const SECRET_FILE = /(^|[\\/])(\.env(\.(?!example$)[^\\/]+)?|\.dev\.vars(\.(?!example$)[^\\/]+)?|[^\\/]*\.(pem|key|p12|pfx)|(service-account|credentials)[^\\/]*\.json)$/i
const INLINE_RUNNERS = new Set(['node', 'python', 'python3', 'deno', 'bun', 'ruby', 'perl'])
const HTTP_CLIENTS = new Set(['curl', 'wget', 'http', 'https', 'xh', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm'])
const ENV_SETTERS = new Set(['export', 'set', 'setx', 'set-item', 'declare'])

const WINDOWS = process.platform === 'win32'

// Git Bash の /c/Users/... を C:/Users/... にそろえる（Windows だけ。Linux の /c/... はふつうのパス）
function normalizePath(path) {
  const posix = toPosix(path)
  const drive = WINDOWS && posix.match(/^\/([a-zA-Z])\/(.*)$/)
  const result = drive ? `${drive[1].toUpperCase()}:/${drive[2]}` : posix
  return WINDOWS ? result.toLowerCase() : result
}

// C:\Users のようなドライブつきのパスは、どの OS で調べても絶対パスとして扱う
const looksAbsolute = (path) => isAbsolute(path) || /^[a-zA-Z]:[\\/]/.test(path) || (WINDOWS && /^\/[a-zA-Z]\//.test(path))

const isWithin = (inner, outer) => inner === outer || inner.startsWith(`${outer.replace(/\/$/, '')}/`)

function isDangerousTarget(target, ctx) {
  const plain = target.replace(/^['"]|['"]$/g, '')
  if (['/', '/*', '~', '~/', '~/*', '.', './', './*', '..', '../', '*', '$HOME', '${HOME}', '$env:USERPROFILE', '%USERPROFILE%'].includes(plain)) return true
  if (/^[a-zA-Z]:[\\/]?\*?$/.test(plain)) return true
  if (/(^|[\\/])\.git([\\/]|$)/.test(plain)) return true
  if (plain.startsWith('~') || plain.startsWith('$')) return true
  const project = normalizePath(ctx.projectDir)
  const base = normalizePath(ctx.cwd ?? ctx.projectDir)
  const absolute = normalizePath(looksAbsolute(plain) ? plain : resolve(base, plain))
  const resolved = absolute.replace(/\/\*$/, '')
  if (isWithin(project, resolved)) return true // プロジェクトそのものか、その上
  if (isWithin(resolved, project)) return false // プロジェクトの中は git で戻せる
  const temps = [tmpdir(), ctx.scratchpadDir, '/tmp'].filter(Boolean).map(normalizePath)
  return !temps.some((temp) => isWithin(resolved, temp))
}

// 書き込み先が、人だけが変えるファイル（期間の設定）か秘密情報のファイルなら止める
function checkWriteTarget(target, add) {
  if (!target) return
  const plain = target.replace(/^['"]|['"]$/g, '')
  if (CONFIG_FILE.test(plain)) add('harness-config')
  else if (SECRET_FILE.test(plain)) add('no-secret-files')
}

// リダイレクト（shell.mjs が引用符の外だけを読む）。< は読み取り、> と >> は書き込み
function checkRedirects(redirects, add) {
  for (const { op, target } of redirects) {
    if (op === '<') {
      if (SECRET_FILE.test(target)) add('no-secret-read')
    } else {
      checkWriteTarget(target, add)
    }
  }
}

function shortFlagsInclude(word, letter, valueLetters = '') {
  if (!/^-[a-zA-Z]+$/.test(word)) return false
  for (const char of word.slice(1)) {
    if (char === letter) return true
    if (valueLetters.includes(char)) return false // ここから先は値
  }
  return false
}

// git commit の引数から、オプションの値を除いて残るもの（パスの指定）。-m "…" の値や --author=… は数えない
const COMMIT_VALUE_OPTIONS = new Set(['-m', '-F', '-C', '-c', '-t', '--message', '--file', '--reuse-message', '--reedit-message', '--template', '--author', '--date', '--cleanup', '--fixup', '--squash', '--trailer', '--pathspec-from-file'])
function commitPathspecs(args) {
  const paths = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (COMMIT_VALUE_OPTIONS.has(arg)) {
      i++
      continue
    }
    if (/^-[a-zA-Z]+$/.test(arg)) {
      // -am のように短いオプションをまとめたもの。値を取る文字が最後なら次が値、途中なら残りが値
      const index = [...arg.slice(1)].findIndex((char) => 'mFCct'.includes(char))
      if (index === arg.length - 2) i++
      continue
    }
    if (arg.startsWith('-')) continue
    paths.push(arg)
  }
  return paths
}

function checkGit(words, ctx, add) {
  let i = 1
  while (i < words.length && words[i].startsWith('-')) {
    const word = words[i]
    if (word === '-C') {
      i += 2
      continue
    }
    if (word === '-c') {
      if (/^core\.hookspath=/i.test(words[i + 1] ?? '')) add('no-verify-bypass')
      i += 2
      continue
    }
    if (/^--(git-dir|work-tree|namespace)$/.test(word)) {
      i += 2
      continue
    }
    i++
  }
  const sub = words[i]
  const args = words.slice(i + 1)
  const has = (...names) => args.some((arg) => names.includes(arg))
  const positional = args.filter((arg) => !arg.startsWith('-'))

  switch (sub) {
    case 'commit': {
      if (has('--no-verify') || args.some((arg) => shortFlagsInclude(arg, 'n', 'mFCct'))) add('no-verify-bypass')
      // todo/humans/ だけを stage した commit は main でもよい。-a、--amend、パスの指定があると何が入るか決まらないので止める
      const stagingFlags = has('-a', '--all', '--amend', '-i', '--include', '-o', '--only', '--interactive', '-p', '--patch', '--') || args.some((arg) => shortFlagsInclude(arg, 'a', 'mFCct') || shortFlagsInclude(arg, 'p', 'mFCct'))
      const fromFile = args.some((arg) => arg.startsWith('--pathspec-from-file'))
      const direct = !stagingFlags && !fromFile && commitPathspecs(args).length === 0 && onlyDirectToMain(ctx.stagedFiles?.())
      if (isProtectedBranch(ctx.branch) && !direct) add('no-commit-on-main')
      if (isDeployBranch(ctx.branch)) add('no-push-deploy')
      break
    }
    case 'merge':
      if (!has('--abort') && isProtectedBranch(ctx.branch)) add('no-commit-on-main')
      if (!has('--abort') && isDeployBranch(ctx.branch)) add('no-push-deploy')
      break
    case 'push':
      checkPush(args, ctx, add)
      break
    case 'reset':
      if (has('--hard')) add('no-destructive-git')
      break
    case 'clean':
      if (has('--force') || args.some((arg) => shortFlagsInclude(arg, 'f'))) add('no-destructive-git')
      break
    case 'checkout': {
      if (has('-f', '--force')) add('no-destructive-git')
      const dash = args.indexOf('--')
      const paths = dash >= 0 ? args.slice(dash + 1) : positional
      if (paths.some((arg) => ['.', '*', ':/'].includes(arg))) add('no-destructive-git')
      for (const flag of ['-b', '-B', '--orphan']) {
        const index = args.indexOf(flag)
        if (index >= 0) checkNewBranch(args[index + 1], add)
      }
      break
    }
    case 'switch': {
      if (has('-f', '--force', '--discard-changes')) add('no-destructive-git')
      for (const flag of ['-c', '-C', '--create', '--force-create']) {
        const index = args.indexOf(flag)
        if (index >= 0) checkNewBranch(args[index + 1], add)
      }
      break
    }
    case 'restore':
      if (positional.some((arg) => ['.', '*', ':/'].includes(arg))) add('no-destructive-git')
      break
    case 'branch': {
      const force = has('-f', '--force') || args.some((arg) => shortFlagsInclude(arg, 'f'))
      if (has('-D') || args.some((arg) => shortFlagsInclude(arg, 'D')) || (force && has('-d', '--delete')) || (force && positional.length > 0)) {
        add('no-destructive-git')
        break
      }
      if (has('-m', '-M', '--move')) {
        checkNewBranch(positional[positional.length - 1], add)
        break
      }
      const listing = args.some((arg) => arg.startsWith('-'))
      if (!listing && positional.length > 0) checkNewBranch(positional[0], add)
      break
    }
    case 'stash':
      if (positional[0] === 'drop' || positional[0] === 'clear') add('no-destructive-git')
      break
    case 'config': {
      const index = args.findIndex((arg) => arg.toLowerCase() === 'core.hookspath')
      if (index >= 0) {
        const value = args[index + 1]
        if (has('--unset', '--unset-all') || (value !== undefined && value !== '.githooks')) add('no-verify-bypass')
      }
      break
    }
    case 'update-ref':
      if (has('-d') || positional.some((arg) => /refs\/heads\/(main|master)$/.test(arg))) add('no-destructive-git')
      break
    case 'worktree': {
      const index = args.indexOf('-b')
      if (positional[0] === 'add' && index >= 0) checkNewBranch(args[index + 1], add)
      break
    }
    case 'filter-repo':
    case 'filter-branch':
      add('no-history-rewrite')
      break
    default:
      break
  }

  function checkNewBranch(name, report) {
    if (!name) return
    const result = checkBranchName(name)
    if (!result.ok) report('branch-name', `${MESSAGES['branch-name']}：${result.reason}`)
  }
}

const PUSH_VALUE_OPTIONS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec'])

function checkPush(args, ctx, add) {
  const positional = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
      if (PUSH_VALUE_OPTIONS.has(args[i])) i++
      continue
    }
    positional.push(args[i])
  }
  const flags = args.filter((arg) => arg.startsWith('-'))
  if (flags.some((flag) => flag === '--force' || flag.startsWith('--force-with-lease') || flag === '--force-if-includes' || shortFlagsInclude(flag, 'f'))) add('no-force-push')
  if (flags.includes('--no-verify')) add('no-verify-bypass')
  if (flags.includes('--mirror') || flags.includes('--all')) {
    add('no-push-main')
    add('no-push-deploy')
  }
  if (flags.includes('--delete') || flags.some((flag) => shortFlagsInclude(flag, 'd'))) add('no-destructive-git')

  const [remote, ...refspecs] = positional
  const url = remote && /:\/\/|^git@|\.git$/.test(remote) ? remote : ctx.remoteUrl?.(remote ?? 'origin')
  if (url && SUBMISSION_REMOTE.test(url)) add('no-submission-push')

  // main の上から main へ、todo/humans/ だけを変えた commit を push するのはよい（人の判断の記録。デプロイは走らない）
  const directPush = () => isProtectedBranch(ctx.branch) && onlyDirectToMain(ctx.outgoingFiles?.())

  if (refspecs.length === 0) {
    if (isProtectedBranch(ctx.branch) && !directPush()) add('no-push-main')
    if (isDeployBranch(ctx.branch)) add('no-push-deploy')
    return
  }
  for (const spec of refspecs) {
    let refspec = spec
    if (refspec.startsWith('+')) {
      add('no-force-push')
      refspec = refspec.slice(1)
    }
    if (refspec.startsWith(':')) {
      add('no-destructive-git')
      continue
    }
    const [src, dst] = refspec.split(':')
    let target = (dst ?? src).replace(/^refs\/heads\//, '')
    if (target === 'HEAD') target = ctx.branch
    if (/^refs\/tags\//.test(target) || flags.includes('--tags')) continue
    // deploy への反映は本番へのデプロイ。main:deploy や origin/main:deploy のような refspec も止める
    if (isDeployBranch(target)) {
      add('no-push-deploy')
      continue
    }
    if (isProtectedBranch(target)) {
      const fromHere = !dst || src === 'HEAD' || src === ctx.branch || src === `refs/heads/${ctx.branch}`
      if (!(fromHere && target === ctx.branch && directPush())) add('no-push-main')
      continue
    }
    const name = checkBranchName(target)
    if (!name.ok) add('branch-name', `${MESSAGES['branch-name']}：${name.reason}`)
  }
}

// レビューの結論の目印。review-pr の skill が PR のコメントに入れる。sha はレビューした commit
export const REVIEW_MARKER = /<!-- harness-review verdict=(APPROVE|REQUEST_CHANGES|COMMENT) sha=([0-9a-f]{7,40}) -->/

// gh pr view の statusCheckRollup を、merge の判断に使う形（{ name, state }）にする。
// PR を閉じて開き直すなどで CI を流し直すと、同じチェックの古い結果も一覧に残る。
// 古い失敗で止めないよう、同じワークフローの同じ名前のチェックは、一番新しく始まったものだけを残す
export function latestChecks(rollup) {
  const latest = new Map()
  for (const check of rollup ?? []) {
    const name = check.name ?? check.context ?? '?'
    const key = `${check.workflowName ?? ''}\u0000${name}`
    const at = checkTime(check)
    const kept = latest.get(key)
    if (!kept || at >= kept.at) latest.set(key, { at, check, name })
  }
  return [...latest.values()].map(({ check, name }) => ({
    name,
    state: check.conclusion || (check.status && check.status !== 'COMPLETED' ? 'PENDING' : check.state) || 'PENDING',
    // ジョブのページ（.../job/<番号>）。落ちたチェックが「始まらなかった」のかを、注記で確かめるのに使う（hook.mjs）
    ...(check.detailsUrl ? { url: check.detailsUrl } : {}),
  }))
}

// チェックの新しさ。まだ終わっていないもの、時刻がないもの（キューに入っただけのときは
// 0001-01-01 が返ることもある）は、終わった古い結果より新しいとみなす（古い成功で通さない）
function checkTime(check) {
  if (check.status && check.status !== 'COMPLETED') return Infinity
  const at = Date.parse(check.startedAt ?? check.completedAt ?? '')
  return Number.isFinite(at) && at > 0 ? at : Infinity
}

// AI が main へ merge してよいか。だめな理由を返す（空なら merge してよい）。
// 手順を飛ばさないための確認で、改ざんへの防御ではない（目印は実装した AI も書ける）。
// CI は条件にせず、手元の確認の記録を求める（2026-11-22）。人の承認を必須にする範囲は todo/humans/2026-11-07-human-approval-scope.md で人が決める
export function mergeProblems(pr) {
  if (pr.base === 'main' && pr.files.length > 0 && pr.files.every((file) => file.startsWith('docs/work/'))) return [] // 作業宣言
  if (pr.base !== 'main') return []
  const problems = []
  if (isWipPr(pr)) problems.push(`作業中のまま（ドラフトか「${WIP_LABEL}」ラベル。\`npm run work -- finish\` でレビュー待ちにする）`)
  if (pr.mergeable === 'CONFLICTING') problems.push('main とぶつかっている（`git merge origin/main` で直す）')
  if (pr.mergeable === 'UNKNOWN') problems.push('ぶつかりの確認がまだ終わっていない（少し待ってからもう一度）')
  // CI は merge の条件にしない。CI は本番への反映（deploy ブランチ）のときに Deploy の verify がまとめて確かめる
  // （Lazyturtle0852 の決定、2026-11-22。todo/humans/2026-11-22-merge-guard-runner-offline.md）。
  // 代わりに、今の先頭の commit を手元で確かめた記録（npm run verify:local の目印。localVerify）を求める。
  // CI を手で走らせて落ちた結果があれば止める（始まらなかっただけ（notStarted）のもの、まだ走っているものは見ない）
  const checks = pr.checks ?? []
  const failed = checks.filter((check) => check.state === 'FAILURE' && check.notStarted !== true)
  if (failed.length > 0) problems.push(`CI が走って落ちた（${failed.map((check) => check.name).join('、')}）`)
  const verifiedHere = Boolean(pr.headSha) && pr.localVerify?.sha === pr.headSha
  if (!verifiedHere) {
    problems.push(
      pr.localVerify
        ? '手元の確認の記録が前の commit のもの（`npm run verify:local` でもう一度確かめる）'
        : '手元の確認の記録がない（`npm run verify:local` で確かめて、PR に記録を残す）',
    )
  }
  const reviewed = pr.reviewDecision === 'APPROVED' || (pr.review?.verdict === 'APPROVE' && pr.headSha?.startsWith(pr.review.sha))
  if (!reviewed) {
    problems.push(
      pr.review && pr.review.verdict === 'APPROVE'
        ? 'レビューのあとに commit が増えている（/review-pr でもう一度レビューする）'
        : 'レビューの承認がない（/review-pr の結論が APPROVE か、人の承認が要る）',
    )
  }
  return problems
}

function checkGh(words, ctx, add) {
  const [, group, action, ...rest] = words
  const args = [action, ...rest].filter((arg) => arg !== undefined)
  if (group === 'pr' && action === 'merge') {
    if (rest.includes('--admin')) {
      add('no-ai-merge', `${MESSAGES['no-ai-merge']}（--admin で確認を飛ばす merge はしない）`)
      return
    }
    const target = rest.find((arg) => !arg.startsWith('-'))
    const pr = ctx.prInfo?.(target)
    if (!pr) {
      add('no-ai-merge', `${MESSAGES['no-ai-merge']}（PR を確かめられなかったので止めました）`)
      return
    }
    if (isDeployBranch(pr.base)) {
      add('no-push-deploy')
      return
    }
    const problems = mergeProblems(pr)
    if (problems.length > 0) add('no-ai-merge', `${MESSAGES['no-ai-merge']}\n- ${problems.join('\n- ')}`)
    return
  }
  if (group === 'pr' && action === 'review' && rest.some((arg) => arg === '--approve' || arg === '-a')) add('no-ai-approve')
  if (group === 'api') {
    const joined = args.join(' ')
    if (/pulls\/\d+\/merge/.test(joined)) add('no-ai-merge')
    // ブランチどうしの merge（repos/<所有者>/<名前>/merges）や、ref の書き換えで deploy を動かすのも止める
    if (/\/merges\b/.test(joined) && /\bdeploy\b/.test(joined)) add('no-push-deploy')
    if (/git\/refs\/heads\/deploy\b/.test(joined)) add('no-push-deploy')
    if (/(-X|--method)\s*(DELETE|PUT|PATCH)/i.test(joined) && !/pulls\/\d+\/merge/.test(joined)) add('no-repo-admin')
  }
  if (group === 'repo' && ['delete', 'edit', 'archive', 'rename', 'unarchive'].includes(action)) add('no-repo-admin')
  if ((group === 'secret' || group === 'variable') && action !== 'list') add('no-repo-admin')
  if (group === 'workflow' && action === 'run' && rest.some((arg) => /deploy/i.test(arg))) add('no-deploy')
}

const CLOUD_MUTATIONS = new Set(['enable', 'disable', 'delete', 'create', 'update', 'rm', 'add-iam-policy-binding', 'remove-iam-policy-binding', 'set-iam-policy', 'billing', 'quota', 'quotas', 'link', 'unlink', 'secrets', 'versions'])

function checkProgram(command, ctx, add) {
  const { program, words } = command
  const args = words.slice(1)

  if (program === 'git') return checkGit(words, ctx, add)
  if (program === 'git-filter-repo') return add('no-history-rewrite')
  if (program === 'gh') return checkGh(words, ctx, add)

  if (program === 'firebase') {
    if (args.some((arg) => arg === 'deploy' || /:deploy$/.test(arg))) add('no-deploy')
    if (args.some((arg) => /:delete$|^delete$|secrets:/.test(arg))) add('no-cloud-change')
    return
  }
  if (program === 'gcloud') {
    if (args.includes('deploy')) add('no-deploy')
    if (!['auth', 'config'].includes(args[0]) && args.some((arg) => CLOUD_MUTATIONS.has(arg))) add('no-cloud-change')
    return
  }
  if (program === 'gsutil' && ['rm', 'rb', 'mv', 'rsync'].includes(args[0])) return add('no-cloud-change')

  // main を deploy へ反映するスクリプト（npm run release）。中で deploy へ push するので、直接動かすのも止める
  if (['node', 'bun', 'deno'].includes(program) && args.some((arg) => /(^|\/)release\.mjs$/.test(arg))) return add('no-deploy')

  if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
    const sub = args[0]
    if (sub === 'run' || sub === 'run-script') {
      if (['deploy', 'smoke:prod', 'release'].includes(args[1])) add('no-deploy')
    }
    if (['install', 'i', 'add'].includes(sub)) {
      const packages = args.slice(1).filter((arg) => !arg.startsWith('-')).map((arg) => arg.replace(/(?!^)@[^/]*$/, ''))
      if (packages.some((name) => OTHER_AI_PACKAGES.test(name))) add('no-other-ai-sdk')
    }
    return
  }

  if (program === 'rm' || program === 'rmdir') {
    const recursive = args.some((arg) => arg === '--recursive' || /^-[a-zA-Z]*[rR]/.test(arg))
    const targets = args.filter((arg) => !arg.startsWith('-'))
    if (recursive && targets.some((target) => isDangerousTarget(target, ctx))) add('no-dangerous-rm')
    return
  }
  if (['remove-item', 'ri', 'del', 'erase', 'rd'].includes(program)) {
    const recursive = args.some((arg) => /^-r(ecurse)?$/i.test(arg) || /^\/s$/i.test(arg))
    const targets = []
    for (let i = 0; i < args.length; i++) {
      if (/^-(path|literalpath)$/i.test(args[i])) targets.push(args[++i])
      else if (!args[i].startsWith('-') && !args[i].startsWith('/')) targets.push(args[i])
    }
    if (recursive && targets.filter(Boolean).some((target) => isDangerousTarget(target, ctx))) add('no-dangerous-rm')
    return
  }

  // 書き込み：tee、cp・mv の行き先、sed -i、PowerShell の Set-Content など
  // 引数の並びは命令ごとにまちまち（-Encoding utf8 の値、-Destination など）なので、
  // 書き込む命令では、フラグでない引数をすべて行き先の候補として調べる（多めに止める）
  const positional = args.filter((arg) => !arg.startsWith('-'))
  if (program === 'tee' || COPIERS.has(program) || PS_WRITERS.has(program)) positional.forEach((arg) => checkWriteTarget(arg, add))
  if ((program === 'sed' || program === 'perl') && args.some((arg) => /^-[a-zA-Z]*i/.test(arg) || /^--in-place(=|$)/.test(arg))) {
    positional.slice(1).forEach((arg) => checkWriteTarget(arg, add))
  }

  if (READERS.has(program) && args.some((arg) => SECRET_FILE.test(arg))) return add('no-secret-read')

  // 有料 API の直接呼び出しと、Cloud の Gemini を本物にする切り替え（名前を検索するだけなら止めない）
  if (HTTP_CLIENTS.has(program) && args.some((arg) => PAID_API_HOSTS.test(arg))) add('no-paid-api')
  if ((ENV_SETTERS.has(program) || /^\$env:/i.test(words[0])) && PAID_AI_SWITCH.test(words.join(' ').replace(/\s*=\s*/g, '='))) {
    add('no-paid-api')
  }

  if (INLINE_RUNNERS.has(program)) {
    const index = args.findIndex((arg) => /^-(e|c|-eval|p|-print)$/.test(arg))
    if (index >= 0 && /\b(git|gh)\b[\s\S]*\b(push|commit|merge|reset|config)\b|--no-verify|child_process|subprocess/.test(args[index + 1] ?? '')) {
      add('no-inline-git')
    }
  }
}

// 返り値：[{ rule, message }]。空なら止めない。
// ctx：{ branch, projectDir, cwd, scratchpadDir, shell, remoteUrl(name), prInfo(target) }
// prInfo は { base, files, isDraft, labels, mergeable, checks: [{ name, state, notStarted? }], localVerify: { sha }?, reviewDecision, review: { verdict, sha }, headSha }
export function checkCommand(command, ctx) {
  const findings = []
  const add = (rule, message = MESSAGES[rule]) => {
    if (!findings.some((item) => item.rule === rule && item.message === message)) findings.push({ rule, message })
  }
  for (const item of flattenCommands(command, { shell: ctx.shell })) {
    checkRedirects(item.redirects ?? [], add)
    if (!item.program) continue
    for (const [key, value] of Object.entries(item.env)) {
      if (PAID_AI_SWITCH.test(`${key}=${value}`)) add('no-paid-api')
    }
    checkProgram(item, ctx, add)
  }
  return findings
}
