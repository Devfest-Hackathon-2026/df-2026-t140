// ローカルの Emulator と本番に、同じ確認を行う。使い方：node scripts/smoke.mjs local|prod
import assert from 'node:assert/strict'

const PROJECT_ID = 'konbu-devfest-hackathon-2026'
const REGION = 'asia-northeast1'
// 2 組目の Emulator（npm run dev:alt）では、ポートを全部この数だけずらす
const EMULATOR_PORT_OFFSET = Number(process.env.EMULATOR_PORT_OFFSET ?? 0)
const mode = process.argv[2]
assert.ok(mode === 'local' || mode === 'prod', 'local か prod を指定してください')

const urls =
  mode === 'local'
    ? {
        site: `http://127.0.0.1:${5002 + EMULATOR_PORT_OFFSET}`,
        auth: `http://127.0.0.1:${9099 + EMULATOR_PORT_OFFSET}/identitytoolkit.googleapis.com/v1`,
        firestore: `http://127.0.0.1:${8080 + EMULATOR_PORT_OFFSET}/v1`,
        functions: `http://127.0.0.1:${5001 + EMULATOR_PORT_OFFSET}/${PROJECT_ID}/${REGION}`,
      }
    : {
        site: `https://${PROJECT_ID}.web.app`,
        auth: 'https://identitytoolkit.googleapis.com/v1',
        firestore: 'https://firestore.googleapis.com/v1',
        functions: `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`,
      }

const database = `projects/${PROJECT_ID}/databases/(default)/documents`

async function call(url, { body, token, method } = {}) {
  const response = await fetch(url, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = {}
  }
  return { status: response.status, text, json }
}

async function check(name, run) {
  await run()
  console.log(`ok - ${name}`)
}

const page = await call(`${urls.site}/any/deep/link`)
await check('画面を配信し、どのパスでも index.html を返す', () => {
  assert.equal(page.status, 200)
  assert.match(page.text, /id="root"/)
})

// Hosting Emulator は Firebase にログインしていないと設定を返さない。未ログインの CI では値を使わない。
const init = await call(`${urls.site}/__/firebase/init.json`)
await check('Firebase の設定を配信する', () => {
  assert.equal(init.status, 200)
  if (init.text || mode === 'prod') assert.equal(init.json.projectId, PROJECT_ID)
})

const apiKey = init.json.apiKey ?? 'emulator'
const signUp = await call(`${urls.auth}/accounts:signUp?key=${apiKey}`, {
  body: { returnSecureToken: true },
})
await check('匿名ログインできる', () => assert.equal(signUp.status, 200))
const token = signUp.json.idToken
const uid = signUp.json.localId

// ---- Firestore の REST API を、画面の SDK と同じ形の書き込みで呼ぶための小道具 ----

function toValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') return { doubleValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  return { mapValue: { fields: toFields(value) } }
}

function toFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toValue(value)]))
}

const path = (...segments) => `${database}/${segments.join('/')}`

/** 新しく作る。serverTime に並べた項目にはサーバーの時刻が入る（画面の serverTimestamp() と同じ） */
function create(name, data, serverTime = []) {
  return {
    update: { name, fields: toFields(data) },
    updateTransforms: serverTime.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
    currentDocument: { exists: false },
  }
}

/** 一部の項目だけ直す（画面の updateDoc() と同じ） */
function update(name, data, serverTime = []) {
  return {
    update: { name, fields: toFields(data) },
    updateMask: { fieldPaths: Object.keys(data) },
    updateTransforms: serverTime.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
    currentDocument: { exists: true },
  }
}

const remove = (name) => ({ delete: name })

/** 複数の書き込みを 1 回で行う（画面の writeBatch() と同じ）。応答の status を返す */
async function commit(idToken, ...writes) {
  const response = await call(`${urls.firestore}/${database}:commit`, { token: idToken, body: { writes } })
  return response.status
}

async function read(idToken, name) {
  const response = await call(`${urls.firestore}/${name}`, { token: idToken })
  return response.status
}

/** ドキュメントか一覧を読んで、中身を返す */
async function get(idToken, name) {
  return call(`${urls.firestore}/${name}`, { token: idToken })
}

/** Functions の処理が終わるのを待つ。done が true を返すまで、少しずつ待って読み直す */
async function waitFor(what, read, done, timeoutMs = mode === 'local' ? 30_000 : 120_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    assert.ok(Date.now() < until, `${what}を待ちましたが、終わりませんでした`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

async function signUpAnonymously() {
  const response = await call(`${urls.auth}/accounts:signUp?key=${apiKey}`, {
    body: { returnSecureToken: true },
  })
  assert.equal(response.status, 200, response.text)
  return { token: response.json.idToken, uid: response.json.localId }
}

// 終了日なし（null）は日帰り
const tripInfo = (overrides = {}) => ({
  title: '確認テスト（消してよい）',
  startDate: '2026-11-21',
  endDate: null,
  origin: '東京駅',
  regions: ['koshinetsu', 'hokuriku', 'tokai'],
  status: 'planning',
  decidedRouteId: null,
  ...overrides,
})

const memberInfo = (memberUid, overrides = {}) => ({
  uid: memberUid,
  displayName: 'テスト',
  color: '#1f9d55',
  votedRouteId: null,
  ...overrides,
})

/** 旅を作る人は、同じ書き込みで自分をメンバーに入れる */
function createTripWrites(tripId, creatorUid, overrides = {}) {
  return [
    create(path('trips', tripId), tripInfo({ createdBy: creatorUid, ...overrides }), ['createdAt', 'updatedAt']),
    create(path('trips', tripId, 'members', creatorUid), memberInfo(creatorUid), ['joinedAt']),
  ]
}

await check('ルールにないコレクションは読めない', async () => {
  const response = await call(`${urls.firestore}/${database}/secret`, { token })
  assert.equal(response.status, 403)
  assert.equal(await read(token, path('usage', 'total')), 403)
  assert.equal(await read(token, path('usage', 'flash')), 403)
  assert.equal(await read(token, path('usage', 'argon')), 403)
  // 回数の記録は端末から書けない（書けると上限を戻せてしまう）
  assert.equal(await commit(token, create(path('usage', 'flash'), { count: 0 })), 403)
  assert.equal(await commit(token, create(path('usage', 'argon'), { count: 0, day: '2026-11-07', dayCount: 0 })), 403)
  assert.equal(await read(token, path('unlockAttempts', uid)), 403)
  assert.equal(await read(token, path('smoke', 'x')), 403)
  assert.equal(await read(token, path('modelCache', 'x')), 403)
  assert.equal(await commit(token, create(path('modelCache', 'x'), { version: 1, model: {} })), 403)
})

// ---- 旅のデータ：メンバーは読み書きでき、他人の旅は読めず、ピンとルートは端末から書けない ----

// a は旅を作る人、b は招待される人。token と uid（上でログインした人）を a として使う
const a = { token, uid }
const b = await signUpAnonymously()
const tripId = `smoke-${uid}`
const trip = path('trips', tripId)

await check('旅を作ると、作った人がメンバーになる', async () => {
  assert.equal(await commit(a.token, ...createTripWrites(tripId, a.uid)), 200)
  assert.equal(await read(a.token, trip), 200)
  assert.equal(await read(a.token, path('trips', tripId, 'members', a.uid)), 200)
})

await check('形の違う旅は作れない', async () => {
  const bad = (overrides) => commit(a.token, ...createTripWrites(`bad-${uid}`, a.uid, overrides))
  // 自分をメンバーに入れない
  assert.equal(await commit(a.token, createTripWrites(`bad-${uid}`, a.uid)[0]), 403)
  // 他人が作ったことにする、最初から決定済みにする、項目が欠ける・余る・長すぎる
  assert.equal(await bad({ createdBy: b.uid }), 403)
  assert.equal(await bad({ status: 'decided' }), 403)
  assert.equal(await bad({ decidedRouteId: 'route-1' }), 403)
  assert.equal(await bad({ title: '' }), 403)
  assert.equal(await bad({ title: 'あ'.repeat(41) }), 403)
  assert.equal(await bad({ startDate: '11/21' }), 403)
  assert.equal(await bad({ endDate: '2026-11-20' }), 403)
  assert.equal(await bad({ endDate: '2026-11-22', origin: '' }), 403)
  assert.equal(await bad({ extra: 'x' }), 403)
  assert.equal(await bad({ originPoint: { name: '別の名前', location: { lat: 35, lng: 139 }, placeId: null } }), 403)
  assert.equal(await bad({ originPoint: { name: '東京駅', location: { lat: 999, lng: 139 }, placeId: null } }), 403)
  // 大まかな場所（地方）：空、知らない地方、重なり、一覧でないもの
  assert.equal(await bad({ regions: [] }), 403)
  assert.equal(await bad({ regions: ['tokyo'] }), 403)
  assert.equal(await bad({ regions: ['tohoku', 'tohoku'] }), 403)
  assert.equal(await bad({ regions: 'tohoku' }), 403)
  // 県で絞ったとき：空、知らない県、重なり
  assert.equal(await bad({ prefectures: [] }), 403)
  assert.equal(await bad({ prefectures: ['長野'] }), 403)
  assert.equal(await bad({ prefectures: ['長野県', '長野県'] }), 403)
  // 移動手段は、車か電車・バスだけ
  assert.equal(await bad({ travelMode: 'ship' }), 403)
  // 帰る場所：出発地と同じ、位置がない、位置だけ、名前の食い違い、位置が範囲の外、長すぎる
  const goal = (name, lat = 35.69) => ({ name, location: { lat, lng: 139.7 }, placeId: null })
  assert.equal(await bad({ returnTo: '東京駅', returnPoint: goal('東京駅') }), 403)
  assert.equal(await bad({ returnTo: '新宿駅' }), 403)
  assert.equal(await bad({ returnPoint: goal('新宿駅') }), 403)
  assert.equal(await bad({ returnTo: '新宿駅', returnPoint: goal('渋谷駅') }), 403)
  assert.equal(await bad({ returnTo: '新宿駅', returnPoint: goal('新宿駅', 999) }), 403)
  assert.equal(await bad({ returnTo: 'あ'.repeat(41), returnPoint: goal('あ'.repeat(41)) }), 403)
})

await check('出発地と違う帰る場所を付けて旅を作れる。作ったあとで帰る場所は変えられない', async () => {
  const returnPoint = { name: '新宿駅', location: { lat: 35.69, lng: 139.7 }, placeId: null }
  assert.equal(await commit(a.token, ...createTripWrites(`goal-${uid}`, a.uid, { returnTo: '新宿駅', returnPoint })), 200)
  assert.equal(await commit(a.token, update(trip, { returnTo: '渋谷駅' }, ['updatedAt'])), 403)
})

await check('県まで絞った旅を作れる', async () => {
  assert.equal(await commit(a.token, ...createTripWrites(`pref-${uid}`, a.uid, { regions: ['koshinetsu'], prefectures: ['長野県'] })), 200)
})

await check('大まかな場所（地方）は、作ったあとで変えられない', async () => {
  assert.equal(await commit(a.token, update(trip, { regions: ['kyushu'] }, ['updatedAt'])), 403)
})

await check('移動手段（電車・バス、飛行機）を選んで旅を作れる', async () => {
  assert.equal(await commit(a.token, ...createTripWrites(`transit-${uid}`, a.uid, { travelMode: 'transit' })), 200)
  assert.equal(await commit(a.token, ...createTripWrites(`plane-${uid}`, a.uid, { travelMode: 'plane' })), 200)
})

if (mode === 'local') await check('出発地を検索・変更でき、位置の直接改ざんと部外者の変更を断る', async () => {
  const invoke = (name, idToken, data) => call(`${urls.functions}/${name}`, { token: idToken, body: { data } })
  const resolved = await invoke('resolveOrigin', a.token, { name: '目黒駅' })
  assert.equal(resolved.status, 200, resolved.text)
  assert.equal(resolved.json.result.status, 'resolved')
  const other = await invoke('changeOrigin', b.token, { tripId, name: '目黒駅', expectedOrigin: '東京駅' })
  assert.equal(other.status, 403, other.text)
  const changed = await invoke('changeOrigin', a.token, { tripId, name: '目黒駅', expectedOrigin: '東京駅' })
  assert.equal(changed.json.result.status, 'changed', changed.text)
  const saved = (await get(a.token, trip)).json.fields
  assert.equal(saved.origin.stringValue, '目黒駅')
  assert.equal(saved.originPoint.mapValue.fields.location.mapValue.fields.lat.doubleValue, 35.6339)
  assert.equal(await commit(a.token, update(trip, { origin: '横浜駅' }, ['updatedAt'])), 403)
  assert.equal(await commit(a.token, update(trip, { originPoint: {} }, ['updatedAt'])), 403)
  const stale = await invoke('changeOrigin', a.token, { tripId, name: '大阪駅', expectedOrigin: '東京駅' })
  assert.equal(stale.json.result.status, 'conflict')
  assert.equal((await invoke('changeOrigin', a.token, { tripId, name: '東京駅', expectedOrigin: '目黒駅' })).json.result.status, 'changed')
})

if (mode === 'local') await check('移動手段を選び直せ、直接の書き換えと部外者の変更を断る', async () => {
  const invoke = (name, idToken, data) => call(`${urls.functions}/${name}`, { token: idToken, body: { data } })
  const other = await invoke('changeTravelMode', b.token, { tripId, mode: 'transit' })
  assert.equal(other.status, 403, other.text)
  const changed = await invoke('changeTravelMode', a.token, { tripId, mode: 'transit' })
  assert.equal(changed.json.result.status, 'changed', changed.text)
  assert.equal((await get(a.token, trip)).json.fields.travelMode.stringValue, 'transit')
  assert.equal((await invoke('changeTravelMode', a.token, { tripId, mode: 'transit' })).json.result.status, 'unchanged')
  assert.equal((await invoke('changeTravelMode', a.token, { tripId, mode: 'ship' })).status, 400)
  assert.equal((await invoke('changeTravelMode', a.token, { tripId, mode: 'plane' })).json.result.status, 'changed')
  assert.equal((await get(a.token, trip)).json.fields.travelMode.stringValue, 'plane')
  // しおりの時刻を一緒に計算し直すので、端末からは書き換えられない
  assert.equal(await commit(a.token, update(trip, { travelMode: 'car' }, ['updatedAt'])), 403)
  assert.equal((await invoke('changeTravelMode', a.token, { tripId, mode: 'car' })).json.result.status, 'changed')
})

await check('メンバーではない人は、他人の旅を読めない', async () => {
  assert.equal(await read(b.token, trip), 403)
  assert.equal(await read(b.token, path('trips', tripId, 'members')), 403)
  assert.equal(await read(b.token, path('trips', tripId, 'members', a.uid)), 403)
  assert.equal(await read(b.token, path('trips', tripId, 'wishes')), 403)
  assert.equal(await read(b.token, path('trips', tripId, 'pins')), 403)
  assert.equal(await read(b.token, path('trips', tripId, 'routes')), 403)
  // 旅の一覧（全件）は誰にも出さない
  assert.equal(await read(a.token, path('trips')), 403)
})

await check('メンバーではない人は、他人の旅に書けない', async () => {
  assert.equal(await commit(b.token, update(trip, { title: '乗っ取り' }, ['updatedAt'])), 403)
  assert.equal(
    await commit(
      b.token,
      create(path('trips', tripId, 'wishes', `w-${b.uid}`), { uid: b.uid, text: '温泉', bounds: null, status: 'pending' }, [
        'createdAt',
      ]),
    ),
    403,
  )
})

await check('招待された人は、表示名を入れて参加できる', async () => {
  const member = path('trips', tripId, 'members', b.uid)
  // 参加前でも、自分がメンバーかどうかは確かめられる（まだいないので 404）
  assert.equal(await read(b.token, member), 404)
  // 他人の名前では参加できない。ない旅には参加できない
  assert.equal(await commit(b.token, create(path('trips', tripId, 'members', 'someone'), memberInfo('someone'), ['joinedAt'])), 403)
  assert.equal(await commit(b.token, create(member, memberInfo(a.uid), ['joinedAt'])), 403)
  assert.equal(await commit(b.token, create(path('trips', 'no-such-trip', 'members', b.uid), memberInfo(b.uid), ['joinedAt'])), 403)
  assert.equal(await commit(b.token, create(member, memberInfo(b.uid, { displayName: '' }), ['joinedAt'])), 403)
  assert.equal(await commit(b.token, create(member, memberInfo(b.uid, { votedRouteId: 'route-1' }), ['joinedAt'])), 403)

  assert.equal(await commit(b.token, create(member, memberInfo(b.uid, { displayName: 'みお' }), ['joinedAt'])), 200)
  assert.equal(await read(b.token, trip), 200)
  assert.equal(await read(b.token, path('trips', tripId, 'members')), 200)
})

await check('メンバーなら誰でも旅の名前を直せるが、日程、状態、決定したルートは直せない', async () => {
  assert.equal(await commit(b.token, update(trip, { title: '秋の信州ふらり旅' }, ['updatedAt'])), 200)
  // 日程は、発案者が Functions（change-trip-dates）で変える。端末からは書けない
  assert.equal(await commit(b.token, update(trip, { endDate: '2026-11-22' }, ['updatedAt'])), 403)
  assert.equal(await commit(a.token, update(trip, { startDate: '2026-11-22' }, ['updatedAt'])), 403)
  assert.equal(await commit(b.token, update(trip, { status: 'decided' }, ['updatedAt'])), 403)
  assert.equal(await commit(b.token, update(trip, { decidedRouteId: 'route-1' }, ['updatedAt'])), 403)
  assert.equal(await commit(b.token, update(trip, { createdBy: b.uid }, ['updatedAt'])), 403)
  assert.equal(await commit(b.token, update(trip, { title: '' }, ['updatedAt'])), 403)
  assert.equal(await commit(a.token, remove(trip)), 403)
})

await check('自分のメンバー情報だけを直せる', async () => {
  assert.equal(await commit(b.token, update(path('trips', tripId, 'members', b.uid), { displayName: 'みおみお' })), 200)
  assert.equal(await commit(b.token, update(path('trips', tripId, 'members', a.uid), { displayName: 'なりすまし' })), 403)
  assert.equal(await commit(b.token, update(path('trips', tripId, 'members', b.uid), { uid: a.uid })), 403)
  assert.equal(await commit(b.token, remove(path('trips', tripId, 'members', a.uid))), 403)
})

const wishId = `wish-${uid}`
// 希望と一緒に保存する、地図で映していた範囲（長野のあたり）
const wishBounds = { north: 37.2, south: 35.9, east: 138.9, west: 137.3 }
await check('メンバーは自分の希望を書け、ほかのメンバーが読める', async () => {
  const wish = path('trips', tripId, 'wishes', wishId)
  const data = { uid: a.uid, text: '温泉に入りたい', bounds: wishBounds, status: 'pending' }
  // 他人の希望として書く、探し終わったことにする、範囲の形が違う
  assert.equal(await commit(a.token, create(wish, { ...data, uid: b.uid }, ['createdAt'])), 403)
  assert.equal(await commit(a.token, create(wish, { ...data, status: 'done' }, ['createdAt'])), 403)
  assert.equal(await commit(a.token, create(wish, { ...data, bounds: { north: 200 } }, ['createdAt'])), 403)
  // 何日目の夜の宿か（lodgingNight）は、1 〜 30 の整数だけ
  assert.equal(await commit(a.token, create(wish, { ...data, lodgingNight: 0 }, ['createdAt'])), 403)
  assert.equal(await commit(a.token, create(wish, { ...data, lodgingNight: '1' }, ['createdAt'])), 403)
  assert.equal(await commit(a.token, create(wish, { ...data, lodgingNight: 31 }, ['createdAt'])), 403)
  // どの日のどのごはんか（mealSlot）は、「1-lunch」の形だけ
  assert.equal(await commit(a.token, create(wish, { ...data, mealSlot: '0-lunch' }, ['createdAt'])), 403)
  assert.equal(await commit(a.token, create(wish, { ...data, mealSlot: '1-snack' }, ['createdAt'])), 403)
  assert.equal(await commit(a.token, create(wish, { ...data, mealSlot: 1 }, ['createdAt'])), 403)
  assert.equal(await commit(a.token, create(wish, data, ['createdAt'])), 200)
  assert.equal(await read(b.token, wish), 200)
  // 希望の状態を進めるのは Functions だけ（pending → searching → done / failed）
  assert.equal(await commit(a.token, update(wish, { status: 'done' })), 403)
  assert.equal(await commit(a.token, update(wish, { status: 'searching' })), 403)
  assert.equal(await commit(a.token, create(path('trips', tripId, 'wishes', `${wishId}-x`), { ...data, status: 'searching' }, ['createdAt'])), 403)
})

// 希望 → ピン（features/suggest-places）を、ローカルでも本番でも通して確かめる。
// Gemini は固定の応答（見本の場所の一覧）なので、本番でも費用はかからない。本物の Gemini（agy、vertex）を
// つないだあとは、デプロイのたびに Flash を 1 回呼ぶことになるので、そのときに扱いを決め直す。
// 本番では、誰も読めない「確認テスト」の旅に、候補のピンが 3 つ残る。
const pinOf = (document) => Object.fromEntries(Object.entries(document.fields).map(([key, value]) => [key, Object.values(value)[0]]))
let candidatePins = []
await check('希望を書くと、Functions が候補のピンを立てる（端末は読むだけ）', async () => {
  const list = await waitFor(
    '希望 → ピン',
    () => get(a.token, path('trips', tripId, 'pins')),
    (response) => (response.json.documents ?? []).length > 0,
  )
  candidatePins = list.json.documents
  assert.equal(candidatePins.length, 3)
  for (const [index, document] of candidatePins.entries()) {
    const pin = pinOf(document)
    // ピンの ID は「希望の ID ＋ 順番」。同じ希望を 2 回処理しても増えない
    assert.equal(document.name, path('trips', tripId, 'pins', `${wishId}-${index + 1}`))
    assert.equal(pin.wishId, wishId)
    assert.equal(pin.uid, a.uid)
    assert.equal(pin.status, 'candidate')
    assert.equal(pin.category, 'onsen')
    assert.equal(pin.namedMatch, undefined)
    // 固定の応答（見本の場所の一覧）から出した候補だと分かる
    assert.equal(pin.suggestedBy, 'stub')
    assert.equal(pin.builtBy, null)
    assert.ok(pin.name.length > 0 && pin.description.length > 0 && pin.area.length > 0)
    // 希望と一緒に保存した範囲（地図で映していた範囲）の中から探している
    const { latitude, longitude } = { latitude: pin.location.fields.lat.doubleValue, longitude: pin.location.fields.lng.doubleValue }
    assert.ok(latitude <= wishBounds.north && latitude >= wishBounds.south, `${pin.name} が範囲の外`)
    assert.ok(longitude <= wishBounds.east && longitude >= wishBounds.west, `${pin.name} が範囲の外`)
  }
  const wish = await waitFor(
    '希望の状態',
    () => get(a.token, path('trips', tripId, 'wishes', wishId)),
    (response) => response.json.fields?.status?.stringValue === 'done',
  )
  assert.equal(wish.status, 200)
  // 立ったピンを、端末から書き換えることはできない
  assert.equal(await commit(a.token, update(candidatePins[0].name, { status: 'done' })), 403)
  assert.equal(await commit(a.token, remove(candidatePins[0].name)), 403)
})

// 建築（features/request-build、features/build-model）を、ローカルでも本番でも通して確かめる。
// 模型は用意した部品（固定の応答）か、建物辞書の生成済みの模型（見本の場所。prebuilt.ts）なので、本番でも費用はかからない。
// 本番では、確認用の旅に建物が 1 つ残る。
const requestBuild = (idToken, data) => call(`${urls.functions}/requestBuild`, { token: idToken, body: { data } })
const fieldsOf = async (idToken, name) => (await get(idToken, name)).json.fields ?? {}

await check('ログインなし、メンバーでない人、形の違う依頼では、建築を頼めない', async () => {
  const pinId = candidatePins[0].name.split('/').pop()
  assert.equal((await requestBuild(undefined, { tripId, pinId })).status, 401)
  const outsider = await signUpAnonymously()
  assert.equal((await requestBuild(outsider.token, { tripId, pinId })).status, 403)
  await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
  assert.equal((await requestBuild(a.token, { tripId })).status, 400)
  assert.equal((await requestBuild(a.token, { tripId, pinId: '../x' })).status, 400)
  assert.equal((await requestBuild(a.token, { tripId, pinId: 'no-such-pin' })).status, 404)
  assert.equal((await fieldsOf(a.token, candidatePins[0].name)).status.stringValue, 'candidate')
})

await check('建築を頼むと「工事中」になり、Functions が模型を作って「完成」にする', async () => {
  const pin = candidatePins[0].name
  const pinId = pin.split('/').pop()
  // 希望を書いた人（a）でなくても、メンバー（b）なら建てられる
  const response = await requestBuild(b.token, { tripId, pinId })
  assert.equal(response.status, 200, response.text)
  assert.equal(response.json.result.status, 'building')
  const started = await fieldsOf(a.token, pin)
  assert.ok(['building', 'done'].includes(started.status.stringValue))
  assert.equal(started.builtBy.stringValue, b.uid)
  // 同じ場所は、もう一度は頼めない
  assert.equal((await requestBuild(a.token, { tripId, pinId })).status, 400)

  const done = await waitFor(
    '建築',
    () => fieldsOf(a.token, pin),
    (fields) => fields.status?.stringValue === 'done',
  )
  assert.ok(done.buildStartedAt.timestampValue, '模型を作る処理が引き受けた時刻がない')
  // 模型の JSON は、メンバーが読める。決めた形（version 1 と部品の配列）。
  // 固定の応答の候補は見本の場所なので、建物辞書の生成済みの模型（argon）が当たる。辞書にない場所なら用意した部品（parts）
  const model = await get(b.token, `${pin}/model/current`)
  assert.equal(model.status, 200)
  assert.ok(['parts', 'argon'].includes(model.json.fields.source.stringValue), model.json.fields.source.stringValue)
  const json = model.json.fields.json.mapValue.fields
  assert.equal(Number(json.version.integerValue ?? json.version.doubleValue), 1)
  const parts = json.parts.arrayValue.values
  assert.ok(parts.length >= 8)
  // 辞書の模型は rotation と opacity を持つことがある
  for (const key of ['color', 'position', 'shape', 'size']) assert.ok(key in parts[0].mapValue.fields, `部品に ${key} がない`)
  // 模型は、端末から書き換えられない
  assert.equal(await commit(a.token, update(`${pin}/model/current`, { source: 'argon' })), 403)
  assert.equal(await commit(a.token, update(pin, { status: 'candidate' })), 403)
})

await check('ピン、模型、ルート案は端末から書けない', async () => {
  const pin = { wishId, uid: a.uid, name: '白骨温泉', description: '乳白色の湯', area: '長野県松本市', category: 'onsen', location: { lat: 36.1, lng: 137.6 }, status: 'done', suggestedBy: 'stub', placeId: null, builtBy: a.uid, buildStartedAt: null }
  assert.equal(await commit(a.token, create(path('trips', tripId, 'pins', 'pin-1'), pin, ['createdAt', 'updatedAt'])), 403)
  assert.equal(await commit(a.token, create(path('trips', tripId, 'pins', 'pin-1', 'model', 'current'), { json: {}, source: 'parts' }, ['createdAt'])), 403)
  const route = { label: 'A', catchphrase: '湯けむりの旅', pinIds: ['pin-1'], schedule: [] }
  assert.equal(await commit(a.token, create(path('trips', tripId, 'routes', 'route-1'), route, ['createdAt'])), 403)
  // ルート案がないので、投票もできない
  assert.equal(
    await commit(
      a.token,
      create(path('trips', tripId, 'routes', 'route-1', 'votes', a.uid), { uid: a.uid }, ['createdAt']),
      update(path('trips', tripId, 'members', a.uid), { votedRouteId: 'route-1' }),
    ),
    403,
  )
})

await check('自分がメンバーの旅だけを集められる（旅の一覧）', async () => {
  const membershipsOf = (idToken, memberUid) =>
    call(`${urls.firestore}/${database}:runQuery`, {
      token: idToken,
      body: {
        structuredQuery: {
          from: [{ collectionId: 'members', allDescendants: true }],
          where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: memberUid } } },
        },
      },
    })

  // 本番では、デプロイ直後はインデックスを作っている途中のことがある。できるまで少し待つ
  let mine = await membershipsOf(b.token, b.uid)
  for (let attempt = 0; mine.status === 400 && /index/i.test(mine.text) && attempt < 18; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    mine = await membershipsOf(b.token, b.uid)
  }
  assert.equal(mine.status, 200, mine.text)
  const names = mine.json.filter((row) => row.document).map((row) => row.document.name)
  assert.deepEqual(names, [path('trips', tripId, 'members', b.uid)])

  // 他人がどの旅にいるかは集められない
  const others = await membershipsOf(b.token, a.uid)
  assert.equal(others.status, 403)
})

// Functions の代わりに、Emulator の管理者としてピンとルート案を置き、メンバーの読み取りと投票を確かめる。
// 本番では管理者として書けないので、ローカルだけで行う。
if (mode === 'local') {
  const admin = 'owner'
  const c = await signUpAnonymously()
  const vote = (routeId, voterUid) => path('trips', tripId, 'routes', routeId, 'votes', voterUid)
  const member = (memberUid) => path('trips', tripId, 'members', memberUid)

  await check('Functions が置いたピンとルート案を、メンバーだけが読める', async () => {
    const pin = { wishId, uid: a.uid, name: '白骨温泉', description: '乳白色の湯', area: '長野県松本市', category: 'onsen', location: { lat: 36.1, lng: 137.6 }, status: 'candidate', suggestedBy: 'stub', placeId: null, builtBy: null, buildStartedAt: null }
    assert.equal(await commit(admin, create(path('trips', tripId, 'pins', 'pin-1'), pin, ['createdAt', 'updatedAt'])), 200)
    assert.equal(await commit(admin, create(path('trips', tripId, 'pins', 'pin-1', 'model', 'current'), { json: {}, source: 'parts' }, ['createdAt'])), 200)
    for (const routeId of ['route-1', 'route-2']) {
      const route = { label: routeId, catchphrase: '湯けむりの旅', pinIds: ['pin-1'], schedule: [] }
      assert.equal(await commit(admin, create(path('trips', tripId, 'routes', routeId), route, ['createdAt'])), 200)
    }
    // 投票しない人を 1 人置いておく。そうしないと、下の投票の確認で「全員が投票した」ことになり、
    // 決定のトリガー（features/tally-votes）が旅を「決定」にしてしまう
    assert.equal(await commit(admin, create(member('sleeper'), memberInfo('sleeper'), ['joinedAt'])), 200)
    assert.equal(await read(b.token, path('trips', tripId, 'pins', 'pin-1')), 200)
    assert.equal(await read(b.token, path('trips', tripId, 'pins', 'pin-1', 'model', 'current')), 200)
    assert.equal(await read(b.token, path('trips', tripId, 'routes')), 200)
    assert.equal(await read(c.token, path('trips', tripId, 'pins', 'pin-1')), 403)
    assert.equal(await read(c.token, path('trips', tripId, 'pins', 'pin-1', 'model', 'current')), 403)
    assert.equal(await read(c.token, path('trips', tripId, 'routes', 'route-1')), 403)
    // 置いてあるピンとルート案も、メンバーは書き換えられない
    assert.equal(await commit(a.token, update(path('trips', tripId, 'pins', 'pin-1'), { status: 'done' })), 403)
    assert.equal(await commit(a.token, update(path('trips', tripId, 'routes', 'route-1'), { catchphrase: '改ざん' })), 403)
    assert.equal(await commit(a.token, remove(path('trips', tripId, 'routes', 'route-1'))), 403)
  })

  await check('建築は 1 つの旅で 20 棟まで。21 棟目は断られる', async () => {
    // もう 1 棟（上の確認で建てたもの）ある。Functions の代わりに、工事中の建物を 19 個足して 20 棟にする
    for (let index = 1; index <= 19; index += 1) {
      // 「工事中」で置く（上限には数える）。「完成」で置くと、建った場所が 3 つを超えてルート案のトリガーが動き、
      // 上で置いたルート案（route-1、route-2）が作り直されてしまう。トリガーが引き受けないよう、引き受け済みの時刻を入れておく
      const built = { wishId, uid: a.uid, name: `建物 ${index}`, description: '', area: '', category: 'town', location: { lat: 36.2, lng: 138 }, status: 'building', suggestedBy: 'stub', placeId: null, builtBy: a.uid, buildStartedAt: null }
      assert.equal(await commit(admin, create(path('trips', tripId, 'pins', `built-${index}`), built, ['createdAt', 'updatedAt', 'buildStartedAt'])), 200)
    }
    const overLimit = candidatePins[1].name
    const response = await requestBuild(a.token, { tripId, pinId: overLimit.split('/').pop() })
    assert.equal(response.status, 429, response.text)
    assert.match(response.json.error.message, /20 棟まで/)
    assert.equal((await fieldsOf(a.token, overLimit)).status.stringValue, 'candidate')
    // 失敗した建物は数えない。1 つを「失敗」にすると、もう 1 棟建てられる
    assert.equal(await commit(admin, update(path('trips', tripId, 'pins', 'built-1'), { status: 'failed' })), 200)
    assert.equal((await requestBuild(a.token, { tripId, pinId: overLimit.split('/').pop() })).status, 200)
    // 失敗したものは、もう一度建てられる（ここでは上限に当たる）
    assert.equal((await requestBuild(a.token, { tripId, pinId: 'built-1' })).status, 429)
  })

  await check('投票は 1 人 1 票で、自分の票だけを動かせる', async () => {
    const castA = (routeId) => [
      create(vote(routeId, a.uid), { uid: a.uid }, ['createdAt']),
      update(member(a.uid), { votedRouteId: routeId }),
    ]
    // 票だけ、votedRouteId だけ、では書けない（2 つがそろわない）
    assert.equal(await commit(a.token, castA('route-1')[0]), 403)
    assert.equal(await commit(a.token, castA('route-1')[1]), 403)
    // 他人の票、メンバーではない人の票
    assert.equal(await commit(a.token, create(vote('route-1', b.uid), { uid: b.uid }, ['createdAt']), update(member(a.uid), { votedRouteId: 'route-1' })), 403)
    assert.equal(await commit(c.token, create(vote('route-1', c.uid), { uid: c.uid }, ['createdAt'])), 403)

    assert.equal(await commit(a.token, ...castA('route-1')), 200)
    assert.equal(await read(b.token, vote('route-1', a.uid)), 200)
    assert.equal(await read(c.token, vote('route-1', a.uid)), 403)

    // 古い票を残したまま 2 票目は入れられない。古い票を消しながらなら、票を変えられる
    assert.equal(await commit(a.token, ...castA('route-2')), 403)
    assert.equal(await commit(a.token, remove(vote('route-1', a.uid))), 403)
    assert.equal(await commit(a.token, remove(vote('route-1', a.uid)), ...castA('route-2')), 200)
    assert.equal(await read(a.token, vote('route-1', a.uid)), 404)

    // 票を残したまま旅から抜けることはできない。票と一緒になら抜けられる
    assert.equal(await commit(a.token, remove(member(a.uid))), 403)
    assert.equal(await commit(a.token, remove(vote('route-2', a.uid)), remove(member(a.uid))), 200)
    assert.equal(await read(a.token, trip), 403)
  })

  await check('決定したあとは、票を入れることも、変えることも、取り消すこともできない', async () => {
    const castB = (routeId) => [
      create(vote(routeId, b.uid), { uid: b.uid }, ['createdAt']),
      update(member(b.uid), { votedRouteId: routeId }),
    ]
    // 計画中は、票を取り消して入れ直せる
    assert.equal(await commit(b.token, ...castB('route-1')), 200)
    assert.equal(await commit(b.token, remove(vote('route-1', b.uid)), update(member(b.uid), { votedRouteId: null })), 200)
    assert.equal(await commit(b.token, ...castB('route-1')), 200)

    assert.equal(await commit(admin, update(trip, { status: 'decided', decidedRouteId: 'route-1' })), 200)

    // 決定したあと：取り消し、入れ直し、票だけの削除、votedRouteId だけの書き換え
    assert.equal(await commit(b.token, remove(vote('route-1', b.uid)), update(member(b.uid), { votedRouteId: null })), 403)
    assert.equal(await commit(b.token, remove(vote('route-1', b.uid)), ...castB('route-2')), 403)
    assert.equal(await commit(b.token, remove(vote('route-1', b.uid))), 403)
    assert.equal(await commit(b.token, update(member(b.uid), { votedRouteId: null })), 403)
    assert.equal(await read(b.token, vote('route-1', b.uid)), 200)
    // 投票していない人も、決定したあとは入れられない
    const late = path('trips', tripId, 'members', c.uid)
    assert.equal(await commit(c.token, create(late, memberInfo(c.uid), ['joinedAt'])), 200)
    assert.equal(
      await commit(c.token, create(vote('route-1', c.uid), { uid: c.uid }, ['createdAt']), update(late, { votedRouteId: 'route-1' })),
      403,
    )
    // 決定したあとも、名前と基本情報は直せる
    assert.equal(await commit(b.token, update(member(b.uid), { displayName: 'みお' })), 200)
    assert.equal(await commit(b.token, update(trip, { origin: '新宿駅' }, ['updatedAt'])), 403)
    const changedOrigin = await call(`${urls.functions}/changeOrigin`, { token: b.token, body: { data: { tripId, name: '新宿駅', expectedOrigin: '東京駅' } } })
    assert.equal(changedOrigin.status, 200, changedOrigin.text)
    assert.equal(changedOrigin.json.result.status, 'changed')
    // 決定したあとも、旅から抜けることはできる（票も一緒に消す）
    assert.equal(await commit(b.token, remove(member(b.uid))), 403)
    assert.equal(await commit(b.token, remove(vote('route-1', b.uid)), remove(member(b.uid))), 200)
    assert.equal(await read(b.token, trip), 403)
    // あとの確認（旅から抜ける）のために、b は入り直しておく
    assert.equal(await commit(b.token, create(member(b.uid), memberInfo(b.uid), ['joinedAt'])), 200)
  })

  await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: c.token } })
}

await check('旅から抜けると、その旅を読めなくなる', async () => {
  assert.equal(await commit(b.token, remove(path('trips', tripId, 'members', b.uid))), 200)
  assert.equal(await read(b.token, trip), 403)
  assert.equal(await read(b.token, path('trips', tripId, 'wishes', wishId)), 403)
  const user = await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: b.token } })
  assert.equal(user.status, 200, user.text)
})

// ---- しおりのルート（features/propose-routes）を、ローカルでも本番でも、端末と同じ操作だけで通して確かめる ----
// 3 人の旅で、希望 → 候補のピン → 建築 → しおりに 1 か所ずつ入る（2026-11-07 にルート案と投票はやめた）。
// 順番は固定の応答（自分たちの計算）なので、本番でも費用はかからない。本番では、誰も読めない確認用の旅が 1 つ残る。
{
  const flowId = `smoke-flow-${uid}`
  const flow = (...segments) => path('trips', flowId, ...segments)
  const m1 = { token, uid }
  const m2 = await signUpAnonymously()
  const m3 = await signUpAnonymously()
  const people = [m1, m2, m3]
  const plain = (document) => pinOf(document)
  const listOf = async (name) => (await get(m1.token, name)).json.documents ?? []
  const idOf = (document) => document.name.split('/').pop()
  // pinOf は、項目の値の外側（stringValue など）を 1 枚はがす。配列は { values: [...] } で残る
  const array = (value) => (value.values ?? []).map((item) => Object.values(item)[0])
  const number = (value) => Number(value)
  const routesNow = async () => (await listOf(flow('routes'))).map((document) => ({ id: idOf(document), ...plain(document) })).sort((left, right) => left.label.localeCompare(right.label))
  const wishFor = async (wishName, text) => {
    const data = { uid: m1.uid, text, bounds: wishBounds, status: 'pending' }
    assert.equal(await commit(m1.token, create(flow('wishes', wishName), data, ['createdAt'])), 200)
    // 候補のピンは 1 回の書き込みでまとめて立つので、1 つ見えれば全部そろっている。
    // 範囲の中に見本の場所が少ないと 3 件に満たないことがある（範囲の外からは足さない）
    const pins = await waitFor(`${text} → ピン`, () => listOf(flow('pins')), (documents) => documents.some((document) => plain(document).wishId === wishName))
    return pins.filter((document) => plain(document).wishId === wishName).map(idOf)
  }
  const buildAndWait = async (person, pinId) => {
    const response = await requestBuild(person.token, { tripId: flowId, pinId })
    assert.equal(response.status, 200, response.text)
    await waitFor('建築', () => fieldsOf(m1.token, flow('pins', pinId)), (fields) => fields.status?.stringValue === 'done')
  }

  const shioriNow = async () => (await routesNow()).find((route) => route.id === 'shiori')
  const stopsOf = (route) => array(route.schedule).map((stop) => Object.fromEntries(Object.entries(stop.fields).map(([key, value]) => [key, Object.values(value)[0]])))
  let pins = []

  await check('3 人の旅で建物が 1 つ建つと、しおりのルートが 1 本でき、時刻が付く', async () => {
    assert.equal(await commit(m1.token, ...createTripWrites(flowId, m1.uid, { endDate: '2026-11-22' })), 200)
    for (const person of [m2, m3]) assert.equal(await commit(person.token, create(flow('members', person.uid), memberInfo(person.uid), ['joinedAt'])), 200)
    pins = await wishFor(`wish1-${uid}`, '温泉に入りたい')
    await buildAndWait(m1, pins[0])
    const route = await waitFor('しおり', shioriNow, (found) => found && array(found.pinIds).length === 1)
    assert.deepEqual(array(route.pinIds), [pins[0]])
    // 固定の応答（自分たちの計算）で作ったと分かる
    assert.equal(route.proposedBy, 'stub')
    assert.equal(number(route.revision), 0)
    // 出発地（東京駅）の位置が分かるので、「出発」の行から始まる
    assert.equal(route.originIncluded, true)
    const schedule = stopsOf(route)
    assert.equal(schedule.length, 2)
    assert.equal(schedule[0].pinId, null)
    assert.match(schedule[0].name, /東京駅 出発/)
    for (const stop of schedule) assert.match(stop.time, /^[0-2][0-9]:[0-5][0-9]$/)
    // ルート案（g1-a など）は作らない
    assert.deepEqual((await routesNow()).map((item) => item.id), ['shiori'])
    // しおりは、メンバーが読めるが、書き換えられない
    assert.equal(await read(m2.token, flow('routes', 'shiori')), 200)
    assert.equal(await commit(m2.token, update(flow('routes', 'shiori'), { catchphrase: '改ざん' })), 403)
  })

  await check('2 つ目、3 つ目が建つと、前の順番を保ったまま、しおりに入る', async () => {
    await buildAndWait(m2, pins[1])
    const second = await waitFor('しおりに 2 か所', shioriNow, (found) => array(found.pinIds).length === 2)
    const before = array(second.pinIds)
    await buildAndWait(m3, pins[2])
    const third = await waitFor('しおりに 3 か所', shioriNow, (found) => array(found.pinIds).length === 3)
    const order = array(third.pinIds)
    assert.deepEqual(order.filter((id) => id !== pins[2]), before)
    assert.equal(number(third.revision), 2)
    assert.deepEqual(array(third.addedPinIds), [pins[1], pins[2]])
    // 出発の行 ＋ 3 か所。1 泊 2 日なので 2 日に分かれる
    const schedule = stopsOf(third)
    assert.equal(schedule.length, 4)
    assert.deepEqual([...new Set(schedule.map((stop) => Number(stop.day)))], [1, 2])
    assert.equal(schedule.at(-1).moveMinutesToNext, null)
    assert.deepEqual((await routesNow()).map((item) => item.id), ['shiori'])
    // 旅は計画中のまま。メンバーが、自分で「決定」にすることはできない
    assert.equal((await fieldsOf(m1.token, flow())).status.stringValue, 'planning')
    assert.equal(await commit(m1.token, update(flow(), { status: 'decided', decidedRouteId: 'shiori' })), 403)
  })

  await check('しおりの移動時間と道の形（Routes）：メンバーだけが聞ける。開発環境では Routes を呼ばず見本を返し、どこにも保存しない', async () => {
    const shioriTravel = (idToken, data) => call(`${urls.functions}/shioriTravel`, { token: idToken, body: { data } })
    assert.equal((await shioriTravel(undefined, { tripId: flowId, routeId: 'shiori' })).status, 401)
    assert.equal((await shioriTravel(m1.token, { tripId: flowId })).status, 400)
    // この旅のメンバーではない人は断られる
    const outsider = await signUpAnonymously()
    assert.equal((await shioriTravel(outsider.token, { tripId: flowId, routeId: 'shiori' })).status, 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
    assert.equal((await shioriTravel(m1.token, { tripId: flowId, routeId: 'nothing' })).status, 404)
    const response = await shioriTravel(m1.token, { tripId: flowId, routeId: 'shiori' })
    assert.equal(response.status, 200, response.text)
    // Emulator ではキーがあっても Routes を呼ばない（見本の線と、保存してある目安の時刻を返す）。
    // 本番は、キーと全員に開く切り替え（settings/ai の openToAll）が入っていれば Routes の時間（routes）が返る。
    // 入っていなければ目安のまま。どちらでも、返すだけで保存しない
    const result = response.json.result
    if (mode === 'local') {
      // 手元（Emulator）は Routes を呼ばず、見本の線を返す。時刻は保存してある目安のまま（#218）
      assert.equal(result.status, 'routes', response.text)
      assert.equal(result.sample, true)
      assert.ok(Array.isArray(result.legPaths) && result.legPaths.length > 0, response.text)
    } else {
      assert.ok(['estimate', 'routes'].includes(result.status), response.text)
      if (result.status === 'routes') assert.ok(Array.isArray(result.schedule) && result.schedule.length > 0, response.text)
    }
    // 何も保存しない：しおりは目安のまま、ルートは shiori の 1 本だけ
    assert.deepEqual((await routesNow()).map((item) => item.id), ['shiori'])
  })

  await check('しおりの行を動かす（reorderShiori）：メンバーが行を取って別の行の位置に落とすと、そこに差し込み、時刻と日を計算し直して保存する', async () => {
    const reorderShiori = (idToken, data) => call(`${urls.functions}/reorderShiori`, { token: idToken, body: { data } })
    const before = await shioriNow()
    const order = array(before.pinIds)
    const swap = { tripId: flowId, routeId: 'shiori', fromPinId: order[0], toPinId: order[2] }
    assert.equal((await reorderShiori(undefined, swap)).status, 401)
    assert.equal((await reorderShiori(m1.token, { tripId: flowId, routeId: 'shiori' })).status, 400)
    const outsider = await signUpAnonymously()
    assert.equal((await reorderShiori(outsider.token, swap)).status, 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
    // 同じ場所どうしは断る
    assert.equal((await reorderShiori(m2.token, { ...swap, toPinId: order[0] })).status, 400)
    const response = await reorderShiori(m2.token, swap)
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.result.status, 'reordered', response.text)
    const after = await waitFor('しおりの入れ替え', shioriNow, (found) => number(found.revision) === number(before.revision) + 1)
    // 1 つ目を 3 つ目の位置に落とす：あいだの行が上へずれ、1 つ目がいちばん下に入る
    assert.deepEqual(array(after.pinIds), [order[1], order[2], order[0]])
    // 出発の行 ＋ 3 か所。動かした順で並び、1 泊 2 日なので 2 日に分かれたまま
    const schedule = stopsOf(after)
    assert.deepEqual(schedule.map((stop) => stop.pinId ?? null).filter(Boolean), [order[1], order[2], order[0]])
    assert.deepEqual([...new Set(schedule.map((stop) => Number(stop.day)))], [1, 2])
    assert.deepEqual((await routesNow()).map((item) => item.id), ['shiori'])
  })

  await check('区間ごとの手段（changeLegMode）：メンバーが区間の手段を選ぶと保存して時刻を組み直し、旅全体の手段を選ぶと選択を外す', async () => {
    const changeLegMode = (idToken, data) => call(`${urls.functions}/changeLegMode`, { token: idToken, body: { data } })
    const before = await shioriNow()
    const order = array(before.pinIds)
    // 見本の旅は車の旅なので、電車・バスにして区間だけ上書きする（徒歩は 10 km より遠い区間では断られるので使わない）
    const leg = { tripId: flowId, routeId: 'shiori', from: order[0], to: order[1], mode: 'transit' }
    assert.equal((await changeLegMode(undefined, leg)).status, 401)
    // 決まった手段（電車・バス、車、徒歩、飛行機）以外は断る
    assert.equal((await changeLegMode(m1.token, { ...leg, mode: 'boat' })).status, 400)
    const outsider = await signUpAnonymously()
    assert.equal((await changeLegMode(outsider.token, leg)).status, 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
    // 隣り合っていない区間は、今のしおりの区間ではない
    assert.equal((await changeLegMode(m2.token, { ...leg, to: order[2] })).json.result.status, 'stale')
    const response = await changeLegMode(m2.token, leg)
    assert.equal(response.json?.result?.status, 'changed', response.text)
    const changed = await waitFor('区間の手段', shioriNow, (found) => number(found.revision) === number(before.revision) + 1)
    const modes = (route) => Object.fromEntries(Object.entries(route.legModes?.fields ?? {}).map(([key, value]) => [key, Object.values(value)[0]]))
    assert.deepEqual(modes(changed), { [`${order[0]}>${order[1]}`]: 'transit' })
    // 旅全体の手段に戻す（null）と、選択が外れる
    // 車の旅で車を選ぶのと同じ（旅全体の手段に戻す）
    assert.equal((await changeLegMode(m1.token, { ...leg, mode: null })).json.result.status, 'changed')
    const cleared = await waitFor('区間の選択を外す', shioriNow, (found) => number(found.revision) === number(changed.revision) + 1)
    assert.deepEqual(modes(cleared), {})
    // 旅全体と同じ手段（見本の旅は車）を送っても、選択は付かない
    assert.equal((await changeLegMode(m1.token, { ...leg, mode: 'car' })).json.result.status, 'changed')
    const same = await waitFor('旅全体と同じ手段', shioriNow, (found) => number(found.revision) === number(cleared.revision) + 1)
    assert.deepEqual(modes(same), {})
    // ルートは端末から書き換えられない
    assert.equal(await commit(m1.token, update(flow('routes', 'shiori'), { legModes: { x: 'car' } })), 403)
  })

  await check('飛行機の便：集合場所が遠くなって最初の区間が飛行機になると、「飛行機」を押さなくても時刻表から便を探して残す', async () => {
    const changeOrigin = (name, expectedOrigin) => call(`${urls.functions}/changeOrigin`, { token: m1.token, body: { data: { tripId: flowId, name, expectedOrigin } } })
    const legsOf = (route) => route.legFlights?.fields ?? {}
    const before = await shioriNow()
    const first = array(before.pinIds)[0]
    assert.deepEqual(Object.keys(legsOf(before)), [], '東京駅からは近いので、飛行機の区間はない')
    // 博多は既知の地名なので Places は呼ばない。見本の場所（長野のあたり）まで直線 600 km 以上あり、最初の区間が飛行機になる
    const far = await changeOrigin('博多', '東京駅')
    assert.equal(far.json?.result?.status, 'changed', far.text)
    const moved = await waitFor('集合場所を博多に', shioriNow, (found) => number(found.revision) === number(before.revision) + 1)
    const leg = legsOf(moved)[`@origin>${first}`]?.mapValue?.fields
    assert.ok(leg, '最初の区間に、飛行機の行き方の要約が残る')
    // 手元（Emulator）は、キーがなくても見本の時刻表を読む。便（乗れる便がなければ最終便の案内）に、時刻表の取得日時が付く。
    // 本番は、キーと時刻表しだいで便か目安になるので、要約が残ることだけを見る
    if (mode === 'local') assert.equal(leg.fetchedAt?.stringValue, '2026-11-18T00:00:00.000Z', JSON.stringify(leg))
    // 博多のまま 1 つ目と 2 つ目を入れ替えると、最初の区間が別の区間になる。入れ替え（reorderShiori）でも、押さなくても便を探して残す
    const reorderShiori = (fromPinId, toPinId) => call(`${urls.functions}/reorderShiori`, { token: m2.token, body: { data: { tripId: flowId, routeId: 'shiori', fromPinId, toPinId } } })
    const second = array(before.pinIds)[1]
    assert.equal((await reorderShiori(first, second)).json?.result?.status, 'reordered')
    const swapped = await waitFor('博多のまま入れ替える', shioriNow, (found) => number(found.revision) === number(before.revision) + 2)
    assert.deepEqual(Object.keys(legsOf(swapped)), [`@origin>${second}`])
    if (mode === 'local') assert.equal(legsOf(swapped)[`@origin>${second}`].mapValue.fields.fetchedAt?.stringValue, '2026-11-18T00:00:00.000Z')
    assert.equal((await reorderShiori(second, first)).json?.result?.status, 'reordered')
    await waitFor('入れ替えを戻す', shioriNow, (found) => number(found.revision) === number(before.revision) + 3)
    // 元に戻すと、飛行機の区間はなくなる
    const back = await changeOrigin('東京駅', '博多')
    assert.equal(back.json?.result?.status, 'changed', back.text)
    const restored = await waitFor('集合場所を東京駅に戻す', shioriNow, (found) => number(found.revision) === number(before.revision) + 4)
    assert.deepEqual(Object.keys(legsOf(restored)), [])
    assert.deepEqual(stopsOf(restored).map((stop) => stop.time), stopsOf(before).map((stop) => stop.time))
  })

  await check('しおりの時刻（setStopTime）：メンバーが出発時間や着く時刻を直すと、保存して時刻を組み直す', async () => {
    const setStopTime = (idToken, data) => call(`${urls.functions}/setStopTime`, { token: idToken, body: { data } })
    const before = await shioriNow()
    const order = array(before.pinIds)
    const depart = { tripId: flowId, routeId: 'shiori', key: '@origin', minutes: 600 }
    assert.equal((await setStopTime(undefined, depart)).status, 401)
    // 1 日の外の時刻、分の整数でない値、形の違うキーは断る
    assert.equal((await setStopTime(m1.token, { ...depart, minutes: 1440 })).status, 400)
    assert.equal((await setStopTime(m1.token, { ...depart, minutes: 9.5 })).status, 400)
    assert.equal((await setStopTime(m1.token, { ...depart, key: 'a/b' })).status, 400)
    const outsider = await signUpAnonymously()
    assert.equal((await setStopTime(outsider.token, depart)).status, 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
    // しおりにない場所の時刻は直せない
    assert.equal((await setStopTime(m2.token, { ...depart, key: 'nothing' })).json.result.status, 'stale')
    // 出発時間を 10 時にすると、集合時間は 15 分前についてくる
    const response = await setStopTime(m2.token, depart)
    assert.equal(response.json?.result?.status, 'changed', response.text)
    const departed = await waitFor('出発時間', shioriNow, (found) => number(found.revision) === number(before.revision) + 1)
    const origin = stopsOf(departed)[0]
    assert.equal(origin.pinId ?? null, null)
    assert.deepEqual([origin.meetTime, origin.time], ['09:45', '10:00'])
    // 2 つ目の場所に着く時刻を 15 時にする（メンバーなら誰でも）
    const arrived = await setStopTime(m3.token, { ...depart, key: order[1], minutes: 900 })
    assert.equal(arrived.json?.result?.status, 'changed', arrived.text)
    const after = await waitFor('着く時刻', shioriNow, (found) => number(found.revision) === number(departed.revision) + 1)
    assert.equal(stopsOf(after).find((stop) => stop.pinId === order[1]).time, '15:00')
    const times = Object.fromEntries(Object.entries(after.stopTimes?.fields ?? {}).map(([key, value]) => [key, Number(Object.values(value)[0])]))
    assert.deepEqual(times, { '@origin': 600, [order[1]]: 900 })
    // ルートの時刻は端末から書き換えられない
    assert.equal(await commit(m1.token, update(flow('routes', 'shiori'), { stopTimes: { x: 1 } })), 403)
  })

  await check('宿の枠（setLodging）：メンバーが泊まる夜を「宿は決めない」にでき、取り消せる', async () => {
    const setLodging = (idToken, data) => call(`${urls.functions}/setLodging`, { token: idToken, body: { data } })
    const before = await shioriNow()
    const skip = { tripId: flowId, routeId: 'shiori', night: 1, skip: true }
    assert.equal((await setLodging(undefined, skip)).status, 401)
    // 夜の数が整数でない、skip がない
    assert.equal((await setLodging(m1.token, { ...skip, night: 1.5 })).status, 400)
    assert.equal((await setLodging(m1.token, { tripId: flowId, routeId: 'shiori', night: 1 })).status, 400)
    const outsider = await signUpAnonymously()
    assert.equal((await setLodging(outsider.token, skip)).status, 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
    // 1 泊 2 日の旅に、2 日目の夜はない
    assert.equal((await setLodging(m1.token, { ...skip, night: 2 })).json.result.status, 'invalid')
    const lodgingOf = (route) => Object.fromEntries(Object.entries(route.lodging?.fields ?? {}).map(([key, value]) => [key, Object.values(value)[0]]))
    const response = await setLodging(m2.token, skip)
    assert.equal(response.json?.result?.status, 'changed', response.text)
    const skipped = await waitFor('宿は決めない', shioriNow, (found) => number(found.revision) === number(before.revision) + 1)
    assert.deepEqual(lodgingOf(skipped), { 1: '@skip' })
    // 行程（順番と時刻）は変わらない
    assert.deepEqual(stopsOf(skipped), stopsOf(before))
    assert.equal((await setLodging(m3.token, skip)).json.result.status, 'unchanged')
    // 過ごし方を自分で書ける（20 文字まで）
    assert.equal((await setLodging(m3.token, { ...skip, note: 'あ'.repeat(21) })).status, 400)
    assert.equal((await setLodging(m3.token, { ...skip, note: '車中泊' })).json.result.status, 'changed')
    const noted = await waitFor('過ごし方', shioriNow, (found) => number(found.revision) === number(skipped.revision) + 1)
    assert.deepEqual(lodgingOf(noted), { 1: '@skip:車中泊' })
    // 取り消すと、決まっていない夜に戻る
    assert.equal((await setLodging(m3.token, { ...skip, skip: false })).json.result.status, 'changed')
    const cleared = await waitFor('取り消し', shioriNow, (found) => number(found.revision) === number(noted.revision) + 1)
    assert.deepEqual(lodgingOf(cleared), {})
    // 宿の枠は端末から書き換えられない
    assert.equal(await commit(m1.token, update(flow('routes', 'shiori'), { lodging: { 1: '@skip' } })), 403)
  })

  await check('同じ場所を何度も訪れる（repeatVisit）：メンバーがしおりの行を複製すると、すぐ下に同じ場所の行が増え、その行だけを消せる', async () => {
    const repeatVisit = (idToken, data) => call(`${urls.functions}/repeatVisit`, { token: idToken, body: { data } })
    const setStopTime = (idToken, data) => call(`${urls.functions}/setStopTime`, { token: idToken, body: { data } })
    const before = await shioriNow()
    const order = array(before.pinIds)
    const add = { tripId: flowId, routeId: 'shiori', stopId: order[0], remove: false }
    assert.equal((await repeatVisit(undefined, add)).status, 401)
    // 行の ID の形が違う、remove がない
    assert.equal((await repeatVisit(m1.token, { ...add, stopId: 'a/b' })).status, 400)
    assert.equal((await repeatVisit(m1.token, { tripId: flowId, routeId: 'shiori', stopId: order[0] })).status, 400)
    const outsider = await signUpAnonymously()
    assert.equal((await repeatVisit(outsider.token, add)).status, 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
    // しおりにない行は足せず、1 行だけの場所の行は消せない（場所ごと外すのは、建物を消す）
    assert.equal((await repeatVisit(m1.token, { ...add, stopId: `${order[0]}~2` })).json.result.status, 'stale')
    assert.equal((await repeatVisit(m1.token, { ...add, remove: true })).json.result.status, 'last')
    const response = await repeatVisit(m2.token, add)
    assert.equal(response.json?.result?.status, 'changed', response.text)
    const copy = `${order[0]}~2`
    const added = await waitFor('行の複製', shioriNow, (found) => number(found.revision) === number(before.revision) + 1)
    assert.deepEqual(array(added.pinIds), [order[0], copy, order[1], order[2]])
    // 行の pinId はピンの ID のまま。複製した行にだけ stopId が付き、すぐ下に並ぶ。建物（ピン）は増えない
    const places = stopsOf(added).filter((stop) => stop.pinId)
    assert.deepEqual(places.map((stop) => [stop.pinId, stop.stopId ?? null]), [[order[0], null], [order[0], copy], [order[1], null], [order[2], null]])
    assert.equal(places[1].name, places[0].name)
    // 複製した行の着く時刻だけを直せる（メンバーなら誰でも）
    const timed = await setStopTime(m3.token, { tripId: flowId, routeId: 'shiori', key: copy, minutes: 720 })
    assert.equal(timed.json?.result?.status, 'changed', timed.text)
    const later = await waitFor('複製した行の時刻', shioriNow, (found) => number(found.revision) === number(added.revision) + 1)
    assert.equal(stopsOf(later).find((stop) => stop.stopId === copy).time, '12:00')
    // 複製した行を消すと、元の順番に戻り、その行の時刻の直しも外れる
    const removed = await repeatVisit(m1.token, { ...add, stopId: copy, remove: true })
    assert.equal(removed.json?.result?.status, 'changed', removed.text)
    const after = await waitFor('行を消す', shioriNow, (found) => number(found.revision) === number(later.revision) + 1)
    assert.deepEqual(array(after.pinIds), order)
    assert.deepEqual(Object.keys(after.stopTimes?.fields ?? {}).sort(), Object.keys(before.stopTimes?.fields ?? {}).sort())
    assert.deepEqual(stopsOf(after), stopsOf(before))
  })

  await check('建物を消す（removeBuilding）：メンバーが建物を消すと、ピンと模型が消え、しおりが残りの順で組み直される', async () => {
    const removeBuilding = (idToken, data) => call(`${urls.functions}/removeBuilding`, { token: idToken, body: { data } })
    const before = await shioriNow()
    const order = array(before.pinIds)
    const target = { tripId: flowId, pinId: order[1] }
    assert.equal((await removeBuilding(undefined, target)).status, 401)
    assert.equal((await removeBuilding(m1.token, { tripId: flowId })).status, 400)
    const outsider = await signUpAnonymously()
    assert.equal((await removeBuilding(outsider.token, target)).status, 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: outsider.token } })
    assert.equal((await removeBuilding(m1.token, { tripId: flowId, pinId: 'nothing' })).status, 404)
    // まだ建っていない候補は消せない
    const candidates = await wishFor(`wish2-${uid}`, '夜景を見たい')
    assert.equal((await removeBuilding(m1.token, { tripId: flowId, pinId: candidates[0] })).status, 400)
    // 建てた本人でなくても、メンバーなら消せる（誰ができるかは決めていない。仮に全員）
    const response = await removeBuilding(m3.token, target)
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.result.status, 'removed', response.text)
    assert.equal(await read(m1.token, flow('pins', order[1])), 404)
    assert.equal(await read(m1.token, flow('pins', order[1], 'model', 'current')), 404)
    const after = await waitFor('建物を消したしおり', shioriNow, (found) => number(found.revision) === number(before.revision) + 1)
    assert.deepEqual(array(after.pinIds), [order[0], order[2]])
    // 出発の行 ＋ 2 か所。日の分け方は、その日の 19 時までに入るかで決まる（#520）ので、日は 1 日目から旅の日程の中で、前から順
    const schedule = stopsOf(after)
    assert.deepEqual(schedule.map((stop) => stop.pinId ?? null).filter(Boolean), [order[0], order[2]])
    const days = schedule.map((stop) => Number(stop.day))
    assert.equal(days[0], 1)
    assert.ok(days.every((day, index) => day >= 1 && day <= 2 && (index === 0 || day >= days[index - 1])), JSON.stringify(days))
    // 消した建物は、もう一度は消せない
    assert.equal((await removeBuilding(m1.token, target)).status, 404)
    // 最後の建物まで消すと、計画中の旅のしおりはなくなる（次に建ったときに作り直される）
    for (const pinId of [order[0], order[2]]) assert.equal((await removeBuilding(m2.token, { tripId: flowId, pinId })).status, 200)
    assert.deepEqual((await routesNow()).map((item) => item.id), [])
  })

  await check('旅程の確定：発案者だけが確定・取り消しでき、確定中は建物と行程が止まり、発案者だけが時刻を直せる', async () => {
    const confirmShiori = (idToken, data) => call(`${urls.functions}/confirmShiori`, { token: idToken, body: { data } })
    const setStopTime = (idToken, minutes) =>
      call(`${urls.functions}/setStopTime`, { token: idToken, body: { data: { tripId: flowId, routeId: 'shiori', key: '@meet', minutes } } })
    // 前の確認で建物を全部消したので、建て直す
    const more = await wishFor(`wish3-${uid}`, 'そばを食べたい')
    await buildAndWait(m2, more[0])
    await waitFor('しおりに 1 か所', shioriNow, (found) => found && array(found.pinIds).length === 1)
    // 発案者（いちばん早く入った m1）でなければ断る
    assert.equal((await confirmShiori(m2.token, { tripId: flowId, confirm: true })).status, 403)
    // 1 泊 2 日の旅なので、1 日目の夜の宿が決まるまでは確定できない。宿を取らない夜にすると確定できる
    const setLodging = (idToken, skip) => call(`${urls.functions}/setLodging`, { token: idToken, body: { data: { tripId: flowId, routeId: 'shiori', night: 1, skip } } })
    assert.equal((await confirmShiori(m1.token, { tripId: flowId, confirm: true })).status, 400)
    assert.equal((await setLodging(m2.token, true)).json?.result?.status, 'changed')
    const confirmed = await confirmShiori(m1.token, { tripId: flowId, confirm: true })
    assert.equal(confirmed.json?.result?.status, 'confirmed', confirmed.text)
    const trip = plain((await get(m2.token, flow())).json)
    assert.equal(trip.confirmed.fields.uid.stringValue, m1.uid)
    // 確定の印は、メンバーが書けない・消せない
    assert.equal(await commit(m2.token, update(flow(), { confirmed: null }, ['updatedAt'])), 403)
    // 確定中は、旅の名前と日程を変えられず、行きたいことも足せない
    assert.equal(await commit(m2.token, update(flow(), { title: '書き換え' }, ['updatedAt'])), 403)
    const wish = { uid: m2.uid, text: '温泉に入りたい', bounds: null, status: 'pending' }
    assert.equal(await commit(m2.token, create(flow('wishes', `wish4-${uid}`), wish, ['createdAt'])), 403)
    // 確定中は、行く順番、区間の手段、旅全体の手段、集合場所を変えられない（どれも「確定している」と断る）
    const refusedAsConfirmed = async (name, data) => {
      const response = await call(`${urls.functions}/${name}`, { token: m2.token, body: { data: { tripId: flowId, ...data } } })
      assert.equal(response.status, 400, `${name}: ${response.text}`)
      assert.match(response.json?.error?.message ?? '', /確定/, `${name}: ${response.text}`)
    }
    await refusedAsConfirmed('reorderShiori', { routeId: 'shiori', fromPinId: more[0], toPinId: more[0] })
    await refusedAsConfirmed('changeLegMode', { routeId: 'shiori', from: '@origin', to: more[0], mode: 'walk' })
    await refusedAsConfirmed('changeTravelMode', { mode: trip.travelMode === 'transit' ? 'car' : 'transit' })
    await refusedAsConfirmed('changeOrigin', { name: '新宿駅', expectedOrigin: trip.origin })
    // 確定中は建てられず、建物を消せない
    assert.equal((await requestBuild(m2.token, { tripId: flowId, pinId: more[1] })).status, 400)
    assert.equal((await call(`${urls.functions}/removeBuilding`, { token: m2.token, body: { data: { tripId: flowId, pinId: more[0] } } })).status, 400)
    // 時刻は、発案者だけが直せる
    assert.equal((await setStopTime(m2.token, 480)).status, 400)
    assert.equal((await setStopTime(m1.token, 480)).json?.result?.status, 'changed')
    // 取り消しも発案者だけ。取り消すと、また全員で直せる
    // 確定しているあいだは、宿の枠も変えられない
    assert.equal((await setLodging(m2.token, false)).json?.result?.status, 'confirmed')
    assert.equal((await confirmShiori(m3.token, { tripId: flowId, confirm: false })).status, 403)
    const unconfirmed = await confirmShiori(m1.token, { tripId: flowId, confirm: false })
    assert.equal(unconfirmed.json?.result?.status, 'unconfirmed', unconfirmed.text)
    assert.equal(plain((await get(m2.token, flow())).json).confirmed, undefined)
    assert.equal((await setStopTime(m2.token, 490)).json?.result?.status, 'changed')
    await buildAndWait(m2, more[1])
    await waitFor('しおりに 2 か所', shioriNow, (found) => found && array(found.pinIds).length === 2)
  })

  await check('宿さがし：何日目の夜かを付けた希望を書くと、宿の種類の候補が立ち、その夜を覚えている', async () => {
    const wishName = `wish-inn-${uid}`
    const data = { uid: m1.uid, text: '1 日目の夜の宿', bounds: wishBounds, status: 'pending', lodgingNight: 1 }
    assert.equal(await commit(m1.token, create(flow('wishes', wishName), data, ['createdAt'])), 200)
    const pins = await waitFor('宿の候補', () => listOf(flow('pins')), (documents) => documents.some((document) => plain(document).wishId === wishName))
    const inns = pins.map(plain).filter((pin) => pin.wishId === wishName)
    assert.ok(inns.length >= 1)
    for (const inn of inns) {
      assert.equal(inn.category, 'lodging', inn.name)
      assert.equal(Number(inn.lodgingNight), 1, inn.name)
      assert.equal(inn.status, 'candidate')
    }
  })

  await check('ごはんのお店さがし：どの日のどのごはんかを付けた希望を書くと、食べものの候補が立ち、その枠を覚えている', async () => {
    const wishName = `wish-meal-${uid}`
    const data = { uid: m1.uid, text: '1 日目の昼ごはん', bounds: wishBounds, status: 'pending', mealSlot: '1-lunch' }
    assert.equal(await commit(m1.token, create(flow('wishes', wishName), data, ['createdAt'])), 200)
    const pins = await waitFor('ごはんの候補', () => listOf(flow('pins')), (documents) => documents.some((document) => plain(document).wishId === wishName))
    const meals = pins.map(plain).filter((pin) => pin.wishId === wishName)
    assert.ok(meals.length >= 1)
    for (const meal of meals) {
      assert.equal(meal.category, 'food', meal.name)
      assert.equal(meal.mealSlot, '1-lunch', meal.name)
      assert.equal(meal.lodgingNight, undefined, meal.name)
    }
  })

  await check('イベントさがし：花火の希望には日程の日に開催される見本の花火大会が立ち、日程にない見学会は見つからない理由を残す（#581）', async () => {
    // 確認の旅は 2026-11-21（土曜）の日帰り。見本の花火は土曜の夜、見学会は平日の朝
    const fireName = `wish-fire-${uid}`
    assert.equal(await commit(m1.token, create(flow('wishes', fireName), { uid: m1.uid, text: '花火がみたい', bounds: wishBounds, status: 'pending' }, ['createdAt'])), 200)
    const pins = await waitFor('花火の候補', () => listOf(flow('pins')), (documents) => documents.some((document) => plain(document).wishId === fireName))
    const fires = pins.map(plain).filter((pin) => pin.wishId === fireName)
    assert.ok(fires.length >= 1)
    for (const fire of fires) {
      const event = fire.event?.fields ?? {}
      assert.equal(event.date?.stringValue, '2026-11-21', fire.name)
      assert.equal(event.kind?.stringValue, 'fireworks', fire.name)
      assert.equal(fire.suggestedBy, 'stub', fire.name)
    }
    const tourName = `wish-tour-${uid}`
    assert.equal(await commit(m1.token, create(flow('wishes', tourName), { uid: m1.uid, text: '工場見学会に行きたい', bounds: wishBounds, status: 'pending' }, ['createdAt'])), 200)
    const tour = await waitFor('見学会は見つからない', async () => plain((await get(m1.token, flow('wishes', tourName))).json), (wish) => wish.status === 'failed')
    assert.equal(tour.notFound, 'event')
    // 端末は、見つからない理由を自分で書けない
    assert.equal(await commit(m1.token, create(flow('wishes', `wish-fake-${uid}`), { uid: m1.uid, text: '花火', bounds: wishBounds, status: 'pending', notFound: 'event' }, ['createdAt'])), 403)
  })

  await check('しおりの確認で作ったデータを片付ける', async () => {
    for (const person of people) assert.equal(await commit(person.token, remove(flow('members', person.uid))), 200)
    for (const person of [m2, m3]) await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: person.token } })
  })
}

await check('ログインなしでは Gemini を呼べない', async () => {
  const response = await call(`${urls.functions}/pingGemini`, { body: { data: null } })
  assert.equal(response.status, 401)
})

await check('ログインすると Gemini の応答が返る', async () => {
  const response = await call(`${urls.functions}/pingGemini`, { token, body: { data: null } })
  assert.equal(response.status, 200, response.text)
  assert.ok(response.json.result.text.length > 0)
  // ping は印（合言葉と回数の上限）を付けないので、どの経路でも応答を作るのは stub。
  // ローカルは既定の stub なので fellBack は false。本番は人が Cloud の Gemini（vertex）を有効にしていると、
  // 印がないため固定の応答に戻した印（fellBack: true）になる。どちらでも費用のかかる呼び出しは起きていない
  assert.equal(response.json.result.provider, 'stub')
  if (mode === 'local') assert.equal(response.json.result.fellBack, false)
})

// ---- 合言葉：本物の AI（Cloud の Gemini）を自分の希望で使えるようにする ----
// 合言葉の値は環境変数 AI_PASSPHRASE。ローカルの確認テストは npm run verify が付ける。本番は人が入れる（空なら必ず断る）

const unlockAi = (idToken, data) => call(`${urls.functions}/unlockAi`, { token: idToken, body: { data } })

await check('ログインなし、空、違う合言葉では、本物の AI を使えるようにならない', async () => {
  assert.equal((await unlockAi(undefined, { passphrase: 'x' })).status, 401)
  assert.equal((await unlockAi(token, {})).status, 400)
  assert.equal((await unlockAi(token, { passphrase: '' })).status, 400)
  const wrong = await unlockAi(token, { passphrase: 'not-the-passphrase' })
  // 本番で合言葉が未設定なら 400（failed-precondition）、設定済みなら 403（permission-denied）
  assert.ok([400, 403].includes(wrong.status), wrong.text)
  assert.equal(await read(token, path('aiAccess', uid)), 404)
})

if (mode === 'local') {
  await check('合言葉が合うと記録ができ、本人だけが読める', async () => {
    const expected = process.env.AI_PASSPHRASE
    assert.ok(expected, 'npm run verify が AI_PASSPHRASE を付けているはず')
    const response = await unlockAi(token, { passphrase: expected })
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.result.status, 'unlocked')
    assert.equal(await read(token, path('aiAccess', uid)), 200)
    const other = await signUpAnonymously()
    assert.equal(await read(other.token, path('aiAccess', uid)), 403)
    assert.equal(await commit(other.token, create(path('aiAccess', other.uid), { uid: other.uid })), 403)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: other.token } })
  })
}

// ---- 旅の合言葉：招待リンクの代わりに、短い合言葉で旅を開く ----
// 合言葉を作るのと照合するのは Functions だけ。端末からは joinCodes を読めない（総当たりを Functions で数える）

const issueJoinCode = (idToken, data) => call(`${urls.functions}/issueJoinCode`, { token: idToken, body: { data } })
const findTripByJoinCode = (idToken, data) =>
  call(`${urls.functions}/findTripByJoinCode`, { token: idToken, body: { data } })
const moveMemberships = (idToken, data) => call(`${urls.functions}/moveMemberships`, { token: idToken, body: { data } })
const previewTrip = (idToken, data) => call(`${urls.functions}/previewTrip`, { token: idToken, body: { data } })

await check('ログインなし、形の違う合言葉では、旅を引けない。合言葉の置き場は端末から読めない', async () => {
  assert.equal((await findTripByJoinCode(undefined, { joinCode: 'ABCDEF' })).status, 401)
  assert.equal((await findTripByJoinCode(token, {})).status, 400)
  assert.equal((await findTripByJoinCode(token, { joinCode: 'ABC' })).status, 400)
  // 0・O・1・I は使わない文字
  assert.equal((await findTripByJoinCode(token, { joinCode: 'O0I1AB' })).status, 400)
  assert.equal((await issueJoinCode(undefined, { tripId: 'x' })).status, 401)
  assert.equal((await issueJoinCode(token, {})).status, 400)
  // 招待の画面の旅の名前：ログインなし、形の違う ID、ない旅では返さない
  assert.equal((await previewTrip(undefined, { tripId: 'x' })).status, 401)
  assert.equal((await previewTrip(token, {})).status, 400)
  assert.equal((await previewTrip(token, { tripId: 'a/b' })).status, 400)
  assert.equal((await previewTrip(token, { tripId: `smoke-no-such-trip-${uid}` })).status, 404)
  assert.equal(await read(token, path('joinCodes', 'ABCDEF')), 403)
  assert.equal(await read(token, path('joinCodeAttempts', uid)), 403)
  assert.equal((await moveMemberships(undefined, { fromIdToken: 'x' })).status, 401)
  assert.equal((await moveMemberships(token, {})).status, 400)
  assert.equal((await moveMemberships(token, { fromIdToken: 'not-a-token' })).status, 403)
  // 自分から自分へは引き継げない
  assert.equal((await moveMemberships(token, { fromIdToken: token })).status, 400)
})

// 本番では、合言葉と旅を残さないよう、ここから先は手元だけで確かめる
if (mode === 'local') {
  const owner = await signUpAnonymously()
  const guest = await signUpAnonymously()
  const codeTrip = `smoke-code-${owner.uid}`
  let joinCode
  let prepared

  await check('旅を作ると、招待のシートを開く前に旅の合言葉ができている', async () => {
    assert.equal(await commit(owner.token, ...createTripWrites(codeTrip, owner.uid)), 200)
    // 旅ができたときに Functions（prepareJoinCode）が裏で作る。トリガーが走り終わるまで待つ
    for (let attempt = 0; attempt < 40 && !prepared; attempt += 1) {
      prepared = (await fieldsOf(owner.token, path('trips', codeTrip))).joinCode?.stringValue
      if (!prepared) await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert.match(prepared ?? '', /^[A-HJ-NP-Z2-9]{6}$/)
  })

  await check('メンバーが頼むと旅の合言葉が返り、何度頼んでも同じ合言葉が返る', async () => {
    // メンバーでない人は作れない。端末から旅に合言葉を書き込むこともできない
    assert.equal((await issueJoinCode(guest.token, { tripId: codeTrip })).status, 403)
    assert.equal(await commit(owner.token, update(path('trips', codeTrip), { joinCode: 'ABCDEF' })), 403)
    const first = await issueJoinCode(owner.token, { tripId: codeTrip })
    assert.equal(first.status, 200, first.text)
    joinCode = first.json.result.joinCode
    // 裏で作っておいた合言葉が、そのまま返る（作り直さない）
    assert.equal(joinCode, prepared)
    assert.match(joinCode, /^[A-HJ-NP-Z2-9]{6}$/)
    assert.equal((await issueJoinCode(owner.token, { tripId: codeTrip })).json.result.joinCode, joinCode)
    assert.equal((await fieldsOf(owner.token, path('trips', codeTrip))).joinCode.stringValue, joinCode)
  })

  await check('参加する前の人には、招待の画面に出す旅の名前だけを返す（出発地や日程は返さない）', async () => {
    assert.equal(await read(guest.token, path('trips', codeTrip)), 403)
    const preview = await previewTrip(guest.token, { tripId: codeTrip })
    assert.equal(preview.status, 200, preview.text)
    assert.deepEqual(preview.json.result, { title: tripInfo().title })
  })

  await check('合言葉を入れると旅が分かり、名前を入れて参加できる。小文字や空白が混ざっていてもよい', async () => {
    const found = await findTripByJoinCode(guest.token, { joinCode: ` ${joinCode.slice(0, 3).toLowerCase()}-${joinCode.slice(3)} ` })
    assert.equal(found.status, 200, found.text)
    assert.equal(found.json.result.tripId, codeTrip)
    assert.equal(
      await commit(guest.token, create(path('trips', codeTrip, 'members', guest.uid), memberInfo(guest.uid), ['joinedAt'])),
      200,
    )
    assert.equal(await read(guest.token, path('trips', codeTrip)), 200)
  })

  await check('違う合言葉を続けて入れると、しばらく断られる（合っていても断る）', async () => {
    const stranger = await signUpAnonymously()
    // joinCode と 1 文字だけ違う合言葉。ほかの旅に当たることは、まずない
    const wrong = `${joinCode.slice(0, 5)}${joinCode[5] === 'A' ? 'B' : 'A'}`
    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await findTripByJoinCode(stranger.token, { joinCode: wrong })).status, 404)
    }
    assert.equal((await findTripByJoinCode(stranger.token, { joinCode: wrong })).status, 429)
    assert.equal((await findTripByJoinCode(stranger.token, { joinCode })).status, 429)
    await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: stranger.token } })
  })

  // ---- Google アカウントでログインして別の人（uid）になったときの引き継ぎ ----
  // 確認テストは Google アカウントを作れないので、匿名の 2 人で確かめる（引き継ぐ先は誰でもよい。
  // 引き継ぐ元は、本人のトークンを持っている匿名の人だけ）

  await check('前の自分が参加していた旅と書いた希望を、今の自分へ引き継ぐ。場所を探している途中でも、候補は今の自分のもの', async () => {
    const before = await signUpAnonymously()
    const after = await signUpAnonymously()
    const shared = `smoke-move-shared-${before.uid}`
    const solo = `smoke-move-solo-${before.uid}`
    // shared は 2 人とも参加している旅、solo は前の自分だけが参加している旅
    assert.equal(await commit(after.token, ...createTripWrites(shared, after.uid)), 200)
    assert.equal(
      await commit(
        before.token,
        create(path('trips', shared, 'members', before.uid), memberInfo(before.uid, { displayName: '前の自分' }), ['joinedAt']),
      ),
      200,
    )
    assert.equal(await commit(before.token, ...createTripWrites(solo, before.uid)), 200)
    const wish = path('trips', solo, 'wishes', 'w-move')
    assert.equal(
      await commit(before.token, create(wish, { uid: before.uid, text: '温泉', bounds: null, status: 'pending' }, ['createdAt'])),
      200,
    )
    // 希望を書いた直後（場所を探している途中）に引き継ぐ。探し終わってから立つ候補も、今の自分のものになる
    const moved = await moveMemberships(after.token, { fromIdToken: before.token })
    assert.equal(moved.status, 200, moved.text)
    assert.equal(moved.json.result.moved, 2)
    await waitFor(
      '希望の場所探し',
      () => fieldsOf(after.token, wish),
      (fields) => ['done', 'failed'].includes(fields.status?.stringValue),
    )

    // 前の自分だけの旅：今の自分がメンバーになり、名前と希望を受け取る。旅を作った人も今の自分になる
    assert.equal((await fieldsOf(after.token, path('trips', solo))).createdBy.stringValue, after.uid)
    assert.equal((await fieldsOf(after.token, path('trips', solo, 'members', after.uid))).uid.stringValue, after.uid)
    assert.equal((await fieldsOf(after.token, wish)).uid.stringValue, after.uid)
    assert.equal((await fieldsOf(after.token, wish)).status.stringValue, 'done')
    // しおりの空いた時間への提案（filler）は誰の希望でもない（uid が空）ので、数えない（#520）
    const pins = ((await get(after.token, path('trips', solo, 'pins'))).json.documents ?? []).filter((pin) => !pin.fields.filler)
    assert.ok(pins.length > 0, '希望の候補のピンが立っていない')
    for (const pin of pins) assert.equal(pin.fields.uid.stringValue, after.uid)
    // 2 人とも参加していた旅：今の自分の名前が残り、前の自分はいなくなる（同じ人が 2 人並ばない）
    const members = (await get(after.token, path('trips', shared, 'members'))).json.documents ?? []
    assert.deepEqual(members.map((member) => member.fields.uid.stringValue), [after.uid])
    assert.equal(members[0].fields.displayName.stringValue, 'テスト')
    // 前の自分は、もうどちらの旅も読めない。もう一度頼んでも、引き継ぐものはない
    assert.equal(await read(before.token, path('trips', solo)), 403)
    assert.equal((await moveMemberships(after.token, { fromIdToken: before.token })).json.result.moved, 0)
  })
}

if (mode === 'local') await check('建物辞書の模型を読み、出典を引き継いで完成する（本番APIなし）', async () => {
  const { createRequire } = await import('node:module')
  const require = createRequire(import.meta.url)
  const { libraryEntry } = require('../functions/lib/features/build-model/logic/library.js')
  const { prefabFor } = require('../functions/lib/features/build-model/logic/prefabs.js')
  const identity = { name: '辞書確認の温泉', area: 'テスト専用地域', category: 'onsen' }
  // 辞書から読み出す経路の検証用。模型生成は実行しない。
  const entry = libraryEntry(identity, { source: 'argon', json: prefabFor('onsen'), reference: { text: '検証用', url: 'https://example.com/test', license: 'CC BY-SA' } })
  const cacheTrip = `cache-${uid}`
  const cachePin = path('trips', cacheTrip, 'pins', 'cached')
  assert.equal(await commit(a.token, ...createTripWrites(cacheTrip, a.uid)), 200)
  assert.equal(await commit('owner', create(path('modelCache', entry.key), entry)), 200)
  assert.equal(await commit('owner', create(cachePin, { ...identity, description: '検証用', wishId: 'none', uid, status: 'candidate', suggestedBy: 'stub', placeId: null, builtBy: null, buildStartedAt: null }, ['createdAt', 'updatedAt'])), 200)
  assert.equal((await requestBuild(a.token, { tripId: cacheTrip, pinId: 'cached' })).status, 200)
  await waitFor('辞書からの建築', () => fieldsOf(a.token, cachePin), (fields) => fields.status?.stringValue === 'done')
  const saved = (await get(a.token, `${cachePin}/model/current`)).json.fields
  assert.equal(saved.source.stringValue, 'argon')
  assert.equal(saved.reference.mapValue.fields.license.stringValue, 'CC BY-SA')
  assert.equal(await commit(a.token, update(path('modelCache', entry.key), { version: 0 })), 403)
  assert.equal(await commit('owner', remove(path('modelCache', entry.key))), 200)
})

// 旅そのものは端末から消せない（旅を消す画面がない）。本番では、誰も読めない「確認テスト」の旅と希望が
// デプロイのたびに 1 つずつ残る。a が抜けたあとは、どの端末からも読めない。
await check('テストデータを片付ける', async () => {
  if (mode !== 'local') {
    assert.equal(await commit(token, remove(path('trips', tripId, 'members', uid))), 200)
  }
  const user = await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: token } })
  assert.equal(user.status, 200, user.text)
})

if (mode === 'local') {
  process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${8080 + EMULATOR_PORT_OFFSET}`
  await (await import('./origin-model.emulator.mjs')).verifyOriginModels()
}
console.log(`${mode} の確認がすべて通りました`)
