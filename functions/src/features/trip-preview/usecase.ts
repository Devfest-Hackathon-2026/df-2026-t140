import type { Firestore } from 'firebase-admin/firestore'
import { previewTitle } from './logic'
import type { TripPreviewResult } from './types'

/**
 * 招待された旅の名前を返す。旅の ID（招待 URL）を知っている人なら、メンバーでなくても聞ける。
 * 旅の ID を知っていれば参加もできるので、名前を返しても見える範囲は広がらない。
 * 返すのは名前だけにする（firestore.rules は参加前の人に旅を読ませない）。
 */
export async function previewTrip(ports: { db: Firestore }, input: { tripId: string }): Promise<TripPreviewResult> {
  const trip = await ports.db.collection('trips').doc(input.tripId).get()
  if (!trip.exists) return 'not-found'
  return { status: 'ok', title: previewTitle(trip.data()) }
}
