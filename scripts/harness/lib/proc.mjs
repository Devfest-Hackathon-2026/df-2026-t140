// 外部コマンドを、必ず上限時間つきで呼ぶ。
// 停止条件の順序は「無応答（ここ）< フックの timeout < エージェント全体の上限」。
// 値を変えるときは docs/process/ops-checklist.md の表も直す。
import { spawnSync } from 'node:child_process'

export const TIMEOUT_MS = {
  local: 10_000, // git の手元の操作
  network: 6_000, // git fetch、gh（無応答で止まる時間。フックの timeout より短くする）
}

export function run(cmd, args, { cwd, timeout = TIMEOUT_MS.local, input, env } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    input,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    ok: result.status === 0 && !result.error,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
    missing: result.error?.code === 'ENOENT',
  }
}

export const git = (args, options = {}) => run('git', args, options)

export const gh = (args, options = {}) => run('gh', args, { timeout: TIMEOUT_MS.network, ...options })

export function gitOut(args, options) {
  const result = git(args, options)
  return result.ok ? result.stdout.trim() : undefined
}

export function currentBranch(cwd) {
  return gitOut(['branch', '--show-current'], { cwd }) ?? ''
}

export function repoRoot(cwd) {
  return gitOut(['rev-parse', '--show-toplevel'], { cwd })
}
