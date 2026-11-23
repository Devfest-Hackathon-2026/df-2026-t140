import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'

/**
 * しおりの空いた時間への提案を「入れる」。建築を頼む（functions/src/features/request-build。「建築する！」と同じ）。
 * 建つと、ふつうの建物として、しおりに入る（functions/src/features/propose-routes）。取り消すときは、建物を消す（remove-building）。
 * 断られたときは、理由の文（日本語）が入ったエラーが投げられる
 */
export async function includeFiller(session: Session, tripId: string, pinId: string): Promise<void> {
  await httpsCallable(session.functions, 'requestBuild')({ tripId, pinId })
}

/** しおりの空いた時間への提案を「無視」する（functions/src/features/dismiss-filler）。同じ場所は二度と提案されず、その日に次の提案が立つ */
export async function dismissFiller(session: Session, tripId: string, pinId: string): Promise<void> {
  await httpsCallable(session.functions, 'dismissFiller')({ tripId, pinId })
}
