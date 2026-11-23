import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { CATALOGUE } from '../../domain/catalogue'
import { CATALOGUE_EN } from '../../domain/catalogueEnglish'
import { BUILD_LIMIT_PER_TRIP, BUILT_STATUSES, FILLER_WISH_ID, isOpenFiller, type Pin } from '../../domain/pin'
import { allowedPrefectures } from '../../domain/region'
import { type Route, SHIORI_ROUTE_ID } from '../../domain/route'
import { routeTiming, tripDays } from '../../domain/routePlan'
import { daySlacks } from '../../domain/slack'
import { travelModeOf } from '../../domain/travelMode'
import { isConfirmed, type Trip } from '../../domain/trip'
import { type OpenFiller, planFillers } from './logic'

/**
 * しおりの空いた時間への提案を、今のしおりに合わせて立て直す。読む → logic で決める → 書く（#520）。
 * - 見るのは、計画中の旅のしおり（SHIORI_ROUTE_ID）か、前の形で決まった旅の決まったルート
 * - 旅程が確定しているあいだ、しおりがないとき、建物が上限に達しているときは、提案を立てず、今ある提案も消す
 * - 書くのはピンだけ（ルートには書かない）。ピンの候補の変化では、ルートの組み直し（features/propose-routes）は動かないので、繰り返さない
 */
export async function refreshFillers(ports: { db: Firestore }, tripId: string): Promise<{ created: number; removed: number }> {
  const { db } = ports
  const tripRef = db.collection('trips').doc(tripId)
  const [tripSnapshot, pinsSnapshot] = await Promise.all([tripRef.get(), tripRef.collection('pins').get()])
  const trip = tripSnapshot.data() as Trip | undefined
  if (!trip) return { created: 0, removed: 0 }
  const routeId = trip.status === 'decided' && trip.decidedRouteId ? trip.decidedRouteId : SHIORI_ROUTE_ID
  const route = (await tripRef.collection('routes').doc(routeId).get()).data() as Route | undefined

  const pins = pinsSnapshot.docs.map((snapshot) => ({ id: snapshot.id, pin: snapshot.data() as Pin }))
  const open: OpenFiller[] = pins
    .filter(({ pin }) => isOpenFiller(pin))
    .map(({ id, pin }) => ({ id, day: pin.filler?.day ?? 0, name: pin.name, category: pin.category, location: pin.location }))
  const built = pins.filter(({ pin }) => BUILT_STATUSES.includes(pin.status)).length
  const timing = route ? routeTiming(route) : null
  const days = tripDays(trip.startDate, trip.endDate)
  const { create, remove } = planFillers({
    slacks: route && timing ? daySlacks(route, days, timing.startMinutes) : [],
    locationOf: (pinId) => pins.find((item) => item.id === pinId)?.pin.location,
    takenNames: new Set(pins.map(({ pin }) => pin.name)),
    allowed: allowedPrefectures(trip),
    catalogue: CATALOGUE,
    timing: timing ?? routeTiming({ style: 'shortest' }),
    travelMode: travelModeOf(trip),
    open,
    enabled: Boolean(route) && !isConfirmed(trip) && built < BUILD_LIMIT_PER_TRIP,
  })
  if (create.length === 0 && remove.length === 0) return { created: 0, removed: 0 }

  const batch = db.batch()
  // 読んだあとに誰かが建て始めた（候補でなくなった）提案は消さない。読んだときから変わっていれば、まとめて書くのをやめる（次の変化でやり直す）
  for (const id of remove) {
    const snapshot = pinsSnapshot.docs.find((item) => item.id === id)
    batch.delete(tripRef.collection('pins').doc(id), snapshot ? { lastUpdateTime: snapshot.updateTime } : {})
  }
  for (const { id, day, entry } of create) {
    const english = CATALOGUE_EN[entry.name]
    const pin: Omit<Pin, 'createdAt' | 'updatedAt'> = {
      wishId: FILLER_WISH_ID,
      // 誰のやりたいことでもない。建てた人のやりたいことになる（features/request-build）
      uid: '',
      name: entry.name,
      description: entry.description,
      area: `${entry.pref}${entry.city}`,
      ...(english ? { nameEn: english[0], areaEn: english[1], descriptionEn: english[2] } : {}),
      category: entry.category,
      location: { lat: entry.lat, lng: entry.lng },
      status: 'candidate',
      // 見本の場所の一覧から選んだ（本物の Gemini ではない）。場所カードでそう分かるようにする
      suggestedBy: 'stub',
      filler: { day },
      placeId: null,
      builtBy: null,
      buildStartedAt: null,
    }
    // create にする：同じ ID のピンがもうあれば（ほかの立て直しが先に作り、誰かが建て始めた）、まとめて書くのをやめる（候補に戻さない）
    batch.create(tripRef.collection('pins').doc(id), { ...pin, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  }
  await batch.commit()
  return { created: create.length, removed: remove.length }
}
