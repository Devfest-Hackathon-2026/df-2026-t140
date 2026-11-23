import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'
import type { AppLanguage } from '@/shared/lib'
import type { TravelMode } from '../model/travelMode'

/** 旅の名前を考えるもとにするもの（Functions の features/suggest-title と同じ形）。旅の日程、出発地、乗り物、選んだ県 */
export interface TitleSeed {
  startDate: string
  endDate: string | null
  origin: string
  travelMode: TravelMode
  /** 選んだ県の名前 */
  prefectures: readonly string[]
  language?: AppLanguage
}

/**
 * 旅の名前を Gemini に考えてもらう（旅を確定するときのポップアップの「Gemini につけてもらう」。features/confirm-shiori）。
 * 本物の Gemini を使えないとき（合言葉を通していない、回数の上限）は、関数が季節と行き先から作った名前を返す
 */
export async function suggestTripTitle(session: Session, seed: TitleSeed): Promise<string> {
  // 関数の待ち時間（features/suggest-title の timeoutSeconds 330）に合わせる。手元の agy は 1 回最大 150 秒で、1 回やり直すことがある
  const call = httpsCallable<TitleSeed, { title: string }>(session.functions, 'suggestTripTitle', { timeout: 330_000 })
  const { data } = await call(seed)
  return data.title
}
