import { FirebaseError } from 'firebase/app'
import { httpsCallable } from 'firebase/functions'
import type { Session } from '@/shared/api'
import { translate } from '@/shared/lib'

/** Functions（functions/src/features/change-trip-dates/handler.ts）が返す断りの文の英語版 */
const ENGLISH_REFUSAL: Readonly<Record<string, string>> = {
  'この旅のメンバーではありません': "You're not a member of this trip.",
  '日程を変えられるのは発案者だけです': 'Only the organizer can change the dates.',
  '旅程が確定しているので、変えられません': "The itinerary is finalized, so the dates can't be changed.",
}

/**
 * 旅の日程を変える。functions/src/features/change-trip-dates。発案者だけ。
 * Functions がしおりを新しい日程で組み直し、入りきらない場所をしおりから外す。leftOut は、今回外した場所の数。restored は、前に外していて今回しおりに戻した場所の数。
 * 断られたとき（発案者でない、確定している）は、エラーが投げられる
 */
export async function changeTripDates(session: Session, tripId: string, startDate: string, endDate: string | null): Promise<{ leftOut: number; restored: number }> {
  const result = await httpsCallable<unknown, { status: string; leftOut?: number; restored?: number }>(session.functions, 'changeTripDates')({ tripId, startDate, endDate })
  return { leftOut: result.data.leftOut ?? 0, restored: result.data.restored ?? 0 }
}

/** 断られた理由のうち、画面にそのまま出せる文（発案者でない、確定している）。ほかの失敗は null。英語で知らない文も null（ふつうの失敗の文を出す） */
export function refusalMessage(error: unknown): string | null {
  const known = error instanceof FirebaseError && ['functions/failed-precondition', 'functions/permission-denied'].includes(error.code)
  return known ? translate<string | null>(error.message, ENGLISH_REFUSAL[error.message] ?? null) : null
}
