#!/usr/bin/env node
// AI ツールのフックの入口。使い方：node scripts/harness/hook.mjs <claude|codex|gemini|agy> <event>
// 判断は lib/ の共通の処理が行い、ここは各ツールの入出力の形をそろえるだけ（アダプター）。
// 内部でエラーが起きたら止めずに通す（fail-open）。git hooks と CI が後ろの層で止める。
// Antigravity はフックが落ちると操作を止める（fail-closed）ので、必ず判断を出力してから終わる。
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'
import { checkArchitecture, isCodeFile } from './lib/arch.mjs'
import { readAutonomy } from './lib/autonomy.mjs'
import { checkCommand, MESSAGES, REVIEW_MARKER } from './lib/command-guard.mjs'
import { isProtectedBranch, ledgerPathFor } from './lib/conventions.mjs'
import { checkEdit, isSecretFile } from './lib/edit-guard.mjs'
import { applyPaneTitle } from './lib/pane-title.mjs'
import { toPosix } from './lib/paths.mjs'
import { currentBranch, gh, gitOut, repoRoot } from './lib/proc.mjs'
import { buildSessionContext, shouldSyncOnStart } from './lib/session-context.mjs'
import { readEdits, rememberEdit, writeTrace } from './lib/trace.mjs'
import { addedCopy, isCopyFile, undoEdits } from './lib/ui-copy.mjs'
import { readFileSync } from 'node:fs'

const [tool = 'claude', event = ''] = process.argv.slice(2)

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text ? JSON.parse(text) : {}
}

// ---- 各ツールの入力を、共通の形にする -------------------------------------------

function projectDirOf(input) {
  const candidates = [process.env.CLAUDE_PROJECT_DIR, process.env.GEMINI_PROJECT_DIR, input.workspacePaths?.[0], input.cwd, process.cwd()]
  for (const candidate of candidates.filter(Boolean)) {
    const root = repoRoot(candidate)
    if (root) return root
  }
  return process.cwd()
}

// Codex の apply_patch は、パッチの本文に変えるファイルが書いてある
function filesInPatch(patch) {
  return [...String(patch).matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim())
}

function normalize(input) {
  if (tool === 'agy') {
    const name = input.toolCall?.name ?? ''
    const args = input.toolCall?.args ?? {}
    if (name === 'run_command') return { kind: 'command', command: String(args.CommandLine ?? ''), cwd: args.Cwd, shell: process.platform === 'win32' ? 'powershell' : 'bash' }
    if (/^(write_file|edit_file|write_to_file|replace_file_content|multi_replace_file_content)$/.test(name)) {
      return { kind: 'edit', files: [args.Path ?? args.TargetFile].filter(Boolean) }
    }
    if (/^(read_file|view_file|grep_search)$/.test(name)) {
      return { kind: 'read', files: [args.Path ?? args.AbsolutePath ?? args.SearchPath].filter(Boolean) }
    }
    return { kind: 'other' }
  }
  const name = input.tool_name ?? ''
  const toolInput = input.tool_input ?? {}
  if (tool === 'gemini') {
    if (name === 'run_shell_command') return { kind: 'command', command: String(toolInput.command ?? ''), cwd: toolInput.dir_path, shell: process.platform === 'win32' ? 'powershell' : 'bash' }
    if (name === 'write_file' || name === 'replace') return { kind: 'edit', files: [toolInput.file_path].filter(Boolean) }
    return { kind: 'other' }
  }
  if (tool === 'codex') {
    if (name === 'apply_patch') return { kind: 'edit', files: filesInPatch(toolInput.command ?? toolInput.patch ?? toolInput.input ?? '') }
    if (name === 'Edit' || name === 'Write') {
      const files = [toolInput.file_path ?? toolInput.path].filter(Boolean)
      return { kind: 'edit', files: files.length > 0 ? files : filesInPatch(toolInput.command ?? '') }
    }
    if (name === 'Bash') {
      // 配列は argv。要素ごとに引用してからつなぐ（["bash","-lc","git push …"] の中身を 1 つのスクリプトとして調べるため）
      if (Array.isArray(toolInput.command)) return { kind: 'command', command: toolInput.command.map(quoteArg).join(' '), cwd: input.cwd, shell: 'bash' }
      return { kind: 'command', command: String(toolInput.command ?? ''), cwd: input.cwd, shell: process.platform === 'win32' ? 'powershell' : 'bash' }
    }
    return { kind: 'other' }
  }
  // Claude Code
  if (name === 'Bash' || name === 'PowerShell') return { kind: 'command', command: String(toolInput.command ?? ''), cwd: input.cwd, shell: name === 'PowerShell' ? 'powershell' : 'bash' }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name)) return { kind: 'edit', files: [toolInput.file_path ?? toolInput.notebook_path].filter(Boolean) }
  if (name === 'Read' || name === 'Grep') return { kind: 'read', files: [toolInput.file_path ?? toolInput.path].filter(Boolean) }
  return { kind: 'other' }
}

const quoteArg = (arg) => {
  const text = String(arg)
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`
}

// 秘密情報のファイル（.env など）を、Read や Grep の道具で読まない
function decideRead(action) {
  const secret = action.files.find((file) => isSecretFile(toPosix(file)))
  return secret
    ? { decision: 'deny', rule: 'no-secret-read', reason: `[no-secret-read] ${MESSAGES['no-secret-read']}（${secret}）` }
    : { decision: 'allow' }
}

// ---- 各ツールの出力の形 -----------------------------------------------------------

function respondDecision(decision, reason) {
  if (tool === 'agy') return print({ decision, ...(reason ? { reason } : {}) })
  if (tool === 'gemini') return decision === 'allow' ? print({ decision: 'allow' }) : print({ decision: 'deny', reason })
  if (decision === 'allow') return undefined // Claude Code と Codex は、何も出さなければ通常の権限の流れに戻る
  return print({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason } })
}

function respondContext(text) {
  if (tool === 'agy') return print({ injectSteps: [{ systemMessage: { systemMessage: text } }] })
  return print({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } })
}

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

// ---- 判断 -------------------------------------------------------------------------

// merge してよいかを決めるための PR の情報（gh。取れなければ undefined → 止める）
function prInfoLookup(projectDir) {
  return (target) => {
    const fields = 'files,baseRefName,isDraft,mergeable,statusCheckRollup,reviewDecision,comments,headRefOid'
    const result = gh(['pr', 'view', ...(target ? [target] : []), '--json', fields], { cwd: projectDir })
    if (!result.ok) return undefined
    const data = JSON.parse(result.stdout)
    const checks = (data.statusCheckRollup ?? []).map((check) => ({
      name: check.name ?? check.context ?? '?',
      state: check.conclusion || (check.status && check.status !== 'COMPLETED' ? 'PENDING' : check.state) || 'PENDING',
    }))
    const markers = (data.comments ?? []).map((comment) => comment.body?.match(REVIEW_MARKER)).filter(Boolean)
    const last = markers[markers.length - 1]
    return {
      base: data.baseRefName,
      files: (data.files ?? []).map((file) => file.path),
      isDraft: data.isDraft,
      mergeable: data.mergeable,
      checks,
      reviewDecision: data.reviewDecision,
      review: last ? { verdict: last[1], sha: last[2] } : undefined,
      headSha: data.headRefOid,
    }
  }
}

const lines = (text) => (text ?? '').split('\n').map((line) => line.trim()).filter(Boolean)

function decideCommand(action, input, projectDir) {
  const cwd = action.cwd && existsSync(action.cwd) ? action.cwd : projectDir
  const ctx = {
    branch: currentBranch(cwd),
    projectDir,
    cwd,
    shell: action.shell,
    scratchpadDir: input.scratchpad_dir,
    remoteUrl: (name) => gitOut(['remote', 'get-url', name], { cwd }),
    prInfo: prInfoLookup(projectDir),
    // main に直接入れてよい変更（todo/humans/ だけ）かを見るため。命令に要るときだけ git を呼ぶ
    stagedFiles: () => lines(gitOut(['diff', '--cached', '--name-only', '--no-renames'], { cwd })),
    outgoingFiles: () => {
      const behind = Number(gitOut(['rev-list', '--count', 'HEAD..origin/main'], { cwd }) ?? 1)
      if (behind > 0) return [] // origin/main を取り込んでいない（push はどのみち通らない）。git pull のあとに push する
      return lines(gitOut(['diff', '--name-only', '--no-renames', 'origin/main', 'HEAD'], { cwd }))
    },
  }
  const findings = checkCommand(action.command, ctx)
  return findings.length === 0
    ? { decision: 'allow' }
    : { decision: 'deny', rule: findings.map((item) => item.rule).join(','), reason: findings.map((item) => `[${item.rule}] ${item.message}`).join('\n') }
}

function existingDir(path) {
  let dir = dirname(path)
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  return dir
}

function decideEdit(action, projectDir) {
  const decisions = action.files.map((file) => {
    const filePath = isAbsolute(file) ? file : resolve(projectDir, file)
    return checkEdit({ filePath, projectDir, branch: currentBranch(existingDir(filePath)) })
  })
  const deny = decisions.find((item) => item.decision === 'deny')
  if (deny) return { decision: 'deny', rule: deny.rule, reason: `[${deny.rule}] ${deny.message}` }
  const ask = decisions.find((item) => item.decision === 'ask')
  if (!ask) return { decision: 'allow' }
  // 自動で進めてよい期間は、人に確認を求めずに通す（トレースには残る）
  if (readAutonomy(projectDir).active) return { decision: 'allow', rule: `${ask.rule}:autonomy` }
  return { decision: 'ask', rule: ask.rule, reason: `[${ask.rule}] ${ask.message}` }
}

// 書き換えたファイルを、その場で層のチェックにかける（CI を待たずに直せるように）
function afterEdit(action, input, projectDir) {
  const problems = []
  for (const file of action.files) {
    const filePath = isAbsolute(file) ? file : resolve(projectDir, file)
    const rel = relativeToProject(projectDir, filePath)
    rememberEdit(projectDir, input.session_id, rel)
    if (!isCodeFile(rel)) continue
    let text
    try {
      text = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }
    const result = checkArchitecture([{ path: rel, text }])
    for (const item of [...result.violations, ...result.errors]) problems.push(`${item.path}:${item.line} ${item.rule ? `[${item.rule}] ` : ''}${item.message}`)
  }
  return problems
}

/** 実体のパス。まだないファイルなら、そのまま返す */
function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * リポジトリからの相対パス（/ 区切り）。macOS では一時フォルダが /var と /private/var の 2 通りに書かれる
 * （git は後者を返す）ので、実体のパスどうしで比べる
 */
function relativeToProject(projectDir, filePath) {
  return toPosix(relative(realPath(projectDir), realPath(filePath)))
}

// 画面の日本語を足した編集なら、yomiyasu で推敲する決まりを思い出させる（止めない。docs/ui/README.md「画面の文言」）
// 編集の前の中身は、Edit なら置き換えを戻して、Write なら HEAD の版から作る
function copyReminder(action, input, projectDir) {
  const toolInput = input.tool_input ?? {}
  const added = []
  for (const file of action.files) {
    const filePath = isAbsolute(file) ? file : resolve(projectDir, file)
    const rel = relativeToProject(projectDir, filePath)
    if (!isCopyFile(rel)) continue
    let after
    try {
      after = readFileSync(filePath, 'utf8')
    } catch {
      continue
    }
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : typeof toolInput.new_string === 'string' ? [toolInput] : undefined
    let befores
    if (edits) {
      // 消すだけの編集（new_string が空）は、文言を足していないので見ない
      if (edits.every((edit) => !edit.new_string)) continue
      befores = undoEdits(after, edits)
    } else {
      befores = [gitOut(['show', `HEAD:${rel}`], { cwd: projectDir }) ?? '']
    }
    // 戻し方が 1 つに決まらないときは、どの戻し方でも足したことになる文言だけを出す
    const lists = befores.map((before) => addedCopy(before, after))
    const common = lists[0].filter((item) => lists.every((list) => list.some((other) => other.text === item.text)))
    for (const item of common) added.push(`${rel}:${item.line}「${item.text}」`)
  }
  if (added.length === 0) return undefined
  const shown = added.slice(0, 5).join('\n')
  const more = added.length > 5 ? `\nほか ${added.length - 5} 件` : ''
  return `画面の日本語の文言を足しました：\n${shown}${more}\nAI が書いた文言は、yomiyasu スキルで推敲してから残します（docs/ui/README.md「画面の文言」）。推敲した結果を入れた編集なら、このままで構いません。人が書いた文言をそのまま写したときも不要です。push と merge は止めません。`
}

function stopCheck(input, projectDir) {
  if (input.stop_hook_active) return undefined // 一度止めたあとは止めない（無限ループの防止）
  const branch = currentBranch(projectDir)
  const edited = new Set(readEdits(projectDir, input.session_id))
  if (edited.size === 0) return undefined
  const dirty = (gitOut(['status', '--porcelain'], { cwd: projectDir }) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((line) => toPosix(line.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '')))
  const mine = dirty.filter((file) => edited.has(file))
  const notes = []
  if (mine.length > 0) {
    notes.push(`このセッションで変えた ${mine.length} ファイルが commit されていません（${mine.slice(0, 5).join(', ')}${mine.length > 5 ? ' …' : ''}）。区切りなら commit して push します。わざと残すなら、その理由をユーザーに伝えてから終えます`)
  }
  if (branch && !isProtectedBranch(branch)) {
    const upstream = gitOut(['rev-parse', '--abbrev-ref', '@{u}'], { cwd: projectDir })
    const unpushed = Number(gitOut(['rev-list', '--count', upstream ? '@{u}..HEAD' : 'origin/main..HEAD'], { cwd: projectDir }) ?? 0)
    if (unpushed > 0) notes.push(`push していない commit が ${unpushed} 個あります。ほかの AI が進み具合を見られるよう push します`)
    if (!existsSync(join(projectDir, ledgerPathFor(branch)))) notes.push(`作業宣言 ${ledgerPathFor(branch)} がありません。\`npm run work -- adopt\` で作ります`)
  }
  return notes.length > 0 ? notes.join('\n') : undefined
}

// ---- 実行 -------------------------------------------------------------------------

async function main() {
  let input = {}
  try {
    input = await readStdin()
  } catch {
    if (tool === 'agy' && event === 'pre-tool') respondDecision('allow')
    return
  }
  const projectDir = projectDirOf(input)

  // pane の名前を今の作業にそろえる（セッションの開始、プロンプト、ツールの実行のたび。作業が変わっても追いつく）。
  // 表示だけの処理なので、ガードの判断とは別の try にする（ここで例外が出ても、ガードを飛ばさない）
  if (event === 'session-start' || event === 'prompt' || event === 'pre-tool') {
    try {
      applyPaneTitle(projectDir)
    } catch {
      // 表示だけなので無視
    }
  }

  try {
    if (event === 'prompt') return

    if (event === 'session-start') {
      // resume と compact（作業の途中）では main を取り込まず、遅れを伝えるだけ（PR #68 のレビュー）
      const text = buildSessionContext({ projectDir, tool, sync: shouldSyncOnStart(input.source) })
      writeTrace(projectDir, { tool, event, session: input.session_id ?? input.conversationId })
      return respondContext(text)
    }

    if (event === 'pre-tool') {
      const action = normalize(input)
      const result =
        action.kind === 'command'
          ? decideCommand(action, input, projectDir)
          : action.kind === 'edit'
            ? decideEdit(action, projectDir)
            : action.kind === 'read'
              ? decideRead(action)
              : { decision: 'allow' }
      if (result.decision !== 'allow' || result.rule || (action.kind !== 'other' && action.kind !== 'read')) {
        writeTrace(projectDir, {
          tool,
          event,
          session: input.session_id ?? input.conversationId,
          agent: input.agent_type,
          kind: action.kind,
          command: action.command,
          files: action.files,
          decision: result.decision,
          rule: result.rule,
        })
      }
      return respondDecision(result.decision, result.reason)
    }

    if (event === 'post-edit') {
      const action = normalize(input)
      if (action.kind !== 'edit') return
      const problems = afterEdit(action, input, projectDir)
      let reminder
      try {
        reminder = copyReminder(action, input, projectDir)
      } catch {
        reminder = undefined // 思い出させるだけなので、失敗しても層のチェックの結果は返す
      }
      if (reminder) writeTrace(projectDir, { tool, event, session: input.session_id, decision: 'remind', rule: 'ui-copy-yomiyasu', files: action.files })
      if (problems.length > 0) {
        writeTrace(projectDir, { tool, event, session: input.session_id, decision: 'feedback', rule: 'arch', files: action.files })
        const reason = `設計方針のチェックで直すところがあります（docs/architecture/design-principles.md）：\n${problems.join('\n')}`
        print({ decision: 'block', reason: reminder ? `${reason}\n\n${reminder}` : reason })
      } else if (reminder) {
        print({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: reminder } })
      }
      return
    }

    if (event === 'stop') {
      const reason = stopCheck(input, projectDir)
      if (reason) {
        writeTrace(projectDir, { tool, event, session: input.session_id, decision: 'block', rule: 'commit-push' })
        print({ decision: 'block', reason })
      }
    }
  } catch (error) {
    writeTrace(projectDir, { tool, event, decision: 'error', error: String(error?.stack ?? error).slice(0, 500) })
    if (tool === 'agy' && event === 'pre-tool') respondDecision('allow')
  }
}

await main()
