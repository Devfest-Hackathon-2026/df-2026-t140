import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * 「建築する！」を Functions に頼む（functions/src/features/request-build）。
 * Functions が、ログイン、メンバーかどうか、旅ごとの上限（20 棟）を確かめて、ピンを「工事中」にして、すぐ返す。
 * 模型は裏で作られ、できたらピンが「完成」になる（ピンの購読で届く）。
 * 断られたときは、理由の文（日本語）が入ったエラーが投げられる。
 */
export async function requestBuild(session: Session, tripId: string, pinId: string): Promise<void> {
  await httpsCallable(session.functions, 'requestBuild')({ tripId, pinId })
}
