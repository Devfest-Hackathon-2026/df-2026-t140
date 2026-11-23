import type { Firestore } from 'firebase-admin/firestore'
import type { FlightsPort } from '../../ports/flights'

/** しおりに戻す処理が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface RestorePlacePorts {
  db: Firestore
  /** 飛行機の時刻表。戻したあとに、便を探す飛行機の区間があるときだけ読む */
  flights: FlightsPort
}
