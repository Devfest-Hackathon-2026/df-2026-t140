import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { mealsAfterSkip } from '../../domain/meal'
import type { Route } from '../../domain/route'
import { tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'

export interface SetMealInput {
  tripId: string
  routeId: string
  uid: string
  /** どの日のどのごはんか（「1-lunch」。domain/meal.ts の mealKey） */
  slot: string
  /** true：お店を建てずに決める。false：それを取り消す（点線の枠に戻す） */
  skip: boolean
  /** 書いた言葉（「なし」「コンビニ」）。なければ null */
  note: string | null
}

export type SetMealResult = { status: 'changed'; revision: number } | { status: 'unchanged' | 'not-member' | 'not-found' | 'confirmed' | 'invalid' | 'decided' }

/**
 * しおりのごはんの枠を、お店を建てずに決めることと、その取り消し。読む → domain/meal.ts で決める → 書く。
 * メンバーなら誰でもできる（幹事だけにしない）。旅程が確定しているあいだは変えられない（confirmed）。お店を建物で決めるほうは、建ったときに features/propose-routes が入れる
 */
export async function setMeal(ports: { db: Firestore }, input: SetMealInput): Promise<SetMealResult> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(input.tripId)
  const routeRef = tripRef.collection('routes').doc(input.routeId)
  return db.runTransaction(async (tx): Promise<SetMealResult> => {
    const [tripSnapshot, memberSnapshot, routeSnapshot] = await Promise.all([
      tx.get(tripRef),
      tx.get(tripRef.collection('members').doc(input.uid)),
      tx.get(routeRef),
    ])
    if (!memberSnapshot.exists) return { status: 'not-member' }
    const trip = tripSnapshot.data() as Trip | undefined
    const route = routeSnapshot.data() as Route | undefined
    if (!trip || !route) return { status: 'not-found' }
    if (isConfirmed(trip)) return { status: 'confirmed' }
    const update = mealsAfterSkip(route, tripDays(trip.startDate, trip.endDate), input.slot, input.skip, input.note)
    if (typeof update === 'string') return { status: update }
    tx.update(routeRef, { ...update, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed', revision: update.revision }
  })
}
