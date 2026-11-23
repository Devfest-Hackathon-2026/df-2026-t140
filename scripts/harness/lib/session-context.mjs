// セッションの始めに AI へ渡す「立ち位置」。どの AI のアダプターも同じものを使う。
// 人に聞かなくても、誰の端末で、どの作業をしていて、ほかに誰が何をしているかが分かるようにする。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isProtectedBranch, isWipPr, ledgerPathFor, WIP_LABEL } from './conventions.mjs'
import { readAutonomy } from './autonomy.mjs'
import { ensureGitHooks } from './githooks.mjs'
import { parseLedger } from './ledger.mjs'
import { currentBranch, gitOut } from './proc.mjs'
import { describeSync, syncWithMain } from './sync-main.mjs'
import { humanTargets } from './board.mjs'
import { backlogIssues, heldIssuesByAssignee, collectHumanTodos, collectOpenIssues, collectWork, fetchOrigin, findOverlaps, openHumanTodos } from './work-index.mjs'

const MAX_OTHERS = 8
const MAX_TODOS = 6
const MAX_ISSUES = 8

function readLocal(projectDir, path) {
  try {
    return readFileSync(join(projectDir, path), 'utf8')
  } catch {
    return undefined
  }
}

/**
 * セッションの始めの source（Claude Code の SessionStart が渡す startup、resume、clear、compact）から、
 * main の最新を取り込むかを決める。取り込むのは新しく始めたとき（startup、clear、source のない AI）だけ。
 * resume と compact は作業の途中なので、気づかないうちに main が merge されないよう、遅れを伝えるだけにする
 */
export function shouldSyncOnStart(source) {
  return source !== 'resume' && source !== 'compact'
}

export function buildSessionContext({ projectDir, tool = 'claude', fetch = process.env.HARNESS_OFFLINE !== '1', sync = true }) {
  const lines = []
  const hooks = ensureGitHooks(projectDir)
  const fetched = fetch ? fetchOrigin(projectDir) : { ok: false }
  // 作業の始めに main の最新を取り込む。人の変更があるとき・ぶつかるときは何もせず、伝えるだけ（lib/sync-main.mjs）
  const synced = fetched.ok && sync ? syncWithMain(projectDir) : undefined
  const branch = currentBranch(projectDir)
  const user = gitOut(['config', 'user.name'], { cwd: projectDir }) ?? '（git の user.name が未設定）'
  const dirty = (gitOut(['status', '--porcelain'], { cwd: projectDir }) ?? '').split('\n').filter(Boolean)
  const behind = Number(gitOut(['rev-list', '--count', 'HEAD..origin/main'], { cwd: projectDir }) ?? 0)

  lines.push('# このセッションの立ち位置（ハーネスが自動で作った情報）')
  lines.push(`- あなたは ${user} の端末で動く AI（${tool}）です。ルールの原本は CLAUDE.md、守らせたいことは hooks と CI が止めます`)

  if (!branch) {
    lines.push('- ブランチ：なし（detached HEAD）。作業するなら `npm run work -- start <種類>/<内容> [--issue <番号>]`')
  } else if (isProtectedBranch(branch)) {
    lines.push(`- ブランチ：**${branch}**。main では編集・commit できません（todo/humans/ だけは別で、どのブランチで書いても \`npm run human -- publish\` で main に直接入れます）。作業を始めるときは \`npm run work -- start <種類>/<内容> [--issue <番号>]\`（ブランチ、作業宣言、Issue 紐づけ、PR を作ります）`)
    if (dirty.length > 0) {
      lines.push(`- main に未 commit の変更が ${dirty.length} ファイルあります。人が作業中の可能性があります。消さずに、\`npm run work -- start\` で新しいブランチへそのまま移します`)
    }
  } else {
    const ledgerPath = ledgerPathFor(branch)
    const text = readLocal(projectDir, ledgerPath)
    const ledger = text ? parseLedger(text, ledgerPath) : undefined
    const issueNote = ledger?.issue ? `、Issue #${ledger.issue}` : ''
    lines.push(`- ブランチ：${branch}${behind > 0 && !synced ? `（main が ${behind} commit 先に進んでいます。区切りで \`git merge origin/main\`）` : ''}`)
    lines.push(
      ledger
        ? `- 作業宣言：${ledgerPath}（${ledger.status}「${ledger.title}」${issueNote}）。完了条件がレビューの基準です`
        : `- 作業宣言：まだありません。\`npm run work -- adopt\`（今の変更から作る）か、作業の前に書きます`,
    )
    if (dirty.length > 0) lines.push(`- 未 commit の変更：${dirty.length} ファイル。区切りごとに commit して push します`)
  }
  const syncNote = synced ? describeSync(synced, branch) : undefined
  if (syncNote) lines.push(`- ${syncNote}`)
  if (!sync && behind > 0 && branch && isProtectedBranch(branch)) {
    lines.push(`- main が origin/main より ${behind} commit 遅れています。会話の再開・圧縮では取り込みません。区切りで \`npm run work -- sync\``)
  }
  const autonomy = readAutonomy(projectDir)
  if (autonomy.active) {
    lines.push(
      `- **いまは自動で進めてよい期間です（${autonomy.until} まで、${autonomy.decidedBy ?? '人'} が決定）。** 人の許可を待たずに進め、案で迷ったら最適と思われる案で実装して PR に「仮に選んだこと」として書きます。費用・有料 API・.env・権限・デプロイ（deploy ブランチへの反映）は期間中も人に残し、main への merge はガードの条件を満たした合意済みの作業だけにします（CLAUDE.md「自動で進めてよい期間」）`,
    )
  }
  if (hooks.changed) lines.push('- git hooks を有効にしました（core.hooksPath = .githooks）')
  if (!fetched.ok && fetch) lines.push('- origin を取得できませんでした。下の一覧は古いかもしれません')

  const { entries, warnings } = collectWork({ cwd: projectDir, withPrs: fetch })
  const others = entries.filter((entry) => entry.branch !== branch)
  lines.push('')
  lines.push(`## ほかの進行中の作業（${others.length} 件）`)
  if (others.length === 0) lines.push('- なし')
  for (const entry of others.slice(0, MAX_OTHERS)) {
    const issue = entry.issue ? `Issue #${entry.issue}、` : ''
    const pr = entry.pr ? `PR #${entry.pr.number}${isWipPr(entry.pr) ? ` ${WIP_LABEL}` : ''}` : 'PR なし'
    const scope = entry.scope.length > 0 ? entry.scope.slice(0, 4).join(', ') + (entry.scope.length > 4 ? ' …' : '') : '範囲の宣言なし'
    lines.push(`- ${entry.branch}（${entry.owner || '不明'}、${issue}${pr}、${entry.stale ? '止まっている？' : entry.status}）${entry.title}／範囲：${scope}`)
  }
  if (others.length > MAX_OTHERS) lines.push(`- …ほか ${others.length - MAX_OTHERS} 件（\`npm run work -- status\`）`)

  const todos = openHumanTodos(collectHumanTodos(projectDir))
  if (fetch) {
    const { issues, ok } = collectOpenIssues(projectDir, entries)
    if (ok) {
      const backlog = backlogIssues(issues, todos)
      lines.push('')
      lines.push(`## 未着手の Issue（${backlog.length} 件）`)
      if (backlog.length === 0) {
        lines.push('- なし（新しい開発タスクは `npm run work -- issue --title "…"` で起票するか、`npm run work -- declare` で自動起票されます）')
      } else {
        for (const item of backlog.slice(0, MAX_ISSUES)) lines.push(`- #${item.number} ${item.title}`)
        if (backlog.length > MAX_ISSUES) lines.push(`- …ほか ${backlog.length - MAX_ISSUES} 件（\`npm run work -- status\`）`)
        lines.push('- 着手するときは `npm run work -- start <種類>/<内容> --issue <番号>`')
      }
      const held = heldIssuesByAssignee(issues, todos)
      if (held.length > 0) {
        lines.push('')
        lines.push(`## 担当が付いていて、まだ作業していない Issue（${held.length} 件）`)
        for (const item of held.slice(0, MAX_ISSUES)) lines.push(`- #${item.number} ${item.title}（担当：${item.assignees.join('、')}）`)
        lines.push('- 人の判断が決まって戻ってきた作業など。担当の人の作業なので、ほかの人は拾わない')
      }
    }
  }

  if (branch && !isProtectedBranch(branch)) {
    const mine = entries.find((entry) => entry.branch === branch)
    const ledgerText = readLocal(projectDir, ledgerPathFor(branch))
    const scope = ledgerText ? parseLedger(ledgerText).scope : []
    const changed = (gitOut(['diff', '--name-only', 'origin/main...HEAD'], { cwd: projectDir }) ?? '').split('\n').filter(Boolean)
    const overlaps = findOverlaps({ branch, scope: scope.length ? scope : mine?.scope ?? [], changed }, entries)
    if (overlaps.length > 0) {
      lines.push('')
      lines.push('## 自分の作業と重なるところ')
      for (const overlap of overlaps) {
        lines.push(`- ${overlap.other.branch}：${overlap.paths.slice(0, 5).join(', ')}${overlap.shared ? '（共有ファイル。小さく早く merge する）' : ''}`)
      }
    }
  }

  if (todos.length > 0) {
    lines.push('')
    lines.push(`## 人の判断待ち（todo/humans/、${todos.length} 件）`)
    for (const todo of todos.slice(0, MAX_TODOS)) {
      const targets = humanTargets(todo).map((number) => `#${number}`).join(' ')
      lines.push(`- ${todo.title}（${todo.kind}、${todo.path}${targets ? `、止めている：${targets}` : ''}）`)
    }
    lines.push('- これらに関わる作業は、判断が出るまで仮の形で進めるか、ほかの作業を先にします')
    lines.push('- 人の判断を足すのも決まったことを記録するのも `npm run human`。main に入れると、GitHub Actions が Issue へのコメントとカンバンの「人間待ち」を更新します')
  }

  lines.push('')
  lines.push('## 次にすること')
  lines.push('- すべての開発タスクは GitHub Issue で管理します。起票は `npm run work -- issue`、着手は `npm run work -- start <種類>/<内容> --issue <番号>`（Issue なしで始めた作業も `npm run work -- declare` が自動で Issue を起票します）')
  lines.push('- CLAUDE.md の「目的別の入口」で、今の作業に合う文書だけを読みます（全部は読まない）')
  lines.push('- 費用、有料 API、方針、.env、権限が関わる判断は AI がせず、`npm run human -- add` で todo/humans/ に書きます')
  for (const warning of warnings) lines.push(`- 注意：${warning}`)

  if (tool !== 'claude') {
    // Claude Code 以外は CLAUDE.md を自動で読まないので、ここで渡す
    const rules = readLocal(projectDir, 'CLAUDE.md')
    if (rules) {
      lines.push('')
      lines.push('---')
      lines.push('以下は CLAUDE.md（ルールの原本）の全文です。')
      lines.push('')
      lines.push(rules)
    }
  }
  return lines.join('\n')
}
