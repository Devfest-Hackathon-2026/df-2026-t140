import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { firestore } from '../../adapters/firestore'
import { odptFlights } from '../../adapters/odpt'
import { LODGING_NOTE_MAX } from '../../domain/route'
import { LODGING_NIGHT_MAX } from '../../domain/wish'
import { sameLodging, setLodging as set } from './usecase'

const ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * しおりの宿の枠で、宿を取らない夜にする（過ごし方を自分で書ける）ことと、その取り消し。same が true なら、その夜を前の夜と同じ宿にする。
 * ルートを書くのは Functions だけ（firestore.rules）なので、画面から呼ぶ。
 * 外の API は、同じ宿にして組み直したときに便を探す飛行機の区間があれば、時刻表（ODPT。料金はかからない）を読むだけ。その待ち（最大 20 秒）が収まる長さにする
 */
export const setLodging = onCall({ timeoutSeconds: 60 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  const { tripId, routeId, night, skip, note, same } = (request.data ?? {}) as Record<string, unknown>
  const valid =
    typeof tripId === 'string' && ID.test(tripId) && typeof routeId === 'string' && ID.test(routeId)
    && typeof night === 'number' && Number.isInteger(night) && night >= 1 && night <= LODGING_NIGHT_MAX
    && (same === true || typeof skip === 'boolean')
    && (note === undefined || note === null || (typeof note === 'string' && note.trim().length <= LODGING_NOTE_MAX))
  if (!valid) throw new HttpsError('invalid-argument', '旅としおりと、何日目の夜かを指定してください')
  const result =
    same === true
      ? await sameLodging({ db: firestore(), flights: odptFlights }, { tripId, routeId, night, uid: request.auth.uid })
      : await set({ db: firestore() }, { tripId, routeId, night, skip: skip as boolean, note: typeof note === 'string' ? note : null, uid: request.auth.uid })
  if (result.status === 'not-member') throw new HttpsError('permission-denied', 'この旅のメンバーではありません')
  return result
})
