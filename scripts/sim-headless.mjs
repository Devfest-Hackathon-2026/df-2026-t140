// 複数人シミュレーションの台本（web/src/pages/dev-sim/config/scenario.json）を、画面なしで Emulator に流し、
// 最後の状態を確かめる。画面の台本（pages/dev-sim/model/runner.ts）と同じ段の一覧を、同じ順で進める。
// 画面の段はそれぞれの画面の UI を操作するが、ここでは端末の SDK と同じ形の REST の書き込みで行う。
// 使い方：firebase emulators:exec "node scripts/sim-headless.mjs"（npm run verify が呼ぶ）
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PROJECT_ID = 'konbu-devfest-hackathon-2026'
const REGION = 'asia-northeast1'
// 2 組目の Emulator（npm run dev:alt）では、ポートを全部この数だけずらす
const EMULATOR_PORT_OFFSET = Number(process.env.EMULATOR_PORT_OFFSET ?? 0)
const urls = {
  site: `http://127.0.0.1:${5002 + EMULATOR_PORT_OFFSET}`,
  auth: `http://127.0.0.1:${9099 + EMULATOR_PORT_OFFSET}/identitytoolkit.googleapis.com/v1`,
  firestore: `http://127.0.0.1:${8080 + EMULATOR_PORT_OFFSET}/v1`,
  functions: `http://127.0.0.1:${5001 + EMULATOR_PORT_OFFSET}/${PROJECT_ID}/${REGION}`,
}
const database = `projects/${PROJECT_ID}/databases/(default)/documents`
const scenario = JSON.parse(readFileSync(fileURLToPath(new URL('../web/src/pages/dev-sim/config/scenario.json', import.meta.url)), 'utf8'))

// ---- Firestore の REST API を、画面の SDK と同じ形で呼ぶ小道具（scripts/smoke.mjs と同じ形） ----

async function call(url, { body, token, method } = {}) {
  const response = await fetch(url, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

function toValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'number') return { doubleValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } }
  return { mapValue: { fields: toFields(value) } }
}
const toFields = (data) => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, toValue(value)]))
const path = (...segments) => `${database}/${segments.join('/')}`
const create = (name, data, serverTime = []) => ({
  update: { name, fields: toFields(data) },
  updateTransforms: serverTime.map((fieldPath) => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })),
  currentDocument: { exists: false },
})
const update = (name, data) => ({
  update: { name, fields: toFields(data) },
  updateMask: { fieldPaths: Object.keys(data) },
  currentDocument: { exists: true },
})
const remove = (name) => ({ delete: name })
const commit = async (token, ...writes) => (await call(`${urls.firestore}/${database}:commit`, { token, body: { writes } })).status
const get = (token, name) => call(`${urls.firestore}/${name}`, { token })
/** 項目の値の外側（stringValue など）を 1 枚はがす。配列は値の一覧にする */
const plain = (document) =>
  Object.fromEntries(
    Object.entries(document.fields ?? {}).map(([key, value]) => {
      const inner = Object.values(value)[0]
      return [key, inner?.values ? inner.values.map((item) => Object.values(item)[0]) : inner]
    }),
  )
const idOf = (document) => document.name.split('/').pop()

async function waitFor(what, read, done, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    assert.ok(Date.now() < until, `${what}を待ちましたが、終わりませんでした`)
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

const init = await call(`${urls.site}/__/firebase/init.json`)
const apiKey = init.json.apiKey ?? 'emulator'
async function signUpAnonymously() {
  const response = await call(`${urls.auth}/accounts:signUp?key=${apiKey}`, { body: { returnSecureToken: true } })
  assert.equal(response.status, 200, response.text)
  return { token: response.json.idToken, uid: response.json.localId }
}

// ---- 台本を進める ----

const people = {}
for (const member of scenario.members) people[member.id] = { ...(await signUpAnonymously()), name: member.name }
const tripId = `sim-${people.a.uid}`
const trip = (...segments) => path('trips', tripId, ...segments)
const memberDoc = (id, votedRouteId = null) => ({ uid: people[id].uid, displayName: people[id].name, color: '#1f9d55', votedRouteId })
/** 希望の文に地名があるので、範囲は日本全体でよい（画面では、いま映している範囲が入る） */
const JAPAN_WIDE = { north: 45.6, south: 24.0, east: 146.0, west: 122.9 }

const listOf = async (name) => (await get(people.a.token, name)).json.documents ?? []
const pinsNow = async () => (await listOf(trip('pins'))).map((document) => ({ id: idOf(document), ...plain(document) }))
const routesNow = async () => (await listOf(trip('routes'))).map((document) => ({ id: idOf(document), ...plain(document) })).sort((left, right) => left.label.localeCompare(right.label))
const tripNow = async () => plain((await get(people.a.token, trip())).json)
const wishOf = (by) => scenario.wishes.find((wish) => wish.by === by)
const pinNamed = async (name) => {
  const pin = (await pinsNow()).find((candidate) => candidate.name === name)
  assert.ok(pin, `${name} のピンがありません`)
  return pin
}

async function build(id, placeName) {
  const pin = await pinNamed(placeName)
  const response = await call(`${urls.functions}/requestBuild`, { token: people[id].token, body: { data: { tripId, pinId: pin.id } } })
  assert.equal(response.status, 200, response.text)
  await waitFor(`${placeName} の建築`, () => get(people.a.token, trip('pins', pin.id)), (result) => plain(result.json).status === 'done')
  return pin.id
}

const shioriNow = async () => (await routesNow()).find((route) => route.id === 'shiori')
/** しおりのルートに、建った場所が count か所入るまで待つ */
const shioriWith = (count) => waitFor(`しおりに ${count} か所`, shioriNow, (route) => route?.pinIds.length === count)

const actions = {
  async create() {
    const info = { ...scenario.trip, status: 'planning', decidedRouteId: null, createdBy: people.a.uid }
    assert.equal(await commit(people.a.token, create(trip(), info, ['createdAt', 'updatedAt']), create(trip('members', people.a.uid), memberDoc('a'), ['joinedAt'])), 200)
  },
  async invite() {
    assert.equal((await get(people.a.token, trip())).status, 200)
  },
  async 'join-b'() {
    assert.equal(await commit(people.b.token, create(trip('members', people.b.uid), memberDoc('b'), ['joinedAt'])), 200)
  },
  async 'join-c'() {
    assert.equal(await commit(people.c.token, create(trip('members', people.c.uid), memberDoc('c'), ['joinedAt'])), 200)
    assert.equal((await listOf(trip('members'))).length, 3)
  },
}
for (const id of ['a', 'b', 'c']) {
  actions[`wish-${id}`] = async () => {
    const wish = wishOf(id)
    const wishId = `wish-${id}-${people.a.uid}`
    const data = { uid: people[id].uid, text: wish.text, bounds: JAPAN_WIDE, status: 'pending' }
    assert.equal(await commit(people[id].token, create(trip('wishes', wishId), data, ['createdAt'])), 200)
    // 候補のピンは 1 回の書き込みでまとめて立つので、1 つ見えれば全部そろっている。
    // 旅の地方（甲信越）の中に見本の場所が少ないと 3 件に満たないことがある（範囲の外からは足さない）
    const pins = await waitFor(`${wish.text} → ピン`, pinsNow, (list) => list.some((pin) => pin.wishId === wishId))
    assert.ok(pins.some((pin) => pin.name === wish.build), `${wish.text} の候補に ${wish.build} がありません（${pins.map((pin) => pin.name).join('、')}）`)
  }
  actions[`build-${id}`] = async () => {
    const pinId = await build(id, wishOf(id).build)
    const count = ['a', 'b', 'c'].indexOf(id) + 1
    const route = await shioriWith(count)
    assert.ok(route.pinIds.includes(pinId), `しおりに ${wishOf(id).build} が入っていません`)
    // ルート案は作らない（しおりの 1 本だけ）
    assert.deepEqual((await routesNow()).map((item) => item.id), ['shiori'])
  }
}
actions.shiori = async () => assert.equal((await shioriNow()).pinIds.length, 3)
actions.place = async () => {}
actions['place-back'] = async () => {}
actions['back-to-map'] = async () => {}
let orderBefore = []
actions['build-added'] = async () => {
  orderBefore = (await shioriNow()).pinIds
  const pinId = await build(scenario.addedPlace.by, scenario.addedPlace.name)
  const route = await shioriWith(4)
  assert.ok(route.pinIds.includes(pinId), 'しおりに、足した場所が入っていません')
  // 前の順番はそのまま（足した場所を除くと、前と同じ並び）
  assert.deepEqual(route.pinIds.filter((id) => id !== pinId), orderBefore)
}
actions['shiori-added'] = async () => assert.equal((await shioriNow()).pinIds.length, 4)

for (const step of scenario.steps) {
  assert.ok(actions[step.id], `台本の段 ${step.id} に、画面なしの操作がありません`)
  await actions[step.id]()
  console.log(`ok - ${step.id}: ${step.caption}`)
}

// ---- 最後の状態 ----
const finalTrip = await tripNow()
assert.equal(finalTrip.status, 'planning')
const shiori = await shioriNow()
assert.equal(shiori.pinIds.length, 4)
assert.ok(shiori.pinIds.includes((await pinNamed(scenario.addedPlace.name)).id))
const members = (await listOf(trip('members'))).map(plain)
assert.equal(members.length, 3)
console.log(`ok - 最後の状態：しおりに ${shiori.pinIds.length} か所、メンバー ${members.length} 人`)

// 片付け：メンバーを抜き、匿名ユーザーを消す（旅そのものは端末から消せない）
for (const id of ['a', 'b', 'c']) {
  assert.equal(await commit(people[id].token, remove(trip('members', people[id].uid))), 200)
  await call(`${urls.auth}/accounts:delete?key=${apiKey}`, { body: { idToken: people[id].token } })
}
console.log('複数人シミュレーション（画面なし）が最後まで通りました')
