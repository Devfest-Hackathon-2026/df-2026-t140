// 気象庁の府県天気予報（JSON）を取りに行く。URL は固定（https://www.jma.go.jp/bosai/forecast/data/forecast/{code}.json）。
// 送るのは府県予報区のコード（6 桁）だけ。キーや旅・人の情報は送らない。認証は要らない公開のデータ。
// - 取った結果は 30 分まで覚える（府県の予報は何度も出ない）。同じ府県を同時に聞くときは、1 回の取得にまとめる
// - 失敗（時間切れ、エラー、形が読めない）は覚えない。null を返し、呼ぶ側はその府県だけ抜く
// 出典・利用の条件は docs/records/credits.md に書く。

const BASE = 'https://www.jma.go.jp/bosai/forecast/data/forecast/'
/** 待つ長さ（ms）。しおりを開くのを待たせない */
const TIMEOUT_MS = 5_000
/** 覚えておく長さ（ms） */
const TTL_MS = 30 * 60 * 1000

const cache = new Map<string, { at: number; json: unknown }>()
const inFlight = new Map<string, Promise<unknown | null>>()

export function jmaForecastUrl(code: string): string {
  return `${BASE}${code}.json`
}

/**
 * 府県予報区の予報（JSON）を取る。取れなければ null。now はミリ秒（テストのために差し替えられる）
 */
export async function fetchJmaForecast(code: string, now: () => number = Date.now): Promise<unknown | null> {
  if (!/^\d{6}$/.test(code)) return null
  const hit = cache.get(code)
  if (hit && now() - hit.at < TTL_MS) return hit.json
  const pending = inFlight.get(code)
  if (pending) return pending
  const request = load(code)
    .then((json) => {
      if (json !== null) cache.set(code, { at: now(), json })
      return json
    })
    .finally(() => inFlight.delete(code))
  inFlight.set(code, request)
  return request
}

async function load(code: string): Promise<unknown | null> {
  try {
    const response = await fetch(jmaForecastUrl(code), { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) {
      console.warn(`気象庁の予報（${code}）が ${response.status} を返しました`)
      return null
    }
    const json: unknown = await response.json()
    return Array.isArray(json) ? json : null
  } catch (cause) {
    console.warn(`気象庁の予報（${code}）を取れませんでした`, cause)
    return null
  }
}

/** しおりの天気の処理（features/shiori-weather）に渡す実体 */
export const jmaForecast = {
  fetchOffice: (code: string) => fetchJmaForecast(code),
}
