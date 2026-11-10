// 複数人シミュレーション（開発用の画面 /dev/sim）の中の 1 画面かどうか。
//
// /dev/sim は、スマホの大きさの iframe を 3 つ並べ、それぞれを別の匿名ユーザーとして動かす。
// 親の画面が iframe の name に「konbu-sim-a」のように付け、ここで読む。name は画面の中で移動しても残る。
// 開発サーバー（vite dev）のときだけ有効で、本番のビルドでは常に null（開発用の仕組みを本番に入れない）。

const PATTERN = /^konbu-sim-([a-z0-9]+)$/

export interface SimFrame {
  /** 画面の記号（a、b、c） */
  id: string
  /** Firebase のアプリ名。同じブラウザの中でも、アプリ名ごとに別の匿名ユーザーになる */
  appName: string
  /** この端末に覚える値（名前、最後の旅、地図の設定）の置き場を分ける接頭辞 */
  storagePrefix: string
}

function detect(): SimFrame | null {
  if (!import.meta.env.DEV) return null
  const match = PATTERN.exec(typeof window === 'undefined' ? '' : window.name)
  if (!match) return null
  return { id: match[1], appName: `sim-${match[1]}`, storagePrefix: `sim-${match[1]}:` }
}

export const simFrame: SimFrame | null = detect()
