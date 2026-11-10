import { type CSSProperties, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type BuildingsOverlay, createBuildingsOverlay } from '../lib/buildingsOverlay'
import { loadGoogleMaps, onGoogleMapsAuthFailure } from '../lib/loadGoogleMaps'
import type { MapConfig } from '../lib/mapMode'
import { MAX_ZOOM, MIN_ZOOM, type MapView, viewBetween, viewGap } from '../lib/mercator'
import type { SurfaceMarker, SurfaceProps } from '../model/surface'
import styles from './GoogleSurface.module.css'

/** Maps が、地図の上に出すエラーの文（上限に達した、キーが使えない、など）。出たら、地図なしの表示に切り替える */
const MAPS_ERROR_TEXTS = ['Google マップが正しく読み込まれませんでした', "This page can't load Google Maps correctly"]

/** ロゴをずらす動きが終わるのを待つ時間 */
const LOGO_CHECK_DELAY_MS = 700
/** ロゴが見えないとき、何回まで確かめ直すか（そのあと、地図を縮める） */
const LOGO_CHECK_ATTEMPTS = 6

/** 拡大の度合いを変えながら動かすときの長さ（ms）。前は、拡大の度合いが変わるときはすぐ切り替えていた */
const GLIDE_MS = 450
/** これより遠く（画面の対角線のこの倍、引いているほうの拡大の度合いで測る）へは、なめらかに動かさず、すぐ切り替える */
const GLIDE_MAX_SCREENS = 2

/** 動きを減らす設定か */
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** 動き始めはゆっくり、途中は速く、終わりはゆっくり（0〜1） */
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** Google のロゴ（Google マップを開くリンク）。隠れていないかを確かめるのに使う */
const LOGO_SELECTOR = 'a[href^="https://maps.google.com/maps"]'
/** 著作権表示（「地図データ ©2026 Google」、利用規約など）の 1 つ。GoogleSurface.module.css で上に固定する */
const ATTRIBUTION_SELECTOR = '.gm-style-cc'

interface SharedMap {
  /** 地図を描く要素。ページの中の置き場所（host）に差し込んで使う */
  element: HTMLDivElement
  map: google.maps.Map
  Marker: typeof google.maps.marker.AdvancedMarkerElement
  /** 建物の模型を重ねる層。ベクター地図だと分かったときに 1 回だけ作る */
  buildings?: BuildingsOverlay
}

declare global {
  interface Window {
    __konbuMap?: Promise<SharedMap>
  }
}

/**
 * 地図は、ページを開いてから閉じるまでに 1 つだけ作る（作るたびに「地図の読み込み 1 回」と数えられ、
 * 1 日 300 回の上限に近づくため）。旅を切り替えても、開発時に React が部品を 2 回組み立てても、
 * コードを保存して差し替わっても、同じ地図を使い回す。そのため window に置いている。
 */
function sharedMap(config: MapConfig, initialView: MapView, host: HTMLElement | null): Promise<SharedMap> {
  window.__konbuMap ??= (async () => {
    const maps = await loadGoogleMaps(config.apiKey)
    const { Map: GoogleMap } = (await maps.importLibrary('maps')) as google.maps.MapsLibrary
    const { AdvancedMarkerElement } = (await maps.importLibrary('marker')) as google.maps.MarkerLibrary

    const element = document.createElement('div')
    element.className = styles.canvas
    // 地図を作る前に、ページに差し込んでおく（大きさのある要素に作る）
    host?.append(element)
    const map = new GoogleMap(element, {
      // ベクター地図かラスター地図かは、マップ ID の設定（Google Cloud）で決まる。
      // ベクターなら模型を WebGL で地図に重ね、ラスターなら模型を絵にして印の中に置く
      mapId: config.mapId,
      center: initialView.center,
      zoom: initialView.zoom,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      isFractionalZoomEnabled: true,
      // 操作のボタンは自分たちで出す（右の ＋ −）。Google のロゴと著作権表示は消えない
      disableDefaultUI: true,
      keyboardShortcuts: false,
      // 指 1 本で動かせるようにする（地図が画面いっぱいなので、ページを送る操作とぶつからない）
      gestureHandling: 'greedy',
      // 地図の上の店などを押しても、Google の吹き出しを出さない（Places を使わない）
      clickableIcons: false,
    })
    return { element, map, Marker: AdvancedMarkerElement }
  })()
  return window.__konbuMap
}

interface Props extends SurfaceProps {
  config: MapConfig
  /** 地図を読み込めなかった、キーが使えなかったとき。呼ぶ側が地図なしの表示に切り替える */
  onFailed: () => void
}

/**
 * 本物の地図（Google Maps。Maps JavaScript API。マップ ID がベクター地図なら、指 2 本で傾けたり回したりできる）。
 * 最初は真上から見た向きで出す。建物の模型は、真上からでも斜め上から見た形に見えるように倒して描く
 * （lib/buildingsOverlay.ts）。
 * 印は AdvancedMarkerElement に React の部品を差し込んで描く。地図を傾けても回しても、位置がずれない。
 *
 * Google のロゴと著作権表示は隠さない（利用規約）。下の操作欄の高さ（bottomInset）だけ上にずらして出す。
 * ずらせなかったとき（Maps の中の作りが変わったときなど）は、地図そのものを操作欄の上までに縮める。
 */
export function GoogleSurface({
  ref,
  initialView,
  markers,
  lines,
  onView,
  onZoom,
  onBackgroundClick,
  onUserMove,
  onUserZoom,
  bottomInset,
  buildings,
  buildingSize,
  onDrawsBuildings,
  config,
  onFailed,
}: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [shared, setShared] = useState<SharedMap | null>(null)
  const [shrunk, setShrunk] = useState(false)
  const pendingView = useRef<MapView | null>(null)

  const fail = useEffectEvent(onFailed)
  const firstView = useRef(initialView)
  // なめらかに動かしている途中の、次のコマ。新しく動かすとき、人が地図を動かし始めたとき、外したときに捨てる
  // （続けてスワイプしたとき、古い動きで前の場所へ戻らないように。#224）
  const glide = useRef(0)
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  useEffect(() => {
    const effect = { cancelled: false }
    sharedMap(config, firstView.current, host.current).then(
      (value) => {
        if (effect.cancelled) return
        host.current?.append(value.element)
        const view = pendingView.current ?? firstView.current
        value.map.moveCamera({ center: view.center, zoom: view.zoom })
        setShared(value)
      },
      () => !effect.cancelled && fail(),
    )
    const stopListening = onGoogleMapsAuthFailure(() => fail())
    return () => {
      effect.cancelled = true
      stopListening()
      // 地図は捨てずに、ページから外すだけ（次に開いたときに使い回す）
      void window.__konbuMap?.then(
        (value) => value.element.remove(),
        () => {},
      )
    }
  }, [config])

  // Maps が地図の上にエラーを出したら（1 日の上限に達した、など）、地図なしの表示に切り替える。
  // このときは gm_authFailure が呼ばれないことがあるので、出た文で見分ける
  useEffect(() => {
    if (!shared) return
    const hasError = () => MAPS_ERROR_TEXTS.some((text) => shared.element.textContent?.includes(text))
    if (hasError()) {
      fail()
      return
    }
    const observer = new MutationObserver(() => {
      if (hasError()) fail()
    })
    observer.observe(shared.element, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [shared])

  useImperativeHandle(
    ref,
    () => ({
      setView(view, animate) {
        if (!shared) {
          pendingView.current = view
          return
        }
        cancelAnimationFrame(glide.current)
        const { map } = shared
        const center = map.getCenter()
        const zoom = map.getZoom()
        const sameZoom = Math.abs((zoom ?? 0) - view.zoom) < 0.01
        if (animate && sameZoom) {
          map.panTo(view.center)
          return
        }
        // 拡大の度合いが変わるときも、近ければなめらかに動かす（しおりの場所の情報で、前後の場所へ移ったときなど）
        const element = host.current
        const from = center && zoom !== undefined ? { center: center.toJSON(), zoom } : null
        const reach = element ? Math.hypot(element.clientWidth, element.clientHeight) * GLIDE_MAX_SCREENS : 0
        if (!animate || !from || reducedMotion() || viewGap(from, view) > reach) {
          map.moveCamera({ center: view.center, zoom: view.zoom })
          return
        }
        const start = performance.now()
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / GLIDE_MS)
          const between = viewBetween(from, view, easeInOut(t))
          map.moveCamera({ center: between.center, zoom: between.zoom })
          if (t < 1) glide.current = requestAnimationFrame(step)
        }
        glide.current = requestAnimationFrame(step)
      },
      follow(view, tilt) {
        if (!shared) {
          pendingView.current = view
          return
        }
        cancelAnimationFrame(glide.current)
        // 傾きは、ベクター地図だけが受け付ける（ラスター地図では Maps が 0 のままにする）
        shared.map.moveCamera({ center: view.center, zoom: view.zoom, tilt })
      },
    }),
    [shared],
  )

  const reportView = useEffectEvent(onView)
  const backgroundClick = useEffectEvent(onBackgroundClick)
  const userMove = useEffectEvent(() => onUserMove?.())
  const userZoom = useEffectEvent(() => onUserZoom?.())
  const reportZoom = useEffectEvent((zoom: number) => onZoom?.(zoom))

  // ロゴと著作権表示が下の操作欄に隠れていないかを確かめる。隠れていたら、地図を操作欄の上までに縮める。
  // 著作権表示は CSS で上に固定しているが、Google の inline style に頼ったセレクタなので、
  // Google が DOM を変えると右下に戻って操作欄に隠れうる。そのときも縮めて見えるようにする（Maps Platform の規約）。
  // 地図のタイルが出る前は、ロゴがまだないので決めない。ロゴが出るのが遅い、ずらす動きの途中、
  // ということがあるので、だめでも少し待って何回か確かめ直してから縮める
  const tilesLoaded = useRef(false)
  const logoTimer = useRef<ReturnType<typeof setInterval>>(undefined)
  const logoVisible = useEffectEvent(() => {
    const element = host.current
    if (!element) return true
    const logo = element.querySelector(LOGO_SELECTOR)
    const attribution = element.querySelector(ATTRIBUTION_SELECTOR)
    const visibleBottom = element.getBoundingClientRect().bottom - bottomInset
    const above = (credit: Element | null) => credit !== null && credit.getBoundingClientRect().bottom <= visibleBottom + 1
    return above(logo) && above(attribution)
  })
  // ずらす動き（CSS の transition）が終わるのを待ちながら、決めた回数まで確かめる
  const checkLogoSoon = useEffectEvent(() => {
    clearInterval(logoTimer.current)
    if (shrunk || !tilesLoaded.current) return
    let attempts = 0
    logoTimer.current = setInterval(() => {
      attempts += 1
      if (logoVisible()) clearInterval(logoTimer.current)
      else if (attempts >= LOGO_CHECK_ATTEMPTS) {
        clearInterval(logoTimer.current)
        setShrunk(true)
      }
    }, LOGO_CHECK_DELAY_MS)
  })
  useEffect(() => () => clearInterval(logoTimer.current), [])

  useEffect(() => {
    if (!shared) return
    const { map } = shared
    const report = () => {
      const center = map.getCenter()
      const zoom = map.getZoom()
      const bounds = map.getBounds()
      const element = host.current
      if (!center || zoom === undefined || !bounds || !element) return
      const { north, south, east, west } = bounds.toJSON()
      reportView({ center: center.toJSON(), zoom }, { north, south, east, west }, { width: element.clientWidth, height: element.clientHeight })
    }
    const listeners = [
      map.addListener('idle', report),
      map.addListener('click', () => backgroundClick()),
      map.addListener('dragstart', () => {
        cancelAnimationFrame(glide.current)
        userMove()
      }),
      map.addListener('tilesloaded', () => {
        tilesLoaded.current = true
        checkLogoSoon()
      }),
    ]
    // 指 2 本の拡大・縮小やホイールでは dragstart が来ないので、地図に触れた時点で、なめらかに動かしている途中の動きを捨てる
    // （人の操作と取り合わない）
    const stopGlide = () => cancelAnimationFrame(glide.current)
    // ホイールと指 2 本は、人の拡大・縮小として知らせる（しおりの場所の情報で、寄せ直しをやめる）
    const zoomByWheel = () => {
      stopGlide()
      userZoom()
    }
    const zoomByFingers = (event: TouchEvent) => {
      if (event.touches.length < 2) return
      stopGlide()
      userZoom()
    }
    shared.element.addEventListener('pointerdown', stopGlide)
    shared.element.addEventListener('wheel', zoomByWheel, { passive: true })
    shared.element.addEventListener('touchstart', zoomByFingers, { passive: true })
    report()
    return () => {
      listeners.forEach((listener) => listener.remove())
      shared.element.removeEventListener('pointerdown', stopGlide)
      shared.element.removeEventListener('wheel', zoomByWheel)
      shared.element.removeEventListener('touchstart', zoomByFingers)
    }
  }, [shared])

  // 拡大・縮小の途中も、拡大の度合いを知らせる（建物の大きさを決め直すため）。1 コマに 1 回まで
  useEffect(() => {
    if (!shared) return
    const { map } = shared
    const pending = { frame: 0 }
    const listener = map.addListener('zoom_changed', () => {
      cancelAnimationFrame(pending.frame)
      pending.frame = requestAnimationFrame(() => {
        const zoom = map.getZoom()
        if (zoom !== undefined) reportZoom(zoom)
      })
    })
    return () => {
      cancelAnimationFrame(pending.frame)
      listener.remove()
    }
  }, [shared])

  useEffect(() => {
    if (shared) checkLogoSoon()
  }, [shared, bottomInset])

  // ---- 建物の模型：ベクター地図なら、WebGL の層に three.js で描く ----
  const [vector, setVector] = useState(false)
  const drawsBuildings = useEffectEvent(onDrawsBuildings)
  useEffect(() => {
    if (!shared) return
    const { map } = shared
    const check = () => setVector(map.getRenderingType() === google.maps.RenderingType.VECTOR)
    const listener = map.addListener('renderingtype_changed', check)
    check()
    return () => listener.remove()
  }, [shared])

  useEffect(() => {
    drawsBuildings(vector)
    return () => drawsBuildings(false)
  }, [vector])

  useEffect(() => {
    if (!shared || !vector) return
    // 輪郭線の色は、選んだ建物は画面のほかの「建てる」と、建ったばかりの建物は「ルート（しおり）」と同じトークンから読む。
    // 読めなければ空にし、輪郭線を出さない（手で写した色を置かない）
    const css = host.current ? getComputedStyle(host.current) : null
    const outlineColors = {
      selected: css?.getPropertyValue('--color-build').trim() ?? '',
      celebrating: css?.getPropertyValue('--color-route').trim() ?? '',
    }
    shared.buildings ??= createBuildingsOverlay(shared.map, buildingSize, outlineColors)
    shared.buildings.setSize(buildingSize)
    shared.buildings.setBuildings(buildings)
  }, [shared, vector, buildings, buildingSize])

  // 画面を離れるときに、建物を地図から外す（地図は使い回すので、残すと次の旅に出てしまう）
  useEffect(() => {
    if (!shared) return
    return () => shared.buildings?.setBuildings([])
  }, [shared])

  // ---- ルートの線：自分たちで計算した順番を、まっすぐ結ぶ（Routes API は使わない） ----
  // ベクター地図では、模型と同じ WebGL の層に、模型より先に描く（Polyline だと模型の上に出てしまう）。
  // ベクターでないときは、模型は印の中の絵なので、google.maps.Polyline で引く（印が線の上に出る）
  const routeColors = () => {
    const css = host.current ? getComputedStyle(host.current) : null
    return {
      color: css?.getPropertyValue('--color-route').trim() || '#1673d1',
      edge: css?.getPropertyValue('--color-surface').trim() || '#ffffff',
    }
  }
  useEffect(() => {
    // 模型の層は、上の effect（模型）が先に作っている
    const overlay = shared?.buildings
    if (!overlay || !vector) return
    const colors = routeColors()
    // 点線（決まっていないルート案）は、ルート案をやめたので、この層では描かない
    overlay.setLines(
      lines.filter((line) => !line.dashed).map((line) => line.points),
      colors,
    )
    // 線が変わったとき、画面を離れるときに消す（地図は使い回すので、残すと次の画面に出てしまう）
    return () => overlay.setLines([], colors)
  }, [shared, vector, lines])

  useEffect(() => {
    if (!shared || vector || lines.length === 0) return
    const { color, edge } = routeColors()
    const drawn = lines.flatMap((line) => {
      const common = { map: shared.map, path: line.points, clickable: false, geodesic: true }
      if (line.dashed) {
        // まだ決まっていない案は点線（丸を等間隔に並べる）
        const dot = (fillColor: string, scale: number) => ({
          icon: { path: google.maps.SymbolPath.CIRCLE, fillColor, fillOpacity: 1, strokeOpacity: 0, scale },
          offset: '0',
          repeat: '16px',
        })
        return [
          new google.maps.Polyline({ ...common, strokeOpacity: 0, icons: [dot(edge, 5.5)], zIndex: 1 }),
          new google.maps.Polyline({ ...common, strokeOpacity: 0, icons: [dot(color, 3.5)], zIndex: 2 }),
        ]
      }
      return [
        new google.maps.Polyline({ ...common, strokeColor: edge, strokeOpacity: 1, strokeWeight: 10, zIndex: 1 }),
        new google.maps.Polyline({ ...common, strokeColor: color, strokeOpacity: 1, strokeWeight: 6, zIndex: 2 }),
      ]
    })
    // 線が変わったとき、画面を離れるときに外す（地図は使い回すので、残すと次の画面に出てしまう）
    return () => drawn.forEach((polyline) => polyline.setMap(null))
  }, [shared, vector, lines])

  const style = { '--map-bottom-inset': `${bottomInset}px` } as CSSProperties
  return (
    <div
      ref={host}
      className={shrunk ? `${styles.host} ${styles.shrunk}` : styles.host}
      style={style}
      data-map="google"
      data-map-ready={shared ? 'true' : 'false'}
      data-route-lines={lines.length}
    >
      {shared && <Markers shared={shared} markers={markers} />}
    </div>
  )
}

/** 印を地図に置く。印 1 つにつき AdvancedMarkerElement を 1 つ作り、その中身に React の部品を差し込む */
function Markers({ shared, markers }: { shared: SharedMap; markers: SurfaceMarker[] }) {
  const live = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>())
  const [slots, setSlots] = useState<ReadonlyMap<string, HTMLElement>>(new Map())

  useEffect(() => {
    const { map, Marker } = shared
    const wanted = new Set(markers.map((marker) => marker.id))
    for (const [id, marker] of live.current) {
      if (wanted.has(id)) continue
      marker.map = null
      live.current.delete(id)
    }
    for (const { id, lat, lng, zIndex } of markers) {
      let marker = live.current.get(id)
      if (!marker) {
        const content = document.createElement('div')
        content.className = styles.anchor
        content.dataset.marker = id
        marker = new Marker({ map, content, position: { lat, lng }, zIndex })
        live.current.set(id, marker)
      } else {
        const position = marker.position as google.maps.LatLngLiteral | null
        if (!position || position.lat !== lat || position.lng !== lng) marker.position = { lat, lng }
        if (marker.zIndex !== zIndex) marker.zIndex = zIndex
      }
    }
    // 差し込み先（印の中身の要素）が前と同じなら、描き直さない
    setSlots((current) => {
      const next = new Map([...live.current].map(([id, marker]) => [id, marker.content as HTMLElement]))
      const same = current.size === next.size && [...next].every(([id, element]) => current.get(id) === element)
      return same ? current : next
    })
  }, [shared, markers])

  // 画面を離れるときに、印を地図から外す（地図そのものは使い回すので、残すと次の旅に出てしまう）
  useEffect(() => {
    const markersOnMap = live.current
    return () => {
      for (const marker of markersOnMap.values()) marker.map = null
      markersOnMap.clear()
    }
  }, [])

  return markers.map((marker) => {
    const slot = slots.get(marker.id)
    return slot ? createPortal(marker.node, slot, marker.id) : null
  })
}
