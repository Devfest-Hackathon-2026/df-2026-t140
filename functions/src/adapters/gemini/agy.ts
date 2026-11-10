import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import {
  type AgyPool,
  budgetKey,
  DEFAULT_AGY_MAX_ARGON_CALLS,
  DEFAULT_AGY_MAX_CALLS,
  parseMaxCalls,
  withinBudget,
} from '../../domain/agyBudget'
import type { GeminiModel, GenerateText } from '../../ports/gemini'
import { ProviderUnavailableError } from './errors'

// GEMINI_PROVIDER=agy：ローカルの Functions Emulator から agy（Antigravity CLI）を子プロセスで呼び、
// 本物の Gemini を試す入口（docs/process/setup.md の「Gemini の切り替え」）。
//
// - Flash（場所の候補、ルート案）：gemini-3.8-flash-high（AGY_FLASH_MODEL で変えられる）
// - Argon（模型の JSON）：gemini-4-argon-medium（AGY_ARGON_MODEL で変えられる）。Flash より遅いので待ち時間を長くとる。
//   1 日の上限は AGY_MAX_ARGON_CALLS（既定 20。技術構成の Argon の上限）で、Flash とは別に数える
// - agy が入っていない環境（CI、本番）では「使えない」を返す。探す順：AGY_BIN → PATH → よくある置き場所
// - 回数の上限 AGY_MAX_CALLS（既定 30。domain/agyBudget.ts）：このプロセスで数えた回数と、OS の一時フォルダに
//   日付ごとに置く記録の回数の、大きいほうで判定する（Flash と Argon で別の記録）。Emulator を立て直しても、同じ日のうちは数が戻らない
// - 応答の検証、1 回のやり直し、固定の応答への戻しは index.ts が行う。ここは文を返すだけ
// - agy の --json-schema と --dangerously-skip-permissions は使わない。JSON の形は文で頼み、index.ts で確かめる
//
// agy の標準出力は JSON の封筒（最後の行）。{"status": "SUCCESS", "response": "<応答の文>", "usage": {...}}。
// 失敗のときは status が SUCCESS 以外で、error に理由が入る（~/.claude/skills/agy-text/scripts/agy_text.py と同じ読み方）。

const DEFAULT_FLASH_MODEL = 'gemini-3.8-flash-high'
const DEFAULT_ARGON_MODEL = 'gemini-4-argon-medium'

/**
 * agy 自身に待ってもらう時間と、子プロセスを打ち切る時間（agy の待ち時間より少し長く）。
 * Flash は 1 回 20〜40 秒が普通。Argon は模型の JSON が長いので長めにとる。
 * 呼び出し口が 1 回やり直すので、Argon の 2 回分（8 分）が建築のトリガーの時間（540 秒）に収まるようにする
 */
const TIMEOUTS: Record<AgyPool, { print: string; killAfterMs: number }> = {
  flash: { print: '2m', killAfterMs: 150_000 },
  argon: { print: '4m', killAfterMs: 255_000 },
}

/** 応答の文の大きさの上限（stdout） */
const MAX_BUFFER = 8 * 1024 * 1024

const CANDIDATE_PATHS = ['~/.local/bin/agy', '~/.antigravity/bin/agy', '/opt/homebrew/bin/agy', '/usr/local/bin/agy']

/**
 * agy はエージェント用の CLI なので、ツールを使おうとしたり、前置きを付けたりすることがある。
 * 各仕事の文（prompt.ts）は純粋なまま、agy に送るときだけこの決まりを足す。
 */
const OUTPUT_RULES =
  '\n\n# 出力のルール\n' +
  '- ツールは使わない。ファイルの読み書き、コマンドの実行、作業計画や作業報告はしない。\n' +
  '- 有効な JSON だけを出力する。コードフェンス、説明文、前置き、末尾の補足は付けない。\n'

function expandHome(path: string): string {
  return path.startsWith('~/') ? join(process.env.HOME ?? '', path.slice(2)) : path
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** agy の実行ファイルを探す。見つからなければ null（CI、本番） */
export function findAgy(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.AGY_BIN?.trim()
  if (fromEnv) {
    const path = expandHome(fromEnv)
    return isExecutable(path) ? path : null
  }
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const path = join(dir, 'agy')
    if (isExecutable(path)) return path
  }
  for (const candidate of CANDIDATE_PATHS) {
    const path = expandHome(candidate)
    if (isExecutable(path)) return path
  }
  return null
}

// ---- 回数の上限 ----

/** このプロセスで agy を起動した回数（打ち切り・失敗も数える。費用側に倒す） */
const callsInProcess: Record<AgyPool, number> = { flash: 0, argon: 0 }

/** 日付ごとの記録を置くフォルダ。テストでは AGY_BUDGET_DIR で別の場所にして、本当の記録を減らさない */
function budgetFile(pool: AgyPool): string {
  const dir = process.env.AGY_BUDGET_DIR?.trim() || tmpdir()
  return join(dir, budgetKey(new Date(), pool))
}

function readRecordedCalls(file: string): number {
  if (!existsSync(file)) return 0
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { count?: unknown }
    return typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? parsed.count : 0
  } catch {
    return 0
  }
}

function writeRecordedCalls(file: string, count: number): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, JSON.stringify({ count, updatedAt: new Date().toISOString() }))
  } catch (cause) {
    console.warn(`agy の回数の記録 ${file} を書けませんでした：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

/** これまでに数えた回数（プロセス内と記録の大きいほう） */
export function agyCallsUsed(pool: AgyPool = 'flash'): number {
  return Math.max(callsInProcess[pool], readRecordedCalls(budgetFile(pool)))
}

/** テスト用。プロセス内の数を 0 に戻す */
export function resetAgyCallsInProcess(): void {
  callsInProcess.flash = 0
  callsInProcess.argon = 0
}

/** 上限の中なら、1 回分を数えて、今の回数を返す。上限なら「使えない」を投げる（agy は起動しない） */
function reserveCall(pool: AgyPool, max: number): number {
  const file = budgetFile(pool)
  const used = Math.max(callsInProcess[pool], readRecordedCalls(file))
  if (!withinBudget(used, max)) {
    throw new ProviderUnavailableError(`agy の回数が上限（${maxCallsEnv(pool)}=${max}）に達しました。今日はもう ${used} 回呼んでいます`)
  }
  callsInProcess[pool] = used + 1
  writeRecordedCalls(file, callsInProcess[pool])
  return callsInProcess[pool]
}

function maxCallsEnv(pool: AgyPool): string {
  return pool === 'argon' ? 'AGY_MAX_ARGON_CALLS' : 'AGY_MAX_CALLS'
}

function maxCalls(pool: AgyPool): number {
  return pool === 'argon'
    ? parseMaxCalls(process.env.AGY_MAX_ARGON_CALLS, DEFAULT_AGY_MAX_ARGON_CALLS)
    : parseMaxCalls(process.env.AGY_MAX_CALLS, DEFAULT_AGY_MAX_CALLS)
}

// ---- 呼び出し ----

interface AgyEnvelope {
  status?: unknown
  response?: unknown
  error?: unknown
}

/** stdout の最後の行の JSON を読む。封筒でなければ例外 */
export function parseEnvelope(stdout: string): AgyEnvelope {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines.at(-1)
  if (!last) throw new Error('agy の標準出力が空です')
  return JSON.parse(last) as AgyEnvelope
}

function runAgy(bin: string, pool: AgyPool, model: string, prompt: string): Promise<string> {
  const { print, killAfterMs } = TIMEOUTS[pool]
  const args = ['--output-format', 'json', '--print-timeout', print, '--model', model, `-p=${prompt}`]
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: killAfterMs, maxBuffer: MAX_BUFFER, env: process.env }, (error, stdout, stderr) => {
      // 終了コードが 0 でなくても、封筒が出ていれば読む（agy は失敗の理由も封筒に書く）
      let envelope: AgyEnvelope
      try {
        envelope = parseEnvelope(String(stdout))
      } catch {
        const tail = `${String(stdout).slice(-600)}\n${String(stderr).slice(-600)}`.trim()
        reject(new ProviderUnavailableError(`agy が JSON を返しませんでした${error ? `（${error.message}）` : ''}：${tail}`))
        return
      }
      const text = typeof envelope.response === 'string' ? envelope.response : ''
      if (envelope.status !== 'SUCCESS' && !text) {
        reject(new ProviderUnavailableError(`agy が失敗しました：status=${String(envelope.status)} error=${String(envelope.error ?? '')}`))
        return
      }
      if (envelope.status !== 'SUCCESS') {
        console.warn(`agy の status が ${String(envelope.status)} でしたが、応答の文があるので使います：${String(envelope.error ?? '')}`)
      }
      resolve(text)
    })
  })
}

function modelName(model: GeminiModel): string {
  if (model === 'argon') return process.env.AGY_ARGON_MODEL?.trim() || DEFAULT_ARGON_MODEL
  return process.env.AGY_FLASH_MODEL?.trim() || DEFAULT_FLASH_MODEL
}

export const generateWithAgy: GenerateText = async (model, prompt) => {
  const pool: AgyPool = model === 'argon' ? 'argon' : 'flash'
  const name = modelName(model)
  const bin = findAgy()
  if (!bin) throw new ProviderUnavailableError('agy が入っていません（AGY_BIN か PATH で指定できます）')

  const max = maxCalls(pool)
  const count = reserveCall(pool, max)
  const startedAt = Date.now()
  try {
    const text = await runAgy(bin, pool, name, prompt + OUTPUT_RULES)
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.info(`agy（${name}）を呼びました：${seconds} 秒、今日 ${count} 回目（上限 ${max}）、応答 ${text.length} 文字`)
    return text
  } catch (cause) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1)
    console.warn(`agy（${name}）が失敗しました：${seconds} 秒、今日 ${count} 回目（上限 ${max}）`)
    throw cause
  }
}
