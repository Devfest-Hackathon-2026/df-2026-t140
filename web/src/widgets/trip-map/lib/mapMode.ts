import { recall, remember } from '@/shared/lib'

// 本物の地図（Google Maps）を出すか、地図なしの表示にするかを決める。
//
// 地図の読み込みは 1 日 300 回までにしてある（課金を避けるため。docs/process/setup.md）。
// 地図を出したページを開くたびに 1 回と数えられるので、普段の確認は地図なしで行う。
//   ?map=off  地図なしにする。この端末で覚えておき、次に開いたときも地図なしのまま
//   ?map=on   地図を出す（覚えていた「地図なし」も消す）
// キーかマップ ID がないとき（CI や、.env.local のない環境）は、いつも地図なし。
//
// 地図なしの表示は、開発のときだけ（Vite の開発サーバー、localhost、Emulator）。本番では出さない
// （Maps Platform 規約 3.2.3(e) に照らした、かめの決定。todo/humans/2026-11-07-mapless-fallback-terms.md）。
// 本番で地図を読み込めないときは、地図なしに切り替えず、読み込めなかったことだけを出す（mode: 'unavailable'）。

const STORAGE_KEY = 'map'

export interface MapConfig {
  /** google：本物の地図。plain：地図なしの表示（開発のときだけ）。unavailable：本番で地図を出せない */
  mode: 'google' | 'plain' | 'unavailable'
  /** 地図なしにした理由。画面に出す */
  reason: 'off' | 'no-key' | null
  /** 地図を読み込めなかったとき、地図なしの表示に切り替えてよいか（開発のときだけ true） */
  plainAllowed: boolean
  apiKey: string
  mapId: string
}

/** 開発のとき（本番のドメインではない）か。Vite の開発サーバー、localhost、*.localhost（複数人シミュレーション）、Hosting Emulator */
export function isDevelopmentHost(hostname = location.hostname): boolean {
  if (import.meta.env.DEV) return true
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost')
}

export function readMapConfig(): MapConfig {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''
  const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID ?? ''

  const fromUrl = new URLSearchParams(location.search).get('map')
  if (fromUrl === 'off' || fromUrl === 'on') remember(STORAGE_KEY, fromUrl)
  const off = fromUrl ? fromUrl === 'off' : recall(STORAGE_KEY) === 'off'

  const plainAllowed = isDevelopmentHost()
  if (off && plainAllowed) return { mode: 'plain', reason: 'off', plainAllowed, apiKey, mapId }
  if (!apiKey || !mapId) return { mode: plainAllowed ? 'plain' : 'unavailable', reason: 'no-key', plainAllowed, apiKey, mapId }
  return { mode: 'google', reason: null, plainAllowed, apiKey, mapId }
}
