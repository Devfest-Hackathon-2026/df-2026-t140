import { type Member, subscribeMembers } from '@/entities/member'
import { type Pin, subscribePins } from '@/entities/pin'
import { subscribeWishes, type Wish } from '@/entities/wish'
import type { Session, WithId } from '@/shared/api'

/** 旅 1 つぶんの、コレクションに出すのに要るもの */
export interface TripDetails {
  pins: WithId<Pin>[]
  members: WithId<Member>[]
  wishes: WithId<Wish>[]
}

/**
 * いくつかの旅のピン・メンバー・やりたいことを読み、どれかが変わるたびに、旅の ID ごとにまとめて渡す。
 * 全部の旅の 3 つがそろってから渡す。読めなかったものは空として扱う（1 つの旅が読めなくても、ほかの旅は出す）
 */
export function subscribeTripDetails(
  session: Session,
  tripIds: readonly string[],
  onData: (details: Record<string, TripDetails>) => void,
): () => void {
  const details: Record<string, Partial<TripDetails>> = {}
  const ready = (one: Partial<TripDetails> | undefined): one is TripDetails => Boolean(one?.pins && one.members && one.wishes)
  const deliver = () => {
    if (!tripIds.every((tripId) => ready(details[tripId]))) return
    onData(Object.fromEntries(tripIds.map((tripId) => [tripId, { ...(details[tripId] as TripDetails) }])))
  }
  if (tripIds.length === 0) onData({})
  const stops = tripIds.flatMap((tripId) => {
    const set = <K extends keyof TripDetails>(key: K, value: TripDetails[K]) => {
      details[tripId] = { ...details[tripId], [key]: value }
      deliver()
    }
    return [
      subscribePins(session, tripId, (pins) => set('pins', pins), () => set('pins', [])),
      subscribeMembers(session, tripId, (members) => set('members', members), () => set('members', [])),
      subscribeWishes(session, tripId, (wishes) => set('wishes', wishes), () => set('wishes', [])),
    ]
  })
  return () => stops.forEach((stop) => stop())
}
