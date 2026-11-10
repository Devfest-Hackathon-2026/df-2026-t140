import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createSoundPlayer } from '../web/src/shared/lib/soundPlayer.ts'
import { snapshotDelivery } from '../web/src/shared/lib/snapshotDelivery.ts'
import { nextSoundSettings, soundLevelOf } from '../web/src/shared/lib/soundLevel.ts'

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('SE: 初回・キャッシュ・再接続の同期は無音で、接続中の次の変更だけ通知する', () => {
  const delivery = snapshotDelivery()
  assert.equal(delivery.deliver(true), null, '部分的な初回キャッシュはまだ届けない')
  delivery.connect(true)
  assert.equal(delivery.deliver(false), false, '初回サーバーデータは同期として届ける')
  assert.equal(delivery.deliver(false), true, '接続中の新しい変更は通知できる')
  assert.equal(delivery.deliver(true), false, '削除確認中のキャッシュは通知しない')
  assert.equal(delivery.deliver(false), true, '通信断ではないので実際の削除を通知できる')
  delivery.connect(false)
  assert.equal(delivery.deliver(true), false, '切断中のキャッシュは通知しない')
  delivery.connect(true)
  assert.equal(delivery.deliver(false), false, '再接続のサーバーデータは基準だけ更新する')
  assert.equal(delivery.deliver(false), true, '再接続後の新しい変更は通知できる')
  delivery.connect(false)
  assert.equal(delivery.deliver(false), false, '一覧の同期が親文書より先でも無音')
  delivery.connect(true)
  assert.equal(delivery.deliver(false), true, '次の変更は通知できる')
})
function setup(t, { deferred = false, failed = false } = {}) {
  const previousAudio = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const sources = [], gains = [], requests = [], contexts = []
  const page = { visibilityState: 'visible' }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: page })
  class FakeContext {
    state = 'running'
    currentTime = 3
    destination = {}
    constructor() { contexts.push(this) }
    resume() { this.state = 'running'; return Promise.resolve() }
    createGain() {
      const node = { gain: { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value } }, connect() { return node }, disconnect() {} }
      gains.push(node)
      return node
    }
    createBufferSource() {
      const source = { buffer: null, loop: false, started: false, stopped: false, connect() { return source }, disconnect() {}, start(at) { source.started = true; source.at = at }, stop() { source.stopped = true } }
      sources.push(source)
      return source
    }
    decodeAudioData() { return Promise.resolve({ duration: 1 }) }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeContext, writable: true })
  t.mock.method(globalThis, 'fetch', (url) => {
    if (failed) return Promise.reject(new Error('offline'))
    const response = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }
    if (!deferred) { requests.push({ url }); return Promise.resolve(response) }
    return new Promise((resolve) => requests.push({ url, resolve: () => resolve(response) }))
  })
  t.after(() => {
    if (previousAudio) Object.defineProperty(globalThis, 'AudioContext', previousAudio)
    else delete globalThis.AudioContext
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
  })
  const player = createSoundPlayer({ tap: { src: '/tap.ogg' }, notice: { src: '/notice.ogg', priority: 2 }, loop: { src: '/loop.wav', priority: 0 } })
  return { player, sources, gains, requests, contexts, page }
}

test('SE: 操作前にAudioContextを作らず、初回の準備と取得結果を共有する', async (t) => {
  const { player, contexts, requests, sources } = setup(t)
  player.play('tap')
  assert.equal(contexts.length, 0)
  player.prepare(); player.prepare()
  player.play('tap')
  await flush()
  assert.equal(contexts.length, 1)
  assert.equal(requests.length, 3)
  assert.equal(sources.filter((source) => source.started).length, 1)
})

test('SE: 読み込み中にキャンセルした音と、ミュート前の音はあとから鳴らさない', async (t) => {
  const { player, requests, sources } = setup(t, { deferred: true })
  player.prepare()
  const stop = player.play('tap')
  stop()
  player.play('notice')
  player.setSettings({ muted: true, volume: 0.35 })
  player.setSettings({ muted: false, volume: 0.35 })
  for (const request of requests) request.resolve()
  await flush()
  assert.equal(sources.length, 0)
})

test('SE: 同じイベント・連打を重複再生せず、再生中のループも停止する', async (t) => {
  const { player, sources } = setup(t)
  player.prepare()
  player.play('notice', { key: 'pin-1:done' })
  player.play('notice', { key: 'pin-1:done' })
  player.play('notice', { key: 'pin-2:done' })
  const stopLoop = player.play('loop', { loop: true, delayMs: 500 })
  await flush()
  assert.equal(sources.length, 2)
  assert.equal(sources[1].loop, true)
  assert.equal(sources[1].at, 3.5)
  stopLoop()
  assert.equal(sources[1].stopped, true)
  player.stopAll()
  assert.ok(sources.every((source) => source.stopped))
})

test('SE: 再生枠が埋まったら優先度の低い音を止め、高い通知を守る', async (t) => {
  const { player, sources } = setup(t)
  player.prepare()
  for (let i = 0; i < 3; i++) player.play('loop', { loop: true })
  await flush()
  player.play('notice')
  await flush()
  assert.equal(sources.length, 4)
  assert.equal(sources.filter((source) => source.stopped).length, 1)
})

test('SE: ミュート・音量ゼロ・非表示・旅の再生中の共同作業通知を抑える', async (t) => {
  const { player, sources, page } = setup(t)
  player.prepare()
  player.setFocus(true)
  player.play('notice', { channel: 'notification' })
  player.setFocus(false)
  page.visibilityState = 'hidden'
  player.play('notice')
  page.visibilityState = 'visible'
  player.setSettings({ muted: false, volume: 0 })
  player.play('tap')
  player.setSettings({ muted: true, volume: 0.35 })
  player.play('loop')
  await flush()
  assert.equal(sources.length, 0)
})

test('SE: 音源取得失敗・非対応環境でも例外を呼び出し元へ返さない', async (t) => {
  const { player, sources } = setup(t, { failed: true })
  assert.doesNotThrow(() => { player.prepare(); player.play('tap') })
  await flush()
  assert.equal(sources.length, 0)
  globalThis.AudioContext = class { constructor() { throw new Error('unsupported') } }
  const unsupported = createSoundPlayer({ tap: { src: '/tap.ogg' } })
  assert.doesNotThrow(() => { unsupported.prepare(); unsupported.play('tap') })
})

test('SE: 配信音源は採用IDの原音と一致し、無音の用途は配信しない', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../sound/catalog.json', import.meta.url), 'utf8'))
  const definition = fs.readFileSync(new URL('../web/src/shared/lib/sound.ts', import.meta.url), 'utf8')
  for (const group of catalog.groups) {
    if (group.selected === null) {
      assert.ok(!fs.readdirSync(new URL('../web/public/sounds/', import.meta.url)).some((filename) => filename.startsWith(group.id + '.')), group.id)
      continue
    }
    const selected = group.candidates.find((candidate) => candidate.id === group.selected)
    assert.ok(selected, group.id)
    const filename = group.id + path.extname(selected.file)
    const bytes = fs.readFileSync(new URL(`../web/public/sounds/${filename}`, import.meta.url))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), selected.sha256, filename)
    assert.ok(definition.includes(`src: '${filename}'`), filename)
    assert.ok(catalog.sources.some((source) => source.id === selected.source && source.license === 'CC0-1.0'))
  }
})

test('SE: たかなが試聴で指定した採用IDと無音を固定する', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../sound/catalog.json', import.meta.url), 'utf8'))
  const expected = { select: 'B', open: 'C', close: 'C', switch: 'B', send: 'A', discover: 'B', 'build-press': 'C', 'build-complete': 'C', 'build-start': null, 'tour-start': null, 'tour-end': null, drive: null, depart: null }
  for (const [id, choice] of Object.entries(expected)) {
    assert.equal(catalog.groups.find((group) => group.id === id).selected, choice === null ? null : `${id}-${choice}`)
  }
  for (const id of ['T03', 'T04', 'B02', 'B04', 'B10', 'M10', 'M11', 'M14', 'M15']) assert.equal(catalog.actions.find((action) => action.id === id).group, null, id)
})

test('SE: 旅の作成・再生の開始と完了・再試行で、無音の指定を破る呼び出しがない', () => {
  const source = (file) => fs.readFileSync(new URL(`../web/src/${file}`, import.meta.url), 'utf8')
  const played = (code) => new Set([...code.matchAll(/playSound\('([\w-]+)'/g)].map((match) => match[1]))
  // 旅の作成（T03・T04）：入力の注意と失敗だけ鳴らす
  assert.deepEqual([...played(source('features/create-trip/model/useCreateTrip.ts'))].sort(), ['attention', 'error'])
  // 旅の再生（M10・M15）：途中のシャッターだけ鳴らし（車のエンジン音は鳴らさない）、開始と完了の合図は鳴らさない
  assert.deepEqual([...played(source('pages/trip-map/model/useShioriTour.ts'))].sort(), ['shutter'])
  // 再試行（B10）：建築の押下音は、再試行でないときだけ鳴らす
  const build = source('features/build-model/model/useBuild.ts')
  const presses = build.split('\n').filter((line) => line.includes("playSound('build-press')"))
  assert.ok(presses.length > 0 && presses.every((line) => line.includes('if (!retry)')), 'build-press は再試行のとき鳴らさない')
  assert.match(source('features/build-model/ui/BuildButton.tsx'), /useBuild\([^)]*retry\)/, 'BuildButton は retry を useBuild へ渡す')
})

test('SE: 再選定後も保存成功のぴろりんの原音・音量を保ち、QRは無音とする', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../sound/catalog.json', import.meta.url), 'utf8'))
  const confirmation = fs.readFileSync(new URL('../web/public/sounds/confirm.ogg', import.meta.url))
  // たかなが気に入った再選定前のconfirmation_001。別の候補へ入れ替えない。
  assert.equal(crypto.createHash('sha256').update(confirmation).digest('hex'), '063564703b6094d70718a3e787a55cc9141611e4ecd6b6637f8828f79b4a8c3a')
  assert.equal(catalog.groups.find((group) => group.id === 'confirm').volume, 1)
  assert.equal(catalog.actions.find((action) => action.id === 'T09').group, null)
})

test('SE: スピーカーのアイコンは 大 → 小 → 消音 → 大 の順に切り替わる', () => {
  const low = { volume: 0.35, muted: false }
  assert.equal(soundLevelOf(low), 'low', '初期音量は小')
  const off = nextSoundSettings(low)
  assert.deepEqual(off, { volume: 0.35, muted: true })
  assert.equal(soundLevelOf(off), 'off')
  const high = nextSoundSettings(off)
  assert.deepEqual(high, { volume: 0.7, muted: false })
  assert.equal(soundLevelOf(high), 'high')
  assert.deepEqual(nextSoundSettings(high), low)
})

test('SE: 以前に保存した音量や消音も、3 段階のどれかとして扱う', () => {
  assert.equal(soundLevelOf({ volume: 0.9, muted: false }), 'high')
  assert.equal(soundLevelOf({ volume: 0.5, muted: false }), 'low')
  assert.equal(soundLevelOf({ volume: 0, muted: false }), 'off')
  assert.equal(soundLevelOf({ volume: 0.6, muted: true }), 'off')
  assert.deepEqual(nextSoundSettings({ volume: 0, muted: false }), { volume: 0.7, muted: false }, '0% の端末も音を戻せる')
})
