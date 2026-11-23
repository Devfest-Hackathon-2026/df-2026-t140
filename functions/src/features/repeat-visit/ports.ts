import type { Firestore } from 'firebase-admin/firestore'
import type { FlightsPort } from '../../ports/flights'

/** 同じ場所の行を足す・消す処理が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface RepeatVisitPorts {
  db: Firestore
  /** 飛行機の時刻表。組み直したあとに、便を探す飛行機の区間があるときだけ読む */
  flights: FlightsPort
}
