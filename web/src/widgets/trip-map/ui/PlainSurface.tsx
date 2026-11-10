import { type PointerEvent, useEffect, useEffectEvent, useImperativeHandle, useRef, useState, type WheelEvent } from 'react'
import { boundsOf, clampView, type MapView, panBy, project, type Size } from '../lib/mercator'
import { REGION_POINTS } from '../lib/viewLabel'
import type { SurfaceProps } from '../model/surface'
import styles from './PlainSurface.module.css'

/** 緯線・経線を引く間隔（度）。拡大するほど細かくする */
function gridStep(zoom: number): number {
  if (zoom < 5.5) return 5
  if (zoom < 7) return 2
  if (zoom < 8.5) return 1
  if (zoom < 10.5) return 0.25
  return 0.05
}

function gridLines(view: MapView, size: Size): { vertical: number[]; horizontal: number[] } {
  const bounds = boundsOf(view, size)
  const step = gridStep(view.zoom)
  const vertical: number[] = []
  const horizontal: number[] = []
  for (let lng = Math.ceil(bounds.west / step) * step; lng <= bounds.east; lng += step) {
    vertical.push(project(view, size, { lat: 0, lng }).x)
  }
  for (let lat = Math.ceil(bounds.south / step) * step; lat <= bounds.north; lat += step) {
    horizontal.push(project(view, size, { lat, lng: view.center.lng }).y)
  }
  return { vertical, horizontal }
}

/**
 * 地図なしの表示。本物の地図を読み込まずに、緯度経度から位置を計算して印を置く。
 * キーがないとき、地図を読み込めなかったとき、?map=off のときに使う（lib/mapMode.ts）。
 *
 * 地図の絵は描かない（目盛りの線と、地方の名前だけ）。Google Maps の内容は何も使っていない。
 * ここに Maps 由来の内容を出してはいけない（Maps Platform 規約 3.2.3(e)：自作地図と Maps の内容を一緒に使わない）。
 * ルートの線（lines）は、ピンの緯度経度を自分たちで結んだもので、Maps の Routes や Directions の結果ではない。
 * 指やマウスで引っぱると動き、ホイールと右の ＋ − で拡大・縮小できる。
 */
export function PlainSurface({ ref, initialView, markers, lines, onView, onBackgroundClick, onUserMove, onUserZoom }: SurfaceProps) {
  const frame = useRef<HTMLDivElement>(null)
  const [view, setView] = useState(() => clampView(initialView))
  const [size, setSize] = useState<Size | null>(null)
  const drag = useRef<{ x: number; y: number; view: MapView; moved: boolean } | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      setView: (next) => setView(clampView(next)),
      // 地図なしの表示は傾けられないので、動かすだけ
      follow: (next) => setView(clampView(next)),
    }),
    [],
  )

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const report = useEffectEvent(onView)
  useEffect(() => {
    if (size) report(view, boundsOf(view, size), size)
  }, [view, size])

  // 印（ボタン）の上で押したときは、動かさない。そうしないと、印を押したことにならない
  const onMarker = (event: PointerEvent) => (event.target as HTMLElement).closest('[data-marker]') !== null

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (onMarker(event) || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) < 5) return
    if (!start.moved) onUserMove?.()
    start.moved = true
    setView(clampView(panBy(start.view, -dx, -dy)))
  }

  function onPointerUp() {
    const start = drag.current
    drag.current = null
    if (start && !start.moved) onBackgroundClick()
  }

  function onWheel(event: WheelEvent) {
    onUserZoom?.()
    setView((current) => clampView({ ...current, zoom: current.zoom + (event.deltaY < 0 ? 0.5 : -0.5) }))
  }

  const grid = size ? gridLines(view, size) : null
  return (
    <div
      ref={frame}
      className={styles.surface}
      data-map="plain"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onWheel={onWheel}
    >
      {size && grid && (
        <>
          <svg className={styles.grid} width={size.width} height={size.height} aria-hidden="true">
            {grid.vertical.map((x) => (
              <line key={`v${x}`} x1={x} x2={x} y1={0} y2={size.height} />
            ))}
            {grid.horizontal.map((y) => (
              <line key={`h${y}`} x1={0} x2={size.width} y1={y} y2={y} />
            ))}
          </svg>
          {view.zoom < 9 &&
            REGION_POINTS.map((region) => {
              const { x, y } = project(view, size, region)
              return (
                <span key={region.name} className={styles.region} style={{ transform: `translate(${x}px, ${y}px)` }}>
                  <span>{region.name}</span>
                </span>
              )
            })}
          {lines.length > 0 && (
            // ルートの線。白いふちの上に、ルートの色（青）で引く
            <svg className={styles.lines} width={size.width} height={size.height} aria-hidden="true" data-route-lines={lines.length}>
              {lines.map((line) => {
                const points = line.points.map((point) => project(view, size, point)).map(({ x, y }) => `${x},${y}`).join(' ')
                return (
                  <g key={line.id}>
                    <polyline className={styles.lineEdge} points={points} />
                    <polyline className={line.dashed ? `${styles.line} ${styles.dashed}` : styles.line} points={points} />
                  </g>
                )
              })}
            </svg>
          )}
          {markers.map((marker) => {
            const { x, y } = project(view, size, marker)
            return (
              <div
                key={marker.id}
                className={styles.anchor}
                data-marker={marker.id}
                style={{ transform: `translate(${x}px, ${y}px)`, zIndex: marker.zIndex }}
              >
                {marker.node}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
