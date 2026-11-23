// Emulator に開発用の初期データを入れる。本番には使わない。
//
// 見本の旅を 1 つ置く。http://localhost:5173/t/demo-shinshu を開いて名前を入れると、
// 2 人（あき、みお）がもう参加している旅に入れる。人名と地名は画面のイメージ用の仮のもの。
// 旅には、やりたいこと 3 つと、建った場所 3 つ、しおりも入れておく（しおりの並べ替えなどを、建てずにすぐ試せる）。
// しおりの時刻は、Functions と同じ計算（functions/lib の domain/routePlan）で作る。npm run dev は先に build するので、lib はある
//
// コレクション（企画書「ユーザー体験」4）を確かめるための、過去の旅も 2 つ置く（demo-past-shikoku、demo-past-hokkaido）。
// どちらも旅程を確定してあり、最終日を過ぎている。それぞれの URL を開いて名前を入れると、ホームの「過去の旅」とコレクションに並ぶ
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PROJECT_ID = 'konbu-devfest-hackathon-2026'
// 2 組目の Emulator（npm run dev:alt）では、ポートを全部この数だけずらす
const OFFSET = Number(process.env.EMULATOR_PORT_OFFSET ?? 0)
const BASE = `http://127.0.0.1:${8080 + OFFSET}/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const TRIP_ID = 'demo-shinshu'

async function waitForFirestore() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch(`http://127.0.0.1:${8080 + OFFSET}/`)
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw new Error('Firestore Emulator が起動しませんでした')
}

const text = (value) => ({ stringValue: value })
const time = (offsetMs = 0) => ({ timestampValue: new Date(Date.now() + offsetMs).toISOString() })
const none = { nullValue: null }

// Emulator では「Bearer owner」が管理者の扱いになり、ルールを通らずに書ける
async function put(path, fields) {
  const response = await fetch(`${BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!response.ok) throw new Error(`初期データを入れられませんでした（${path}：${response.status}）`)
}

const number = (value) => (Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value })
const map = (fields) => ({ mapValue: { fields } })
/** JSON の値を、Firestore の REST の値の形にする（模型の JSON 用） */
const jsonValue = (value) =>
  value === null || value === undefined ? none
    : typeof value === 'string' ? text(value)
    : typeof value === 'number' ? number(value)
    : typeof value === 'boolean' ? { booleanValue: value }
    : Array.isArray(value) ? { arrayValue: { values: value.map(jsonValue) } }
    : map(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)])))

/** 見本の場所の模型。functions/lib がなければ入れない（画面は予備の家を出す） */
function modelFor(place) {
  try {
    const { PREBUILT_MODELS } = require('../functions/lib/features/build-model/logic/prebuilt.js')
    const entry = PREBUILT_MODELS.find((item) => item.identity?.name === place.name)
    if (entry) return { json: entry.model.json, source: entry.model.source ?? 'argon' }
    const { prefabFor } = require('../functions/lib/features/build-model/logic/index.js')
    return { json: prefabFor(place.category), source: 'parts' }
  } catch {
    return null
  }
}
const array = (values) => ({ arrayValue: { values } })
const toValue = (value) => (value === null ? none : typeof value === 'number' ? number(value) : typeof value === 'boolean' ? { booleanValue: value } : text(value))

await waitForFirestore()

const members = [
  { uid: 'seed-aki', displayName: 'あき', color: '#3d4a8f' },
  { uid: 'seed-mio', displayName: 'みお', color: '#c9571e' },
]

/**
 * 見本の旅を 1 つ入れる。やりたいことと、それで建った場所は、建てる処理（Functions）を通さず、建った状態で置く。
 * confirmed なら、発案者（あき）が旅程を確定した旅にする
 */
async function seedTrip({ id, title, startDate, endDate, places, confirmed = false }) {
  await put(`trips/${id}`, {
    title: text(title),
    startDate: text(startDate),
    endDate: text(endDate),
    origin: text('東京駅'),
    status: text('planning'),
    decidedRouteId: none,
    createdBy: text('seed-aki'),
    ...(confirmed ? { confirmed: map({ uid: text('seed-aki'), at: time() }) } : {}),
    createdAt: time(),
    updatedAt: time(),
  })
  for (const [index, member] of members.entries()) {
    await put(`trips/${id}/members/${member.uid}`, {
      uid: text(member.uid),
      displayName: text(member.displayName),
      color: text(member.color),
      votedRouteId: none,
      joinedAt: time(index),
    })
  }
  for (const [index, place] of places.entries()) {
    const wishId = `${place.id}-wish`
    await put(`trips/${id}/wishes/${wishId}`, { uid: text(place.uid), text: text(place.wish), bounds: none, status: text('done'), createdAt: time(index) })
    await put(`trips/${id}/pins/${place.id}`, {
      wishId: text(wishId),
      uid: text(place.uid),
      name: text(place.name),
      description: text(''),
      area: text(place.area ?? '長野県'),
      category: text(place.category),
      location: map({ lat: number(place.lat), lng: number(place.lng) }),
      status: text('done'),
      suggestedBy: text('stub'),
      placeId: none,
      builtBy: text(place.uid),
      buildStartedAt: time(index),
      createdAt: time(index),
      updatedAt: time(index),
    })
    // 建物の模型。建物辞書（Functions の prebuilt.ts。本物の Gemini で作って検査した模型）に同じ名前があればそれを、なければ種類に合う部品の模型を入れる。
    // 入れないと、画面は全部同じ予備の家を出す
    const model = modelFor(place)
    if (model) await put(`trips/${id}/pins/${place.id}/model/current`, { json: jsonValue(model.json), source: text(model.source), createdAt: time(index) })
  }

  // しおり。Functions が作るのと同じ決め（移動が短い順に並べ、その時間の決め）で、順番と時刻と日を計算する
  try {
    const { buildPlan, proposeOrders, STYLE_TIMINGS, tripDays } = require('../functions/lib/domain/routePlan.js')
    const { originLocation } = require('../functions/lib/domain/originPlaces.js')
    const origin = { name: '東京駅', location: originLocation('東京駅') }
    const built = places.map((place) => ({ id: place.id, name: place.name, location: { lat: place.lat, lng: place.lng }, uid: place.uid }))
    const order = proposeOrders(built, origin).shortest
    const plan = buildPlan(order, origin, tripDays(startDate, endDate), STYLE_TIMINGS.shortest)
    await put(`trips/${id}/routes/shiori`, {
      label: text('A'),
      style: text('shortest'),
      catchphrase: text(''),
      pinIds: array(order.map((place) => text(place.id))),
      schedule: array(plan.schedule.map((stop) => map(Object.fromEntries(Object.entries(stop).map(([key, value]) => [key, toValue(value)]))))),
      totalMoveMinutes: number(plan.totalMoveMinutes),
      totalDistanceKm: number(plan.totalDistanceKm),
      originIncluded: { booleanValue: plan.originIncluded },
      proposedBy: text('stub'),
      generation: number(1),
      revision: number(0),
      addedPinIds: array([]),
      createdAt: time(),
      updatedAt: time(),
    })
    return `しおり（${title}）：${order.map((place) => place.name).join(' → ')}`
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error
    return 'しおりは入れませんでした（functions/lib がありません。先に npm run build を実行してください）'
  }
}

console.log(
  await seedTrip({
    id: TRIP_ID,
    title: '秋の信州ふらり旅',
    startDate: '2026-11-21',
    endDate: '2026-11-22',
    places: [
      { id: 'seed-wasabi', wish: 'わさび畑を見たい', uid: 'seed-aki', name: '大王わさび農場', category: 'farm', lat: 36.3364, lng: 137.9067 },
      { id: 'seed-shirahone', wish: '温泉に入りたい', uid: 'seed-mio', name: '白骨温泉', category: 'onsen', lat: 36.1497, lng: 137.6297 },
      { id: 'seed-utsukushi', wish: '星空を見たい', uid: 'seed-aki', name: '美ヶ原高原', category: 'nightview', lat: 36.2236, lng: 138.1078 },
    ],
  }),
)

// 過去の旅（コレクション用）。旅程を確定してあり、最終日を過ぎている。人名と地名は画面のイメージ用の仮のもの
const PAST_TRIPS = [
  {
    id: 'demo-past-shikoku',
    title: '夏の四国めぐり',
    startDate: '2026-08-08',
    endDate: '2026-08-10',
    places: [
      { id: 'seed-dogo', wish: '古い温泉に入りたい', uid: 'seed-mio', name: '道後温泉本館', category: 'onsen', area: '愛媛県松山市', lat: 33.8521, lng: 132.7864 },
      { id: 'seed-kochijo', wish: 'お城の天守にのぼりたい', uid: 'seed-aki', name: '高知城', category: 'shrine', area: '高知県高知市', lat: 33.5607, lng: 133.5314 },
      { id: 'seed-naruto', wish: '渦潮を見たい', uid: 'seed-aki', name: '鳴門の渦潮', category: 'nature', area: '徳島県鳴門市', lat: 34.238, lng: 134.641 },
      { id: 'seed-udon', wish: '本場のうどんを食べたい', uid: 'seed-mio', name: '讃岐うどんの店', category: 'food', area: '香川県高松市', lat: 34.3401, lng: 134.0434 },
    ],
  },
  {
    id: 'demo-past-hokkaido',
    title: '冬の北海道',
    startDate: '2026-02-07',
    endDate: '2026-02-09',
    places: [
      { id: 'seed-tokeidai', wish: '札幌の街を歩きたい', uid: 'seed-aki', name: '札幌市時計台', category: 'town', area: '北海道札幌市', lat: 43.0626, lng: 141.3536 },
      { id: 'seed-otaru', wish: '運河の夜を歩きたい', uid: 'seed-mio', name: '小樽運河', category: 'town', area: '北海道小樽市', lat: 43.199, lng: 141.0016 },
      { id: 'seed-moiwa', wish: '夜景を見たい', uid: 'seed-mio', name: '藻岩山', category: 'nightview', area: '北海道札幌市', lat: 43.0225, lng: 141.3222 },
      { id: 'seed-jozankei', wish: '雪見の温泉に入りたい', uid: 'seed-aki', name: '定山渓温泉', category: 'onsen', area: '北海道札幌市', lat: 42.965, lng: 141.1639 },
      { id: 'seed-furano', wish: '雪の牧場を見たい', uid: 'seed-aki', name: '富良野の牧場', category: 'farm', area: '北海道中富良野町', lat: 43.4186, lng: 142.427 },
    ],
  },
]
for (const trip of PAST_TRIPS) console.log(await seedTrip({ ...trip, confirmed: true }))

console.log(`初期データを入れました（見本の旅：http://localhost:${5173 + OFFSET}/t/${TRIP_ID}）`)
console.log(`過去の旅（コレクション用。開いて名前を入れると、ホームの「過去の旅」に並びます）：${PAST_TRIPS.map((trip) => `http://localhost:${5173 + OFFSET}/t/${trip.id}`).join('、')}`)
