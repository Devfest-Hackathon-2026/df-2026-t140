import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * 地図を 1 つ作ったと Functions に伝える（functions/src/features/api-usage の countMapLoad）。
 * 地図の読み込みは画面から直接 Google に頼むので、使用量の表示（widgets/usage-panel）のために自分で数える。
 * 数えられなくても地図はそのまま使う（失敗は捨てる）
 */
export function countMapLoad(session: Session): void {
  httpsCallable(session.functions, 'countMapLoad')().catch(() => {})
}
