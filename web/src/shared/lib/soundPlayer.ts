/** Web Audioの小さな再生器。旅や画面の状態は持たない。 */
export interface SoundAsset {
  src: string
  volume?: number
  priority?: number
}

export interface SoundOptions {
  volume?: number
  loop?: boolean
  delayMs?: number
  /** 購読イベントなどの一意なID。同じイベントは再生しない */
  key?: string
  channel?: 'interaction' | 'notification' | 'tour'
}

interface Voice {
  stop: () => void
  priority: number
  channel?: SoundOptions['channel']
}

const nothing = () => {}
const clamp = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0)

export function createSoundPlayer<Name extends string>(assets: Record<Name, SoundAsset>) {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let unlocking: Promise<void> | null = null
  let volume = 0.35
  let muted = false
  let focused = false
  let generation = 0
  const buffers = new Map<Name, Promise<AudioBuffer>>()
  const voices = new Set<Voice>()
  const pending = new Set<() => void>()
  const keys = new Set<string>()
  const lastPlayed = new Map<Name, number>()
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden'

  function load(name: Name): Promise<AudioBuffer> {
    const cached = buffers.get(name)
    if (cached) return cached
    const audio = context!
    const buffer = fetch(assets[name].src)
      .then((response) => {
        if (!response.ok) throw new Error('Sound unavailable')
        return response.arrayBuffer()
      })
      .then((bytes) => audio.decodeAudioData(bytes))
      .catch((error: unknown) => {
        buffers.delete(name)
        throw error
      })
    buffers.set(name, buffer)
    return buffer
  }

  /** pointerdown/keydown等、人の操作の中で呼ぶ。音自体は出さない。 */
  function prepare(): void {
    if (!visible()) return
    try {
      if (!context || context.state === 'closed') {
        context = new AudioContext()
        master = context.createGain()
        master.gain.value = muted ? 0 : volume
        master.connect(context.destination)
        buffers.clear()
      }
      if (context.state !== 'running') {
        // タッチのpointerdown時には、まだ音が許可されていないブラウザもある。
        // 後続のclickなど、人の操作のたびにresumeを試せるようにする。
        const resumed = context.resume().catch(nothing)
        unlocking = resumed
        void resumed.finally(() => { if (unlocking === resumed) unlocking = null })
      }
      if (!muted && volume > 0) for (const name of Object.keys(assets) as Name[]) void load(name).catch(nothing)
    } catch {
      // 音の準備に失敗しても利用者の操作を止めない
    }
  }

  /** 即座に停止関数を返す。読み込み中に停止した場合も、あとから鳴らさない。 */
  function play(name: Name, options: SoundOptions = {}): () => void {
    if (!context || !master || muted || volume === 0 || !visible() || (focused && options.channel === 'notification')) return nothing
    if (options.key && keys.has(options.key)) return nothing
    if (options.key) {
      keys.add(options.key)
      if (keys.size > 256) keys.delete(keys.values().next().value!)
    }
    const requestedAt = performance.now()
    // 同じ音の連打と、一度の購読でまとまって届く通知を抑える
    const cooldown = options.loop ? 0 : options.channel === 'notification' ? 350 : 70
    if (requestedAt - (lastPlayed.get(name) ?? -Infinity) < cooldown) return nothing
    lastPlayed.set(name, requestedAt)
    const epoch = generation
    const audio = context
    const output = master
    let cancelled = false
    let source: AudioBufferSourceNode | null = null
    let gain: GainNode | null = null
    let voice: Voice | null = null
    const stop = () => {
      cancelled = true
      pending.delete(stop)
      if (voice) voices.delete(voice)
      if (source) {
        try {
          gain!.gain.cancelScheduledValues(audio.currentTime)
          gain!.gain.setTargetAtTime(0, audio.currentTime, 0.008)
          source.stop(audio.currentTime + 0.04)
        } catch { /* すでに終了している */ }
      }
    }
    pending.add(stop)
    void Promise.all([unlocking ?? Promise.resolve(), load(name)]).then(([, buffer]) => {
      pending.delete(stop)
      if (cancelled || epoch !== generation || muted || !visible() || audio.state !== 'running' ||
          performance.now() - requestedAt > 1000 || (focused && options.channel === 'notification')) return
      const priority = assets[name].priority ?? 1
      if (voices.size >= 3) {
        const lowest = [...voices].sort((a, b) => a.priority - b.priority)[0]
        if (lowest.priority > priority) return
        lowest.stop()
      }
      source = audio.createBufferSource()
      source.buffer = buffer
      source.loop = options.loop ?? false
      gain = audio.createGain()
      gain.gain.value = clamp(assets[name].volume ?? 1) * clamp(options.volume ?? 1)
      source.connect(gain).connect(output)
      voice = { stop, priority, channel: options.channel }
      voices.add(voice)
      source.onended = () => {
        if (voice) voices.delete(voice)
        source?.disconnect()
        gain?.disconnect()
      }
      source.start(audio.currentTime + Math.max(0, options.delayMs ?? 0) / 1000)
    }).catch(() => {
      stop()
      source?.disconnect()
      gain?.disconnect()
      // 非対応の形式・取得失敗は無音で済ませる
    })
    return stop
  }

  function stopAll(): void {
    generation++
    for (const stop of [...pending]) stop()
    for (const voice of [...voices]) voice.stop()
  }

  function setSettings(next: { volume: number; muted: boolean }): void {
    volume = clamp(next.volume)
    muted = next.muted
    if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.01)
    if (muted || volume === 0) stopAll()
  }

  function setFocus(value: boolean): void {
    focused = value
    if (value) for (const voice of [...voices]) if (voice.channel === 'notification') voice.stop()
  }

  return { prepare, play, stopAll, setSettings, setFocus }
}
