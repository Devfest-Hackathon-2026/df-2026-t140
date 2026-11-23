import type { RouteStop } from '@/entities/route'

// 行の ID（entities/route の stopIdOf と同じ決め。node --test から直接読むため、型のほかは import しない）
const stopIdOf = (stop: RouteStop) => stop.stopId ?? stop.pinId

/** 行の移動を頼んで、まだ保存されていないもの。revision は、頼んだときのしおりの組み直しの回数 */
export interface PendingMove {
  from: string
  to: string
  revision: number
}

/**
 * 保存を待つあいだに出すしおり。取った行（from）を、落とした先の行（to）の位置に差し込み、あいだの行を 1 つずつずらす。
 * 動かすのは行の場所（場所と名前、行の ID）だけで、時刻は行の位置のまま。
 * Functions が計算し直したしおりが届けば（revision が変われば）、そちらを出す。
 * from と to は行の ID（同じ場所を何度も訪れるしおりでは、2 回目からの行は「ピンの ID~番号」）。どちらかがしおりにないときは、そのまま返す
 */
export function movedRoute<R extends { pinIds: string[]; schedule: RouteStop[]; revision: number }>(route: R, pending: PendingMove | null): R {
  if (!pending || (route.revision ?? 0) !== pending.revision) return route
  const rows = route.schedule.filter((stop) => stop.pinId)
  const from = rows.findIndex((stop) => stopIdOf(stop) === pending.from)
  const to = rows.findIndex((stop) => stopIdOf(stop) === pending.to)
  if (from < 0 || to < 0 || from === to) return route
  const places = rows.map(({ pinId, stopId, name }) => ({ pinId, stopId, name }))
  places.splice(to, 0, ...places.splice(from, 1))
  const schedule = route.schedule.map((stop) => {
    const index = rows.indexOf(stop)
    if (index < 0) return stop
    // stopId のない行に、前の行の stopId を残さない
    const { stopId: _stopId, ...rest } = stop
    const place = places[index]
    return { ...rest, pinId: place.pinId, name: place.name, ...(place.stopId ? { stopId: place.stopId } : {}) }
  })
  return { ...route, pinIds: places.map((place) => place.stopId ?? place.pinId!), schedule }
}
