import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * しおりから外した場所を、しおりに戻す（functions/src/features/restore-place）。
 * Functions がしおりの空いた位置に入れ、時刻と日を計算し直して保存する。時間に収まらなくても戻す。
 * 画面（全員の）は、ルートの購読で変わる。断られたとき（メンバーでない、確定中）は、エラーが投げられる
 */
export async function restorePlace(session: Session, tripId: string, pinId: string): Promise<void> {
  await httpsCallable(session.functions, 'restorePlace')({ tripId, pinId })
}
