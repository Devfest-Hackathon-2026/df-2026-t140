import type { Firestore } from 'firebase-admin/firestore'
import type { FlightsPort } from '../../ports/flights'

/** しおりの順番を入れ替える処理が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface ReorderShioriPorts {
  db: Firestore
  /** 飛行機の時刻表。入れ替えたあとに、便を探す飛行機の区間があるときだけ読む */
  flights: FlightsPort
}
