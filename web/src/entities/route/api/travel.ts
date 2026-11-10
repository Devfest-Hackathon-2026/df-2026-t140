import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'
import type { RouteStop } from '../model/types'

/** Routes API（車）の移動時間で計算し直したしおり。画面に出すだけで、どこにも保存しない */
export interface ShioriTravel {
  status: 'routes'
  /** 計算に使ったルートの場所の並びと、組み直しの回数。今のしおりと同じときだけ使う */
  pinIds: string[]
  revision: number
  schedule: RouteStop[]
  totalMoveMinutes: number
  /** 区間ごとの道の形（key は「どこから>どこへ」。出発地は @origin）。取れた区間だけ。地図に出すだけで、保存しない */
  legPaths: { key: string; points: { lat: number; lng: number }[] }[]
  /** 開発環境の見本か（時刻は保存してある目安のまま、線は見本の曲線） */
  sample?: boolean
}

type Answer = ShioriTravel | { status: 'estimate'; reason: string }

/**
 * しおりの移動時間を Functions に聞く（functions/src/features/shiori-travel）。
 * 本番で、自分が合言葉を通しているときだけ Routes の時間が返る。そうでなければ null（保存してある目安を出す）。
 * 規約で Routes の時間は保存できないので、返ってきた値は画面のメモリーにだけ持つ
 */
export async function fetchShioriTravel(session: Session, tripId: string, routeId: string): Promise<ShioriTravel | null> {
  const { data } = await httpsCallable<{ tripId: string; routeId: string }, Answer>(session.functions, 'shioriTravel')({ tripId, routeId })
  return data.status === 'routes' ? { ...data, legPaths: Array.isArray(data.legPaths) ? data.legPaths : [] } : null
}
