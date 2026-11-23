import { useMemo } from 'react'
import { type Member, useMyMemberships } from '@/entities/member'
import { type ModelJson, modelKey, useModelsOfTrips } from '@/entities/model3d'
import type { Pin } from '@/entities/pin'
import { isPastTrip, type Trip, useTrips } from '@/entities/trip'
import { useSession, type WithId } from '@/shared/api'
import { today, useSubscription } from '@/shared/lib'
import { subscribeTripDetails, type TripDetails } from '../api/tripDetails'

/** コレクションの建物 1 つ（過去の旅で建った建物） */
export interface CollectionBuilding {
  /** 旅をまたいで 1 つに決まる名前（旅の ID と、ピンの ID） */
  key: string
  trip: WithId<Trip>
  pin: WithId<Pin>
  /** まだ読めていないあいだは null */
  model: ModelJson | null
  /** 希望を書いた人（旅を抜けた人は undefined） */
  wisher: WithId<Member> | undefined
  /** もとになったやりたいこと */
  wishText: string | null
}

/** 過去の旅 1 つと、その旅で建った建物（建った順） */
export interface CollectionTrip {
  trip: WithId<Trip>
  buildings: CollectionBuilding[]
}

const NONE: never[] = []
const NO_DETAILS: Record<string, TripDetails> = {}

/**
 * コレクションに出すもの（企画書「ユーザー体験」4）。自分が参加している旅のうち、過去の旅（確定していて、最終日を過ぎた旅）と、
 * その旅で建った建物。新しい旅が先。実際に行ったかどうかは記録していないので、建った建物をそのまま並べる
 */
export function useCollection() {
  const session = useSession()
  const memberships = useMyMemberships()
  const all = memberships.data ?? NONE
  const trips = useTrips(all.map(({ tripId }) => tripId))
  const date = today()
  const past = useMemo(() => {
    const list = Object.values(trips.data ?? {}).filter((trip): trip is WithId<Trip> => isPastTrip(trip, date))
    const last = (trip: Trip) => trip.endDate ?? trip.startDate
    return list.sort((a, b) => last(b).localeCompare(last(a)) || a.id.localeCompare(b.id))
  }, [trips.data, date])

  const ids = past.map((trip) => trip.id)
  const idsKey = ids.join(',')
  const details = useSubscription<Record<string, TripDetails>>(`${session.uid}/Collection/${idsKey}`, (onData) =>
    subscribeTripDetails(session, idsKey ? idsKey.split(',') : [], onData),
  )
  const detailsData = details.data ?? NO_DETAILS

  const refs = useMemo(
    () =>
      past.flatMap((trip) =>
        (detailsData[trip.id]?.pins ?? NONE).filter((pin) => pin.status === 'done').map((pin) => ({ tripId: trip.id, pinId: pin.id })),
      ),
    [past, detailsData],
  )
  const models = useModelsOfTrips(refs)

  const collection = useMemo<CollectionTrip[]>(
    () =>
      past.map((trip) => {
        const one = detailsData[trip.id]
        const buildings = (one?.pins ?? NONE)
          .filter((pin) => pin.status === 'done')
          .map((pin): CollectionBuilding => {
            const key = modelKey(trip.id, pin.id)
            return {
              key,
              trip,
              pin,
              model: models[key]?.json ?? null,
              wisher: one?.members.find((member) => member.id === pin.uid),
              wishText: one?.wishes.find((wish) => wish.id === pin.wishId)?.text ?? null,
            }
          })
        return { trip, buildings }
      }),
    [past, detailsData, models],
  )

  return {
    loading: memberships.loading || (all.length > 0 && trips.loading) || (ids.length > 0 && details.loading),
    failed: Boolean(memberships.error),
    trips: collection,
  }
}
