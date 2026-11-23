import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * 建った建物を消す（functions/src/features/remove-building）。
 * Functions がピンと模型を消し、しおりから外して、残りの順で時刻と日を計算し直して保存する。
 * 画面（全員の）は、ピンとルートの購読で変わる。断られたとき（メンバーでない、まだ建っていない）は、エラーが投げられる
 */
export async function removeBuilding(session: Session, tripId: string, pinId: string): Promise<void> {
  await httpsCallable(session.functions, 'removeBuilding')({ tripId, pinId })
}
