// ガードの判断を残す（トレース）。失敗の原因が「LLM の判断」か「ツールの実装」かを後で切り分けるため。
// 中身は手元だけ（.harness/ は Git の管理外）。会話の全文は Claude Code の transcript_path にある。
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const clip = (text, length = 300) => (typeof text === 'string' && text.length > length ? `${text.slice(0, length)}…` : text)

export function writeTrace(projectDir, entry) {
  try {
    const dir = join(projectDir, '.harness', 'trace')
    mkdirSync(dir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    const record = { at: new Date().toISOString(), ...entry, command: clip(entry.command) }
    appendFileSync(join(dir, `${day}.jsonl`), `${JSON.stringify(record)}\n`)
  } catch {
    // 記録に失敗しても作業は止めない
  }
}

// このセッションで AI が書き換えたファイル（Stop のときに、commit し忘れを調べる）
function sessionFile(projectDir, sessionId) {
  return join(projectDir, '.harness', 'sessions', `${String(sessionId).replace(/[^\w-]/g, '_')}.json`)
}

export function rememberEdit(projectDir, sessionId, path) {
  if (!sessionId) return
  try {
    const file = sessionFile(projectDir, sessionId)
    mkdirSync(join(projectDir, '.harness', 'sessions'), { recursive: true })
    const edited = new Set(readEdits(projectDir, sessionId))
    edited.add(path)
    writeFileSync(file, JSON.stringify([...edited]))
  } catch {
    // 同上
  }
}

export function readEdits(projectDir, sessionId) {
  try {
    return JSON.parse(readFileSync(sessionFile(projectDir, sessionId), 'utf8'))
  } catch {
    return []
  }
}

export function summarizeTraces(projectDir, days = 7) {
  const counts = {}
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    let text = ''
    try {
      text = readFileSync(join(projectDir, '.harness', 'trace', `${day}.jsonl`), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const record = JSON.parse(line)
        const key = `${record.event}:${record.decision ?? '-'}:${record.rule ?? '-'}`
        counts[key] = (counts[key] ?? 0) + 1
      } catch {
        // 壊れた行は飛ばす
      }
    }
  }
  return counts
}
