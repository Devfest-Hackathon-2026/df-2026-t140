// 人の許可を待たずに AI が進めてよい期間（harness.config.json の autonomousUntil）。
// 期間中は、ハーネスが人に確認を求める操作（ask）を止めずに通し、トレースに残す。
// 止める操作（deny：費用、有料 API、.env、権限、デプロイ、deploy ブランチへの反映、条件を満たさない merge など）は期間中も変えない。
// 期限を過ぎると自動でふだんに戻る。値を変えるのは人（todo/humans/ に記録する）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CONFIG_FILE = 'harness.config.json'

export function readAutonomy(projectDir, now = new Date()) {
  try {
    const config = JSON.parse(readFileSync(join(projectDir, CONFIG_FILE), 'utf8'))
    const until = config.autonomousUntil ? new Date(config.autonomousUntil) : undefined
    const active = Boolean(until) && !Number.isNaN(until.getTime()) && now < until
    return { active, until: config.autonomousUntil, decidedBy: config.decidedBy, record: config.record }
  } catch {
    return { active: false }
  }
}
