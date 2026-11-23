// FirestoreのI/O・競合は本物のローカルEmulatorで検証する。Firestoreの模倣は作らない。
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export async function verifyOriginModels() {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^(127\.0\.0\.1|localhost|0\.0\.0\.0):\d+$/, 'ローカルFirestore Emulatorを指定してください')
  const requireFunctions = createRequire(new URL('../functions/package.json', import.meta.url))
  const require = createRequire(import.meta.url)
  const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app')
  const { getFirestore, Timestamp } = requireFunctions('firebase-admin/firestore')
  const { resolveOrigin, changeOrigin } = require('../functions/lib/features/resolve-origin/usecase.js')
  const { updateRoutesForTrip } = require('../functions/lib/features/propose-routes/usecase.js')
  const { buildModelForPin } = require('../functions/lib/features/build-model/usecase.js')
  const { prefabFor } = require('../functions/lib/features/build-model/logic/prefabs.js')
  const { modelKey } = require('../functions/lib/features/build-model/logic/library.js')
  const { confirmShiori } = require('../functions/lib/features/confirm-shiori/usecase.js')
  const app = initializeApp({ projectId: 'konbu-devfest-hackathon-2026' }, `origin-test-${randomUUID()}`)
  const db = getFirestore(app)
  const id = `origin-model-${randomUUID()}`
  const trip = db.collection('trips').doc(id)
  const staleTrip = db.collection('trips').doc(`${id}-stale`)
  const identity = { name: '辞書確認の温泉', area: `検証用${id}`, category: 'onsen' }
  const cache = db.collection('modelCache').doc(modelKey(identity))
  const failureIdentity = { ...identity, name: '失敗する模型' }
  const failCache = db.collection('modelCache').doc(modelKey(failureIdentity))
  const gate = { isOpenToAll: async () => false, isUnlocked: async () => true }
  let searches = 0
  const ports = { db, aiGate: gate, placesApi: { enabled: () => true, findPlace: async () => { searches++; return { placeId: 'test', location: { lat: 35.62, lng: 139.71 } } } } }
  try {
    const now = Timestamp.now()
    await trip.set({ origin: '東京駅', startDate: '2026-11-21', endDate: null, status: 'planning', title: 'Emulator確認', createdBy: 'u', createdAt: now, updatedAt: now })
    await trip.collection('members').doc('u').set({ uid: 'u', displayName: '検証用', color: '#1f9d55' })
    await trip.collection('pins').doc('place').set({ name: '白骨温泉', status: 'done', location: { lat: 36.1, lng: 137.6 }, uid: 'u', category: 'onsen', createdAt: now, updatedAt: now })

    for (const name of ['目黒', 'めぐろ', '目黒駅']) assert.equal((await resolveOrigin(ports, name, 'u')).status, 'resolved')
    assert.equal(searches, 0)
    assert.equal((await resolveOrigin(ports, '東京都世田谷区の待ち合わせ場所', 'u')).status, 'resolved')
    assert.equal(searches, 1)
    assert.equal((await resolveOrigin({ ...ports, aiGate: { ...gate, isUnlocked: async () => false } }, '未知の場所', 'u')).status, 'unavailable')
    assert.equal(searches, 1)
    console.log('ok - 出発地検索：既知の地点はAPIを呼ばず、未知の地点は許可された人だけ検索する')

    // 初回生成を外部ポートで保留し、実際のFirestore上で出発地変更を先に完了する。
    let release
    let announce
    const entered = new Promise((resolve) => { announce = resolve })
    let generatedRoutes = 0
    const generating = updateRoutesForTrip({ db, aiGate: gate, gemini: { run: (task, input) => {
      generatedRoutes++
      announce()
      return new Promise((resolve) => { release = () => resolve({ output: task.stub(input), provider: 'stub', fellBack: false }) })
    } } }, id)
    await entered
    assert.equal((await changeOrigin(ports, { tripId: id, uid: 'u', name: '目黒駅', expectedOrigin: '東京駅' })).status, 'changed')
    release()
    assert.equal(await generating, 'proposed')
    const route = (await trip.collection('routes').doc('shiori').get()).data()
    assert.equal(route.schedule[0].name, '目黒駅 出発')
    assert.deepEqual(route.pinIds, ['place'])
    assert.equal(generatedRoutes, 1)
    console.log('ok - 初回しおり生成中に出発地を変えても、古い集合場所のしおりを保存しない')

    assert.equal((await changeOrigin(ports, { tripId: id, uid: 'stranger', name: '未知の駅', expectedOrigin: '目黒駅' })).status, 'not-member')
    ports.placesApi.findPlace = async () => {
      await changeOrigin(ports, { tripId: id, uid: 'u', name: '大阪駅', expectedOrigin: '目黒駅' })
      return { placeId: 'test', location: { lat: 35, lng: 139 } }
    }
    assert.equal((await changeOrigin(ports, { tripId: id, uid: 'u', name: '未知の駅', expectedOrigin: '目黒駅' })).status, 'conflict')
    assert.equal((await trip.get()).data().origin, '大阪駅')
    console.log('ok - 検索中の別の変更を上書きせず、部外者を検索前に拒否する')

    let generatedModels = 0
    let references = 0
    const waits = []
    const reference = { text: 'Emulatorの検証用説明', url: 'https://example.com/test', license: 'CC BY-SA' }
    const modelPorts = { db, aiGate: { isOpenToAll: async () => { throw new Error('再利用時に予算を読んだ') } },
      gemini: { run: async () => { generatedModels++; return { output: prefabFor('onsen'), provider: 'agy', fellBack: false } } },
      knowledgeGraph: { enabled: () => true, describe: async () => { references++; return reference } }, wait: async (ms) => waits.push(ms), stubDelayMs: 4000 }
    const pin = { ...identity, status: 'building', buildStartedAt: null, wishId: 'none', uid: 'u', builtBy: 'u', description: '検証用', location: { lat: 36.1, lng: 137.6 }, suggestedBy: 'stub', placeId: null, createdAt: now, updatedAt: now }
    for (const pinId of ['first', 'second']) {
      await trip.collection('pins').doc(pinId).set(pin)
      await buildModelForPin(modelPorts, id, pinId, { guarded: pinId === 'second', lookUp: true })
      assert.equal((await trip.collection('pins').doc(pinId).get()).data().status, 'done')
    }
    assert.equal(generatedModels, 1)
    assert.equal(references, 1)
    assert.deepEqual(waits, [4000])
    assert.deepEqual((await trip.collection('pins').doc('second').collection('model').doc('current').get()).data().reference, reference)
    assert.ok((await cache.get()).exists)
    console.log('ok - 本物のFirestore辞書を再利用し、生成・予算・参考資料を呼ばずに出典を引き継ぐ')

    await cache.update({ 'model.json.parts': [] })
    await trip.collection('pins').doc('repair').set(pin)
    await buildModelForPin(modelPorts, id, 'repair', { guarded: false, lookUp: true })
    assert.equal(generatedModels, 2)
    assert.ok((await cache.get()).data().model.json.parts.length > 0)
    console.log('ok - 壊れた辞書の模型を使わず、生成に成功した模型で修復する')

    await trip.collection('pins').doc('failed').set({ ...pin, ...failureIdentity })
    await buildModelForPin({ ...modelPorts, gemini: { run: async () => ({ output: prefabFor('onsen'), provider: 'stub', fellBack: true }) } }, id, 'failed', { guarded: false, lookUp: true })
    assert.equal((await trip.collection('pins').doc('failed').get()).data().status, 'failed')
    assert.equal((await failCache.get()).exists, false)
    console.log('ok - 本物の生成の失敗では汎用模型を返さず、失敗結果を辞書に保存しない')

    // 本番で合言葉がないとき：関所は印を付けず、呼び出し口は固定の応答（部品の模型）を返す。
    // 本物を呼んでいないので、ふつうの旅も部品の模型で完成にする（#728。何度押しても失敗する状態を作らない）
    const lockedPorts = { ...modelPorts, aiGate: { isOpenToAll: async () => false, isUnlocked: async () => false, reserveArgonCall: async () => false, refundArgonCall: async () => {} },
      gemini: { run: async () => ({ output: prefabFor('onsen'), provider: 'stub', fellBack: false }) } }
    for (const [pinId, smokeTrip, expected] of [['locked', false, 'done'], ['smoke', true, 'done']]) {
      await trip.collection('pins').doc(pinId).set({ ...pin, ...failureIdentity })
      await buildModelForPin(lockedPorts, id, pinId, { guarded: true, lookUp: true, allowParts: false, smokeTrip })
      assert.equal((await trip.collection('pins').doc(pinId).get()).data().status, expected)
    }
    for (const pinId of ['locked', 'smoke']) assert.equal((await trip.collection('pins').doc(pinId).collection('model').doc('current').get()).data().source, 'parts')
    assert.equal((await failCache.get()).exists, false)
    console.log('ok - 本番で合言葉がないとき、本物を呼ばずに部品の模型で完成する（辞書には入れない）')

    // 建築の関数が止まって工事中のまま 10 分たったピンは、確定を止めず、確定するときに「失敗」と書く（#727）
    const old = Timestamp.fromMillis(Date.now() - 11 * 60_000)
    await staleTrip.set({ origin: '東京駅', startDate: '2026-11-21', endDate: null, status: 'planning', title: '止まった建築', createdBy: 'u', createdAt: now, updatedAt: now })
    await staleTrip.collection('members').doc('u').set({ uid: 'u', displayName: '検証用', color: '#1f9d55', joinedAt: now })
    await staleTrip.collection('pins').doc('built').set({ ...pin, status: 'done', createdAt: now, updatedAt: now })
    await staleTrip.collection('routes').doc('shiori').set({ pinIds: ['built'], schedule: [] })
    await staleTrip.collection('pins').doc('fresh').set({ ...pin, status: 'building', buildStartedAt: now, createdAt: now, updatedAt: now })
    assert.equal((await confirmShiori({ db }, { tripId: staleTrip.id, uid: 'u', confirm: true })).status, 'building')
    await staleTrip.collection('pins').doc('fresh').update({ buildStartedAt: old })
    assert.equal((await confirmShiori({ db }, { tripId: staleTrip.id, uid: 'u', confirm: true })).status, 'confirmed')
    assert.equal((await staleTrip.collection('pins').doc('fresh').get()).data().status, 'failed')
    assert.ok((await staleTrip.get()).data().confirmed)
    console.log('ok - 工事中のまま 10 分たったピンは確定を止めず、確定するときに失敗と書く')
  } finally {
    await Promise.all([db.recursiveDelete(trip), db.recursiveDelete(staleTrip), cache.delete(), failCache.delete()])
    await db.terminate()
    await deleteApp(app)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await verifyOriginModels()
