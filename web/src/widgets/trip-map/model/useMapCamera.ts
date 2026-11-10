import { useCallback, useRef, useState } from 'react'
import type { LatLng } from '@/entities/pin'
import type { MapBounds } from '@/entities/wish'
import {
  clampView,
  isVisible,
  type MapView,
  type Padding,
  type Size,
  viewCenteredOn,
  viewForBounds,
  viewForPoints,
} from '../lib/mercator'
import { describeBounds } from '../lib/viewLabel'
import type { SurfaceHandle } from './surface'

/** ピンを 1 つ見せるとき、これより引いていたら、ここまで寄る */
const FOCUS_MIN_ZOOM = 7.5
/** いくつかのピンを収めるとき、これより寄らない（寄りすぎると、どこなのか分からない） */
const FIT_MAX_ZOOM = 10

/**
 * 地図の見え方を動かす操作。面（本物の地図か、地図なしの表示）に頼むだけで、面の中身は知らない。
 * onViewChange は、見え方が変わるたびに、映っている範囲と、そのあたりの名前を渡して呼ぶ。
 */
export function useMapCamera(onViewChange: (bounds: MapBounds, label: string) => void, initialZoom: number) {
  const surface = useRef<SurfaceHandle>(null)
  const current = useRef<{ view: MapView; size: Size } | null>(null)
  // 面が最初の見え方を知らせてきたか。それまでは、動かす合図を出しても届かない
  const [ready, setReady] = useState(false)
  // いまの拡大の度合い。印を重ならないように並べるのに使う（動かしている途中も、面が onZoom で知らせる）
  const [zoom, setZoom] = useState(initialZoom)
  // 0.05 きざみに丸めてから持つ（指 2 本で縮めているあいだ、細かすぎる描き直しをしない）。
  // 引いた側へ丸め、建物の大きさを、実際の間隔より大きく見積もらないようにする
  const onZoom = useCallback((next: number) => setZoom(Math.floor(next * 20) / 20), [])

  const onView = useCallback(
    (view: MapView, bounds: MapBounds, size: Size) => {
      current.current = { view, size }
      setReady(true)
      onZoom(view.zoom)
      onViewChange(bounds, describeBounds(bounds))
    },
    [onViewChange, onZoom],
  )

  /** 拡大・縮小（右の ＋ −） */
  const zoomBy = useCallback((delta: number) => {
    const now = current.current
    if (!now) return
    const zoom = Math.round((now.view.zoom + delta) * 2) / 2
    surface.current?.setView(clampView({ ...now.view, zoom }), false)
  }, [])

  /**
   * 点が見えるように動かす。padding は、上の帯と下の操作欄に隠れる幅。
   * 1 つのときは、もう見えていれば動かさない。いくつかのときは、全部が収まるようにする。
   */
  const showPoints = useCallback((points: readonly LatLng[], padding: Padding) => {
    const now = current.current
    if (!now || points.length === 0) return
    if (points.length === 1) {
      const zoom = Math.max(now.view.zoom, FOCUS_MIN_ZOOM)
      if (zoom === now.view.zoom && isVisible(now.view, now.size, padding, points[0])) return
      surface.current?.setView(viewCenteredOn(points[0], zoom, padding), true)
      return
    }
    const view = viewForPoints(points, now.size, padding, FIT_MAX_ZOOM)
    if (view) surface.current?.setView(view, true)
  }, [])

  /** 点を真ん中にして、決めた拡大率で見せる（しおりで、地点を 1 つずつアップにする） */
  const centerOn = useCallback((point: LatLng, zoom: number, padding: Padding) => {
    surface.current?.setView(viewCenteredOn(point, zoom, padding), true)
  }, [])

  /** 範囲が全部見えるように動かす（最初の「日本全体」など） */
  const showBounds = useCallback((bounds: MapBounds, padding: Padding) => {
    const now = current.current
    if (now) surface.current?.setView(viewForBounds(bounds, now.size, padding), false)
  }, [])

  /** いくつかの点が全部入る拡大率（しおりの再生で、区間ごとに寄り具合を決める）。面がまだ見え方を知らせていなければ null */
  const fitZoom = useCallback((points: readonly LatLng[], padding: Padding, maxZoom: number): number | null => {
    const now = current.current
    if (!now) return null
    return viewForPoints(points, now.size, padding, maxZoom)?.zoom ?? now.view.zoom
  }, [])

  /** いまの拡大率。面がまだ見え方を知らせていなければ null */
  const currentZoom = useCallback(() => current.current?.view.zoom ?? null, [])

  /** 地図の面のいまの大きさ（px）。面がまだ見え方を知らせていなければ null */
  const currentSize = useCallback(() => current.current?.size ?? null, [])

  /** 点を真ん中にして、すぐにその見え方にする。tilt は傾ける角度（度）。しおりの再生で、走る車を追う */
  const follow = useCallback((point: LatLng, zoom: number, padding: Padding, tilt: number) => {
    surface.current?.follow(viewCenteredOn(point, zoom, padding), tilt)
  }, [])

  return { surface, ready, zoom, onView, onZoom, zoomBy, showPoints, centerOn, showBounds, fitZoom, currentZoom, currentSize, follow }
}
