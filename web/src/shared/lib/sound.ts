import { createSoundPlayer, type SoundAsset } from './soundPlayer'
import { recall, remember } from './storage'
import { nextSoundSettings, soundLevelOf } from './soundLevel'

/** docs/sound/README.md でたかなが採用した候補。配布するのは採用した原音だけ。 */
export const SOUND_ASSETS = {
  select: { src: 'select.wav', volume: 0.55 },
  open: { src: 'open.ogg', volume: 0.8 },
  close: { src: 'close.wav', volume: 0.45 },
  switch: { src: 'switch.wav', volume: 0.75 },
  confirm: { src: 'confirm.ogg', priority: 2 },
  send: { src: 'send.wav', volume: 0.5 },
  discover: { src: 'discover.wav', volume: 0.95, priority: 2 },
  'build-press': { src: 'build-press.wav', volume: 0.35 },
  'build-complete': { src: 'build-complete.ogg', priority: 3 },
  attention: { src: 'attention.ogg', volume: 0.35, priority: 2 },
  error: { src: 'error.ogg', volume: 0.45, priority: 3 },
  shutter: { src: 'shutter.wav', priority: 3 },
  arrive: { src: 'arrive.wav', priority: 2 },
  move: { src: 'move.wav', volume: 0.3 },
  unlock: { src: 'unlock.ogg', volume: 0.75, priority: 2 },
} satisfies Record<string, SoundAsset>

export type SoundName = keyof typeof SOUND_ASSETS
const player = createSoundPlayer(Object.fromEntries(Object.entries(SOUND_ASSETS).map(([name, asset]) =>
  [name, { ...asset, src: `${import.meta.env.BASE_URL}sounds/${asset.src}` }],
)) as Record<SoundName, SoundAsset>)
const storedVolume = recall('sound-volume')
const parsedVolume = storedVolume === null ? 0.35 : Number(storedVolume)
let settings = { volume: Number.isFinite(parsedVolume) ? Math.max(0, Math.min(1, parsedVolume)) : 0.35, muted: recall('sound-muted') === 'true' }
player.setSettings(settings)
const listeners = new Set<() => void>()

export const prepareSounds = player.prepare
export const playSound = player.play
export const stopSounds = player.stopAll
export const focusTourSounds = player.setFocus
export const getSoundSettings = () => settings
export const subscribeSoundSettings = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setSoundSettings(next: Partial<typeof settings>): void {
  settings = { volume: Math.max(0, Math.min(1, Number.isFinite(next.volume) ? next.volume! : settings.volume)), muted: next.muted ?? settings.muted }
  player.setSettings(settings)
  remember('sound-volume', String(settings.volume))
  remember('sound-muted', String(settings.muted))
  for (const listener of listeners) listener()
}

/** 大 → 小 → 消音 の次の段階へ切り替え、今の大きさが分かるように選択音を鳴らす。 */
export function cycleSoundLevel(): void {
  const wasOff = soundLevelOf(settings) === 'off'
  setSoundSettings(nextSoundSettings(settings))
  if (wasOff) prepareSounds()
  playSound('select')
}
