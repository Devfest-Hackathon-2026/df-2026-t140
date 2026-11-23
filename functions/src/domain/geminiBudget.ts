// Cloud の Gemini（Vertex AI）を呼ぶ回数の上限と、呼んでよいかの判断。純粋な判断だけを置く。
// 数える・記録する I/O は adapters/aiGate.ts。手元の agy の上限は別（domain/agyBudget.ts）。
//
// 数は技術構成の「費用の上限」（docs/architecture/sources/architecture.html）。
// Flash（場所の候補、しおりのルート）は累計 300 回まで（約 3 ドル）。Argon（模型）は 1 日 20 回・累計 300 回
// （ルートと模型も本物にする決定は todo/humans/2026-11-07-vertex-routes-model.md。累計は 80 回から 300 回に上げた：
// 審査員が本物の模型を見られないと困るため。Lazyturtle0852 の決定、todo/humans/2026-11-22-argon-total-300.md）。
// 予算アラートは通知だけで止まらないので、コード側で必ず止める（design-principles の cost/gemini-guarded）。

/** Flash（場所の候補、しおりのルート）を Vertex で呼ぶ累計の上限。2 つの機能で 1 つの数を分け合う */
export const FLASH_TOTAL_MAX = 300

/** 回数を記録するドキュメント。端末からは読み書きできない（firestore.rules） */
export const USAGE_COLLECTION = 'usage'
export const USAGE_FLASH_DOC = 'flash'
/** Argon の記録。count（累計）、day（日本時間の日付）、dayCount（その日の回数）を置く */
export const USAGE_ARGON_DOC = 'argon'

/** Argon（模型）を Vertex で呼ぶ 1 日の上限と累計の上限 */
export const ARGON_DAILY_MAX = 20
export const ARGON_TOTAL_MAX = 300

/**
 * 全員に本物を開く切り替え（settings/ai の openToAll）。人がコンソールで書き換える（デプロイ不要）。
 * true のときは合言葉を通していない人も関所を通す。回数の上限はそのまま効く
 * （かめの決定、todo/humans/2026-11-08-judges-real-gemini.md）。端末からは読み書きできない（firestore.rules）
 */
export const SETTINGS_COLLECTION = 'settings'
export const SETTINGS_AI_DOC = 'ai'

/** 記録の openToAll の値を読む。true のときだけ開く（壊れた値や文字列の "true" は開かない。費用側に倒す） */
export function readOpenToAll(value: unknown): boolean {
  return value === true
}

/** 合言葉を通した人の記録。本人だけが読める（firestore.rules）。書くのは Functions だけ */
export const AI_ACCESS_COLLECTION = 'aiAccess'

/** もう used 回使っていて、次の 1 回を呼んでよいか */
export function withinFlashBudget(used: number, max: number = FLASH_TOTAL_MAX): boolean {
  return Number.isFinite(used) && used >= 0 && used < max
}

/** 記録の count の値を回数にする。壊れていれば 0 ではなく上限扱い（費用側に倒す） */
export function readCount(value: unknown, max: number = FLASH_TOTAL_MAX): number {
  if (value === undefined || value === null) return 0
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : max
}

/**
 * Vertex の失敗が設定の誤り（401・403 は権限、404 はモデルがない）か。これだけは数えた 1 回を戻す。
 * 429（割り当て）、400、通信の失敗は戻さない（相手の側で処理が進んだかもしれないので、費用側に倒す）
 */
export function isVertexConfigFailure(status: unknown): boolean {
  return status === 401 || status === 403 || status === 404
}

/**
 * 1 回戻したあとの count。記録の生の値を受け取る。0 より下にしない。
 * まともな count（0 以上の整数で上限以下）でなければ null を返し、何も書かない。
 * 壊れた記録を readCount の上限扱いから 1 減らすと、上限より下に戻ってまた呼べてしまう（費用側に倒す）
 */
export function refundedCount(value: unknown, max: number = FLASH_TOTAL_MAX): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return null
  return Math.max(0, value - 1)
}

export type AiGateDecision = 'ok' | 'locked' | 'exhausted'

/**
 * 本物（vertex）を呼んでよいか。合言葉を通していなければ locked、上限なら exhausted。
 * 順番に意味がある：合言葉を通していない人の希望では、回数を消費しない
 */
export function decideAiGate(input: { unlocked: boolean; reserved: boolean }): AiGateDecision {
  if (!input.unlocked) return 'locked'
  if (!input.reserved) return 'exhausted'
  return 'ok'
}

/**
 * 関所で合言葉を確かめる人の一覧。重なりと空の値を除き、渡した順に並べる。
 * 誰か 1 人が合言葉を通していれば印を付けてよい（旅は友人どうしで、幹事だけに頼らない）
 */
export function gateCandidates(uids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(uids.filter((uid): uid is string => typeof uid === 'string' && uid.length > 0))]
}

/** 上限を数える日付（日本時間の YYYY-MM-DD）。日付が変わると 1 日の回数が 0 からになる */
export function budgetDay(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** usage/argon の記録。読んだ生の値なので型は決めない */
export interface ArgonRecord {
  count?: unknown
  day?: unknown
  dayCount?: unknown
}

export interface ArgonUsage {
  count: number
  day: string
  dayCount: number
}

/** 記録のうち、今日の回数。日付が今日でなければ 0。日付が壊れていれば上限扱い（費用側に倒す） */
function dayCountOf(record: ArgonRecord, today: string): number {
  if (record.day === undefined || record.day === null) {
    return record.dayCount === undefined || record.dayCount === null ? 0 : ARGON_DAILY_MAX
  }
  if (typeof record.day !== 'string') return ARGON_DAILY_MAX
  if (record.day !== today) return 0
  return readCount(record.dayCount, ARGON_DAILY_MAX)
}

/**
 * Argon を 1 回数えたあとの記録。1 日の上限か累計の上限に達していれば null（数えない）。
 * 壊れた値は上限扱い（readCount）なので、呼ばない側に倒れる
 */
export function reserveArgon(record: ArgonRecord, today: string): ArgonUsage | null {
  const count = readCount(record.count, ARGON_TOTAL_MAX)
  const dayCount = dayCountOf(record, today)
  // withinFlashBudget は上限を引数で受け取るので、Argon の数にもそのまま使える
  if (!withinFlashBudget(count, ARGON_TOTAL_MAX) || !withinFlashBudget(dayCount, ARGON_DAILY_MAX)) return null
  return { count: count + 1, day: today, dayCount: dayCount + 1 }
}

/**
 * Argon の 1 回を戻したあとの記録。書く項目だけを返す。何も書かないときは null。
 * - 累計がまともでなければ書かない（refundedCount と同じく、壊れた記録を上限より下に戻さない）
 * - 今日の記録なら今日の回数も 1 減らす。今日の回数が壊れていれば何も書かない
 * - 日付が変わったあとなら、累計だけを戻す
 */
export function refundArgon(record: ArgonRecord, today: string): { count: number; dayCount?: number } | null {
  const count = refundedCount(record.count, ARGON_TOTAL_MAX)
  if (count === null) return null
  if (record.day !== today) return { count }
  const dayCount = refundedCount(record.dayCount, ARGON_DAILY_MAX)
  if (dayCount === null) return null
  return { count, dayCount }
}
