// ローカルの Emulator と本番に、同じ確認を行う。使い方：node scripts/smoke.mjs local|prod
import assert from 'node:assert/strict'

const PROJECT_ID = 'konbu-devfest-hackathon-2026'
const REGION = 'asia-northeast1'
const mode = process.argv[2]
assert.ok(mode === 'local' || mode === 'prod', 'local か prod を指定してください')

const urls =
  mode === 'local'
    ? {
        site: 'http://127.0.0.1:5002',
        auth: 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1',
        firestore: 'http://127.0.0.1:8080/v1',
        functions: `http://127.0.0.1:5001/${PROJECT_ID}/${REGION}`,
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

await check('メンバーなら誰でも旅の基本情報を直せるが、状態と決定したルートは直せない', async () => {
  assert.equal(await commit(b.token, update(trip, { title: '秋の信州ふらり旅', endDate: '2026-11-22' }, ['updatedAt'])), 200)
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
// 模型は用意した部品（固定の応答）なので、本番でも費用はかからない。本番では、確認用の旅に建物が 1 つ残る。
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
  // 模型の JSON は、メンバーが読める。今夜は用意した部品（parts）で、決めた形（version 1 と部品の配列）
  const model = await get(b.token, `${pin}/model/current`)
  assert.equal(model.status, 200)
  assert.equal(model.json.fields.source.stringValue, 'parts')
  const json = model.json.fields.json.mapValue.fields
  assert.equal(Number(json.version.integerValue ?? json.version.doubleValue), 1)
  const parts = json.parts.arrayValue.values
  assert.ok(parts.length >= 8)
  assert.deepEqual(Object.keys(parts[0].mapValue.fields).sort(), ['color', 'position', 'shape', 'size'])
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
    assert.equal(await commit(b.token, update(trip, { origin: '新宿駅' }, ['updatedAt'])), 200)
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
  const flowId = `flow-${uid}`
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
    const pins = await waitFor(`${text} → ピン`, () => listOf(flow('pins')), (documents) => documents.filter((document) => plain(document).wishId === wishName).length === 3)
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

// 旅そのものは端末から消せない（旅を消す画面がない）。本番では、誰も読めない「確認テスト」の旅と希望が
// デプロイのたびに 1 つずつ残る。a が抜けたあとは、どの端末からも読めない。
await check('テストデータを片付ける', async () => {
  if (mode !== 'local') {
    assert.equal(await commit(token, remove(path('trips', tripId, 'members', uid))), 200)
  }
  const user = await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: token } })
  assert.equal(user.status, 200, user.text)
})

console.log(`${mode} の確認がすべて通りました`)
