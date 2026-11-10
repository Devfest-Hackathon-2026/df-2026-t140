// 各 AI ツールのアダプター（scripts/harness/hook.mjs）に、各ツールの公式の文書にある入力の形を渡して確かめる。
// Codex、Antigravity、Gemini CLI は、ツールそのものでは動かしていない（docs/process/tools.md）。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { repoRoot } from '../lib/proc.mjs'

const root = repoRoot(fileURLToPath(new URL('.', import.meta.url)))
const hook = fileURLToPath(new URL('../hook.mjs', import.meta.url))

function run(tool, event, payload) {
  const result = spawnSync(process.execPath, [hook, tool, event], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HARNESS_OFFLINE: '1' },
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim() ? JSON.parse(result.stdout) : undefined
}

const claudeBash = (command) => ({ session_id: 'test', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } })

test('Claude Code：危ない命令は deny と理由、ふつうの命令は何も返さない（通常の権限の流れ）', () => {
  const denied = run('claude', 'pre-tool', claudeBash('git push origin main'))
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /no-push-main/)
  assert.equal(run('claude', 'pre-tool', claudeBash('git status')), undefined)
  const ps = run('claude', 'pre-tool', { ...claudeBash("$env:USE_REAL_GEMINI = 'true'"), tool_name: 'PowerShell' })
  assert.equal(ps.hookSpecificOutput.permissionDecision, 'deny')
})

test('Claude Code：秘密情報のファイルの編集は deny', () => {
  const denied = run('claude', 'pre-tool', { session_id: 'test', cwd: root, tool_name: 'Write', tool_input: { file_path: `${root}/web/.env.local`, content: 'x' } })
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
})

test('Claude Code：編集の直後に層のチェックを返す', () => {
  // 実在しないファイルは読めないので何も返さない（落ちない）
  assert.equal(run('claude', 'post-edit', { session_id: 'test', cwd: root, tool_name: 'Write', tool_input: { file_path: `${root}/web/src/no-such-file.ts` } }), undefined)
})

test('Claude Code：一度止めたあとの Stop は止めない（ループしない）', () => {
  assert.equal(run('claude', 'stop', { session_id: 'test-stop', stop_hook_active: true }), undefined)
})

test('Codex：Bash の命令（文字列と配列）と apply_patch の編集', () => {
  const denied = run('codex', 'pre-tool', { session_id: 'c', cwd: root, tool_name: 'Bash', tool_input: { command: 'git push --force origin feat/x' } })
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
  const argv = run('codex', 'pre-tool', { session_id: 'c', cwd: root, tool_name: 'Bash', tool_input: { command: ['git', 'reset', '--hard'] } })
  assert.equal(argv.hookSpecificOutput.permissionDecision, 'deny')
  const patch = '*** Begin Patch\n*** Add File: web/.env.local\n+KEY=x\n*** End Patch'
  const edit = run('codex', 'pre-tool', { session_id: 'c', cwd: root, tool_name: 'apply_patch', tool_input: { command: patch } })
  assert.equal(edit.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(run('codex', 'pre-tool', { session_id: 'c', cwd: root, tool_name: 'Bash', tool_input: { command: 'npm run verify' } }), undefined)
})

test('Codex：シェルで包んだ配列の命令も、中身のスクリプトまで調べる（レビューで見つかった抜け道）', () => {
  for (const command of [['bash', '-lc', 'git push --no-verify origin main'], ['bash', '-lc', 'git commit --no-verify -m x'], ['sh', '-c', 'firebase deploy']]) {
    const denied = run('codex', 'pre-tool', { session_id: 'c', cwd: root, tool_name: 'Bash', tool_input: { command } })
    assert.equal(denied?.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(command))
  }
  assert.equal(run('codex', 'pre-tool', { session_id: 'c', cwd: root, tool_name: 'Bash', tool_input: { command: ['bash', '-lc', 'git status && npm run verify'] } }), undefined)
})

test('Codex：Edit と Write は file_path を調べる（パッチでない入力）', () => {
  const denied = run('codex', 'pre-tool', { session_id: 'c', cwd: root, tool_name: 'Write', tool_input: { file_path: `${root}/web/.env.local`, content: 'x' } })
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny')
})

test('Claude Code：Read と Grep で秘密情報のファイルを読まない。ふつうのファイルは読める', () => {
  const read = run('claude', 'pre-tool', { session_id: 'r', cwd: root, tool_name: 'Read', tool_input: { file_path: `${root}/web/.env.production.local` } })
  assert.equal(read.hookSpecificOutput.permissionDecision, 'deny')
  const grep = run('claude', 'pre-tool', { session_id: 'r', cwd: root, tool_name: 'Grep', tool_input: { pattern: 'KEY', path: 'functions/.env.konbu-devfest-hackathon-2026' } })
  assert.equal(grep.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(run('claude', 'pre-tool', { session_id: 'r', cwd: root, tool_name: 'Read', tool_input: { file_path: `${root}/web/.env.example` } }), undefined)
  assert.equal(run('claude', 'pre-tool', { session_id: 'r', cwd: root, tool_name: 'Read', tool_input: { file_path: `${root}/CLAUDE.md` } }), undefined)
})

test('Antigravity：通すときも必ず decision を返し、止めるときは deny と理由', () => {
  const allowed = run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'run_command', args: { CommandLine: 'git status', Cwd: root } } })
  assert.deepEqual(allowed, { decision: 'allow' })
  const denied = run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'run_command', args: { CommandLine: 'firebase deploy', Cwd: root } } })
  assert.equal(denied.decision, 'deny')
  assert.match(denied.reason, /no-deploy/)
  const edit = run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'write_to_file', args: { TargetFile: `${root}/.env` } } })
  assert.equal(edit.decision, 'deny')
  const writeFile = run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'write_file', args: { Path: `${root}/web/.env.local` } } })
  assert.equal(writeFile.decision, 'deny')
  const editFile = run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'edit_file', args: { Path: `${root}/functions/.env.local` } } })
  assert.equal(editFile.decision, 'deny')
  const readSecret = run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'read_file', args: { Path: `${root}/web/.env.production.local` } } })
  assert.equal(readSecret.decision, 'deny')
  assert.match(readSecret.reason, /no-secret-read/)
  assert.deepEqual(run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'read_file', args: { Path: `${root}/CLAUDE.md` } } }), { decision: 'allow' })
  assert.deepEqual(run('agy', 'pre-tool', { conversationId: 'a', workspacePaths: [root], toolCall: { name: 'view_file', args: {} } }), { decision: 'allow' })
})

test('Antigravity：入力が壊れていても、止めずに allow を返す（fail-closed のツールを止めない）', () => {
  const result = spawnSync(process.execPath, [hook, 'agy', 'pre-tool'], { input: '{壊れた JSON', encoding: 'utf8', cwd: root, timeout: 30_000 })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { decision: 'allow' })
})

test('Gemini CLI：run_shell_command と write_file', () => {
  const denied = run('gemini', 'pre-tool', { session_id: 'g', cwd: root, tool_name: 'run_shell_command', tool_input: { command: 'git commit --no-verify -m "feat: x"' } })
  assert.equal(denied.decision, 'deny')
  assert.deepEqual(run('gemini', 'pre-tool', { session_id: 'g', cwd: root, tool_name: 'run_shell_command', tool_input: { command: 'git status' } }), { decision: 'allow' })
  const edit = run('gemini', 'pre-tool', { session_id: 'g', cwd: root, tool_name: 'write_file', tool_input: { file_path: `${root}/functions/.env.local` } })
  assert.equal(edit.decision, 'deny')
})

test('セッションの始め：ツールごとの形で立ち位置を渡す（Claude 以外には CLAUDE.md も渡す）', () => {
  const claude = run('claude', 'session-start', { session_id: 's', cwd: root, source: 'startup' })
  assert.match(claude.hookSpecificOutput.additionalContext, /立ち位置/)
  assert.doesNotMatch(claude.hookSpecificOutput.additionalContext, /CLAUDE\.md（ルールの原本）の全文/)
  const codex = run('codex', 'session-start', { session_id: 's', cwd: root, source: 'startup' })
  assert.match(codex.hookSpecificOutput.additionalContext, /CLAUDE\.md（ルールの原本）の全文/)
  const agy = run('agy', 'session-start', { conversationId: 's', workspacePaths: [root] })
  assert.match(agy.injectSteps[0].systemMessage.systemMessage, /立ち位置/)
})
