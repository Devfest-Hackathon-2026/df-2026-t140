import { type PointerEvent, useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, type WheelEvent } from 'react'
import { areaDisplayName } from '@/entities/trip'
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
export function PlainSurface({
  ref,
  initialView,
  markers,
  lines,
  areas,
  onAreaClick,
  onView,
  onBackgroundClick,
  onUserMove,
  onUserZoom,
  minZoom,
}: SurfaceProps) {
  const frame = useRef<HTMLDivElement>(null)
  const [rawView, setView] = useState(() => clampView(initialView, minZoom))
  // いちばん引けるところ（旅のエリアで決める）。あとから上がったときも、描くときに収める
  const view = useMemo(() => clampView(rawView, minZoom), [rawView, minZoom])
  // 外から動かすとき、指やホイールで動かすときにも使うので、最新を覚えておく
  const floor = useRef(minZoom)
  useEffect(() => {
    floor.current = minZoom
  }, [minZoom])
  const [size, setSize] = useState<Size | null>(null)
  const drag = useRef<{ x: number; y: number; view: MapView; moved: boolean } | null>(null)

  useImperativeHandle(
    ref,
    () => ({
      setView: (next) => setView(clampView(next, floor.current)),
      // 地図なしの表示は傾けられないので、動かすだけ
      follow: (next) => setView(clampView(next, floor.current)),
      fly: (next) => setView(clampView(next, floor.current)),
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

  // 印（ボタン）や塗った範囲の上で押したときは、動かさない。そうしないと、印を押したことにならない
  const onMarker = (event: PointerEvent) => (event.target as Element).closest('[data-marker], [data-area]') !== null

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
    setView(clampView(panBy(start.view, -dx, -dy), floor.current))
  }

  function onPointerUp() {
    const start = drag.current
    drag.current = null
    if (start && !start.moved) onBackgroundClick()
  }

  function onWheel(event: WheelEvent) {
    onUserZoom?.()
    setView((current) => clampView({ ...current, zoom: current.zoom + (event.deltaY < 0 ? 0.5 : -0.5) }, floor.current))
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
          {areas && areas.length > 0 && (
            // 塗る範囲（旅をつくるときに選ぶ地方）。押すと onAreaClick
            <svg className={styles.areas} width={size.width} height={size.height}>
              {areas.map((area) => (
                <path
                  key={area.id}
                  data-area={area.id}
                  className={`${styles.area} ${styles[area.look]}`}
                  d={area.rings
                    .map((ring) => `M${ring.map((point) => project(view, size, point)).map(({ x, y }) => `${x},${y}`).join('L')}Z`)
                    .join('')}
                  onClick={onAreaClick ? () => onAreaClick(area.id) : undefined}
                  style={onAreaClick ? undefined : { pointerEvents: 'none' }}
                />
              ))}
            </svg>
          )}
          {/* 地方の名前。塗る範囲があるときは、範囲の札（印）が名前を兼ねるので出さない */}
          {view.zoom < 9 &&
            !areas?.length &&
            REGION_POINTS.map((region) => {
              const { x, y } = project(view, size, region)
              return (
                <span key={region.name} className={styles.region} style={{ transform: `translate(${x}px, ${y}px)` }}>
                  <span>{areaDisplayName(region.name)}</span>
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
