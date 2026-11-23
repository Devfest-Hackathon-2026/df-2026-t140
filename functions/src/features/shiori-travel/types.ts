import type { LatLng } from '../../domain/pin'
import type { RouteStop } from '../../domain/route'

export interface ShioriTravelInput {
  tripId: string
  /** 画面が出しているしおりのルート（ふつうは shiori。前の形で決まった旅は、決まったルート） */
  routeId: string
  /** 開いた人 */
  uid: string
}

/** Routes の時間で計算し直したスケジュール。画面に出すだけで、どこにも保存しない */
export interface ShioriTravelSchedule {
  status: 'routes'
  /** 計算に使ったルートの場所の並びと、組み直しの回数。画面は、今のしおりと同じときだけ使う */
  pinIds: string[]
  revision: number
  schedule: RouteStop[]
  totalMoveMinutes: number
  /** 区間ごとの道の形（key は「どこから>どこへ」。出発地は @origin）。取れた区間だけ。地図に出すだけで、保存しない */
  legPaths: { key: string; points: LatLng[] }[]
  /** 開発環境の見本か（時刻は保存してある目安のまま、線は見本の曲線） */
  sample?: boolean
}

export type ShioriTravelResult =
  | ShioriTravelSchedule
  /**
   * Routes を使わない（呼べる設定でない、合言葉を通していない、聞けなかった、旅の移動手段が電車・バス）。画面は保存してある目安を出す。
   * 電車・バスの旅は、保存してあるしおりが電車・バスの見積もり（domain/transit.ts）なので、車の Routes では計算し直さない
   */
  | { status: 'estimate'; reason: 'off' | 'locked' | 'unavailable' | 'transit' }
  /** 断る */
  | { status: 'not-member' }
  | { status: 'not-found' }
