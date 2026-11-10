#!/usr/bin/env node
// git hooks の本体。.githooks/ の小さなシェルから呼ばれる。どの AI にも人にも効く層。
// 使い方：node scripts/harness/git-hook.mjs <pre-commit|commit-msg|pre-push> [git が渡す引数]
import { existsSync, readFileSync } from 'node:fs'
import { checkArchitecture, isCodeFile } from './lib/arch.mjs'
import { checkBranchName, checkCommitMessage, isDeployBranch, isProtectedBranch } from './lib/conventions.mjs'
import { DIRECT_TO_MAIN_PATHS, isDirectToMainPath, onlyDirectToMain, SUBMISSION_REMOTE } from './lib/policy.mjs'
import { currentBranch, git, gitOut, run } from './lib/proc.mjs'
import { forbiddenFileReason, scanAddedLines } from './lib/secrets.mjs'
import { formatResults, hasFailure, runChecks, treeSource } from './lib/checks.mjs'

const [hook, ...args] = process.argv.slice(2)
const root = gitOut(['rev-parse', '--show-toplevel']) ?? process.cwd()
const ZERO = /^0+$/

function fail(title, lines) {
  console.error(`\n[ハーネス] ${title}`)
  for (const line of lines) console.error(`  - ${line}`)
  console.error('  理由と代わりの手順は docs/process/work.md にあります。\n')
  process.exit(1)
}

function preCommit() {
  const branch = currentBranch(root)
  if (isProtectedBranch(branch)) {
    // 人の判断の記録（todo/humans/）だけの commit は main でもよい。消したファイルも含めて見る
    const all = (gitOut(['diff', '--cached', '--name-only', '--no-renames'], { cwd: root }) ?? '').split('\n').filter(Boolean)
    if (!onlyDirectToMain(all)) {
      fail(`${branch} には commit しません`, [
        '`npm run work -- start <種類>/<内容>` で作業ブランチを作ります。未 commit の変更はそのまま移ります',
        'main は全員の開発の土台です。変更は PR とレビューを通します',
        `例外は ${DIRECT_TO_MAIN_PATHS.join('、')} だけを変える commit です。ほかのファイルは \`git restore --staged <ファイル>\` で外すか、作業ブランチへ移します`,
      ])
    }
  }
  const staged = (gitOut(['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: root }) ?? '').split('\n').filter(Boolean)
  const forbidden = staged.map((file) => ({ file, reason: forbiddenFileReason(file) })).filter((item) => item.reason)
  if (forbidden.length > 0) {
    fail('置いてはいけないファイルが commit に入っています（`git restore --staged <ファイル>` で外します）', forbidden.map((item) => `${item.file}：${item.reason}`))
  }
  const diff = gitOut(['diff', '--cached', '-U0', '--no-color'], { cwd: root }) ?? ''
  const secrets = scanAddedLines(diff)
  if (secrets.length > 0) {
    fail('秘密情報らしい値が commit に入っています。値を消し、キーなら無効にして作り直します', secrets.map((item) => `${item.file}:${item.line} ${item.label}（${item.excerpt}）`))
  }
  const code = staged.filter(isCodeFile)
  if (code.length > 0) {
    const files = code.map((path) => ({ path, text: gitOut(['show', `:${path}`], { cwd: root }) ?? '' }))
    const result = checkArchitecture(files)
    const problems = [...result.violations, ...result.errors]
    if (problems.length > 0) {
      fail('設計方針のチェックに通りません（docs/architecture/design-principles.md）', problems.map((item) => `${item.path}:${item.line} ${item.rule ? `[${item.rule}] ` : ''}${item.message}`))
    }
  }
  // web の lint（依存が入っていれば。速いので commit の前に回す）
  const webFiles = staged.filter((file) => /^web\/src\/.+\.[jt]sx?$/.test(file)).map((file) => file.replace(/^web\//, ''))
  const oxlint = `${root}/web/node_modules/oxlint/bin/oxlint`
  if (webFiles.length > 0 && existsSync(oxlint)) {
    const lint = run(process.execPath, [oxlint, ...webFiles], { cwd: `${root}/web`, timeout: 60_000 })
    if (!lint.ok) fail('lint に通りません（web/ で npx oxlint）', (lint.stdout + lint.stderr).split('\n').filter(Boolean).slice(0, 30))
  }
}

function commitMsg() {
  const file = args[0]
  const message = readFileSync(file, 'utf8')
  const result = checkCommitMessage(message)
  if (!result.ok) fail('commit メッセージの形が決まりに合いません', [result.reason])
}

// main への直接の push が、todo/humans/ だけを変える早送りか。だめなら理由を返す（空ならよい）
function directPushProblem(localSha, remoteSha) {
  const rule = `例外は ${DIRECT_TO_MAIN_PATHS.join('、')} だけを変える commit で、これは main へ直接 push してよい`
  if (ZERO.test(localSha) || ZERO.test(remoteSha)) return `${rule}（ブランチを作る・消す push は対象外）`
  if (!git(['cat-file', '-e', `${remoteSha}^{commit}`], { cwd: root }).ok) return `${rule}。先に \`git pull\` で main を取り込みます`
  if (!git(['merge-base', '--is-ancestor', remoteSha, localSha], { cwd: root }).ok) return `${rule}（force push は対象外。\`git pull\` で取り込んでから）`
  const files = (gitOut(['diff', '--name-only', '--no-renames', remoteSha, localSha], { cwd: root }) ?? '').split('\n').filter(Boolean)
  if (onlyDirectToMain(files)) return ''
  const others = files.filter((file) => !isDirectToMainPath(file))
  return `${rule}。ほかのファイルが入っています：${others.slice(0, 5).join('、')}${others.length > 5 ? ' ほか' : ''}`
}

function prePush() {
  const [remoteName, url = ''] = args
  if (SUBMISSION_REMOTE.test(url) || SUBMISSION_REMOTE.test(remoteName ?? '')) {
    fail('提出用リポジトリへは、このリポジトリから push しません', ['開発用の履歴には内部資料があります。docs/process/submission.md の手順で、人が提出用のコピーを作ります'])
  }
  const input = readFileSync(0, 'utf8')
  const problems = []
  let pushedBranch
  for (const line of input.split('\n').filter(Boolean)) {
    const [, localSha, remoteRef, remoteSha] = line.split(' ')
    if (!remoteRef?.startsWith('refs/heads/')) continue
    const name = remoteRef.replace('refs/heads/', '')
    if (isProtectedBranch(name)) {
      const direct = directPushProblem(localSha, remoteSha)
      if (direct) problems.push(`${name} へは push しません。作業ブランチに push して PR を出します（main への merge は CI とレビューの承認のあとに行います）。${direct}`)
      continue
    }
    if (ZERO.test(localSha)) {
      problems.push(`リモートのブランチ ${name} を消す push はしません。消すときは人が GitHub で行います`)
      continue
    }
    // deploy への反映は、人が main を本番へ出すときの操作（docs/process/setup.md「本番への反映」）。
    // 作業ブランチではないので名前と作業宣言は見ない。早送りだけにする（本番の履歴を書き換えない）。AI はガードの no-push-deploy で止まる
    if (isDeployBranch(name)) {
      if (!ZERO.test(remoteSha)) {
        const known = git(['cat-file', '-e', `${remoteSha}^{commit}`], { cwd: root }).ok
        if (!known) problems.push(`${name} の今の中身が手元にありません。\`git fetch origin\` してから反映し直します`)
        else if (!git(['merge-base', '--is-ancestor', remoteSha, localSha], { cwd: root }).ok) {
          problems.push(`${name} への force push（履歴の書き換え）はしません。main を早送りで反映します（\`git push origin origin/main:${name}\`）`)
        }
      }
      continue
    }
    const nameCheck = checkBranchName(name)
    if (!nameCheck.ok) problems.push(`ブランチ名 ${name}：${nameCheck.reason}。\`git branch -m <新しい名前>\` で直します`)
    if (!ZERO.test(remoteSha)) {
      const known = git(['cat-file', '-e', `${remoteSha}^{commit}`], { cwd: root }).ok
      if (known && !git(['merge-base', '--is-ancestor', remoteSha, localSha], { cwd: root }).ok) {
        problems.push(`${name} への force push（履歴の書き換え）はしません。\`git merge origin/${name}\` で取り込んでから push します`)
      }
    }
    pushedBranch = name
  }
  if (problems.length > 0) fail('この push は止めました', problems)

  // 速いチェックだけ（重いものは CI）。ブランチの作業宣言もここで確かめる
  const results = runChecks({ source: treeSource(root), cwd: root, branch: pushedBranch ?? currentBranch(root) })
    .filter((result) => result.id !== 'links' || result.status === 'fail')
  if (hasFailure(results)) {
    console.error(formatResults(results.filter((result) => result.status === 'fail')))
    fail('push の前のチェックに通りません（npm run check:harness で同じものを見られます）', ['上の NG を直してから push します'])
  }
}

const handlers = { 'pre-commit': preCommit, 'commit-msg': commitMsg, 'pre-push': prePush }
if (!handlers[hook]) {
  console.error(`知らないフックです：${hook}`)
  process.exit(0)
}
handlers[hook]()
