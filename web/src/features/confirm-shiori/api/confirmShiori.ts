import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'
import { translate } from '@/shared/lib'

const ENGLISH_REFUSAL: Readonly<Record<string, string>> = {
  'この旅のメンバーではありません': "You're not a member of this trip.",
  '旅程を確定・取り消しできるのは、発案者だけです': 'Only the organizer can finalize or reopen the itinerary.',
  'しおりにまだ場所がありません': 'Add a place before finalizing the itinerary.',
  '建物ができて、しおりに入ってから確定できます': 'Wait for building to finish before finalizing the itinerary.',
  '宿が決まっていない夜があります。宿を建てるか、過ごし方を書くと、確定できます': 'Choose lodging or write an overnight plan for each night before finalizing.',
}

/**
 * 旅程を確定する（confirm が true）・取り消す（false）。functions/src/features/confirm-shiori。発案者だけ。
 * Functions が旅に確定の印を付ける・消す。しおりの中身は変わらない。画面（全員の）は、旅の購読で変わる。
 * 断られたとき（発案者でない、場所がない、建物を作っている途中）は、エラーが投げられる
 */
export async function confirmShiori(session: Session, tripId: string, confirm: boolean): Promise<void> {
  await httpsCallable(session.functions, 'confirmShiori')({ tripId, confirm })
}

/** 断られた理由のうち、画面にそのまま出せる文（発案者でない、場所がない、建物を作っている途中）。ほかの失敗は null */
export function refusalMessage(error: unknown): string | null {
  const known = error instanceof FirebaseError && ['functions/failed-precondition', 'functions/permission-denied'].includes(error.code)
  return known ? translate(error.message, ENGLISH_REFUSAL[error.message] ?? null) : null
}
