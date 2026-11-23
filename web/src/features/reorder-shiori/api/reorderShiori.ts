import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * しおりの行（fromPinId）を、落とした先の行（toPinId）の位置に差し込む（functions/src/features/reorder-shiori）。
 * Functions が動かした順で時刻と日を計算し直して保存する。画面は、ルートの購読で新しいしおりを受け取る。
 * 断られたとき（メンバーでない、しおりにない場所）は、エラーが投げられる
 */
export async function reorderShiori(session: Session, tripId: string, routeId: string, fromPinId: string, toPinId: string): Promise<void> {
  await httpsCallable(session.functions, 'reorderShiori')({ tripId, routeId, fromPinId, toPinId })
}
