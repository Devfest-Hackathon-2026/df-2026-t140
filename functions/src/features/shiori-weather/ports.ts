import type { Firestore } from 'firebase-admin/firestore'

/** しおりの天気が外の世界に頼むもの。handler が adapters の実体を渡す */
export interface ShioriWeatherPorts {
  db: Firestore
  /** 府県予報区のコードで、気象庁の予報（JSON）を聞く。取れなければ null */
  jma: { fetchOffice(code: string): Promise<unknown | null> }
}
