import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { searchingFlights } from '../../domain/flightPlanner'
import { knownOriginLocation } from '../../domain/originPlaces'
import { stationLocation } from '../../domain/stations'
import type { Pin } from '../../domain/pin'
import type { Route } from '../../domain/route'
import { tripDays } from '../../domain/routePlan'
import { isConfirmed, type Trip } from '../../domain/trip'
import { travelModeOf } from '../../domain/travelMode'
import { type OriginPoint, validLocation } from '../../domain/tripOrigin'
import type { AiGatePort } from '../../ports/aiGate'
import type { FlightsPort } from '../../ports/flights'
import type { PlacesApiPort } from '../../ports/places-api'
import { routeWithOrigin } from './logic'

interface Ports { db: Firestore; aiGate: AiGatePort; placesApi: PlacesApiPort }
export type ResolveResult = { status: 'resolved'; point: OriginPoint } | { status: 'unavailable' | 'not-found' }

/**
 * 既知の名前はAPIを呼ばない。未知の名前だけ既存のPlacesと合言葉の条件で調べる。
 * 既知の名前は、出発地の表（domain/originPlaces.ts）と、全国の駅の表（domain/stations.ts。「浜田山駅」など）
 */
export async function resolveOrigin(ports: Ports, name: string, uid: string): Promise<ResolveResult> {
  const known = knownOriginLocation(name) ?? stationLocation(name)
  if (known) return { status: 'resolved', point: { name, location: known, placeId: null } }
  if (!ports.placesApi.enabled()) return { status: 'unavailable' }
  if (!(await ports.aiGate.isOpenToAll()) && !(await ports.aiGate.isUnlocked(uid))) return { status: 'unavailable' }
  const found = await ports.placesApi.findPlace({ text: name })
  if (!found || !validLocation(found.location)) return { status: 'not-found' }
  return { status: 'resolved', point: { name, ...found } }
}

/**
 * 集合場所を変え、しおりを組み直す。飛行機の区間（集合場所からの区間が遠い・島への区間で飛行機になった、など）があるときだけ、
 * 時刻表（ODPT）を読んで便を決め直す（searchingFlights。そのときはトランザクションをやり直す）
 */
export async function changeOrigin(ports: Ports & { flights: FlightsPort }, input: { tripId: string; uid: string; name: string; expectedOrigin: string }) {
  const tripRef = ports.db.collection('trips').doc(input.tripId)
  const memberRef = tripRef.collection('members').doc(input.uid)
  const [before, membership] = await Promise.all([tripRef.get(), memberRef.get()])
  if (!membership.exists) return { status: 'not-member' as const }
  if (!before.exists) return { status: 'not-found' as const }
  if (before.data()?.origin !== input.expectedOrigin) return { status: 'conflict' as const }
  // 旅程が確定しているあいだは、集合場所を変えない（features/confirm-shiori）。Places を呼ぶ前に断る
  if (isConfirmed(before.data() as Trip)) return { status: 'confirmed' as const }
  const resolved = await resolveOrigin(ports, input.name, input.uid)
  if (resolved.status !== 'resolved') return resolved
  return searchingFlights(() => ports.flights.timetable(), (search) => ports.db.runTransaction(async (tx) => {
    const [tripNow, memberNow, routes, pins] = await Promise.all([
      tx.get(tripRef), tx.get(memberRef), tx.get(tripRef.collection('routes')),
      tx.get(tripRef.collection('pins').where('status', '==', 'done')),
    ])
    const trip = tripNow.data() as Trip | undefined
    if (!memberNow.exists) return { status: 'not-member' as const }
    if (!trip) return { status: 'not-found' as const }
    if (trip.origin !== input.expectedOrigin) return { status: 'conflict' as const }
    if (isConfirmed(trip)) return { status: 'confirmed' as const }
    const places = pins.docs.map((doc) => ({ ...doc.data() as Pin, id: doc.id }))
    // 旅の開始日も渡す（時刻が決まったイベントを開催日の日に固定するため。domain/tripOrigin.ts と同じ。#581）
    const origin = { name: input.name, location: resolved.point.location, travelMode: travelModeOf(trip), startDate: trip.startDate }
    for (const doc of routes.docs) {
      const route = doc.data() as Route
      // 集合場所が変わると、集合場所からの区間の便に間に合うかが変わるので、便を決め直す
      const flights = search(origin, trip.startDate, route.legFlights, true)
      tx.update(doc.ref, { ...routeWithOrigin(route, places, origin, tripDays(trip.startDate, trip.endDate), flights), updatedAt: FieldValue.serverTimestamp() })
    }
    tx.update(tripRef, { origin: input.name, originPoint: resolved.point, updatedAt: FieldValue.serverTimestamp() })
    return { status: 'changed' as const }
  }))
}
