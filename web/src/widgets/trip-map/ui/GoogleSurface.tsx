import { type CSSProperties, useEffect, useEffectEvent, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type BuildingsOverlay, createBuildingsOverlay } from '../lib/buildingsOverlay'
import { loadGoogleMaps, onGoogleMapsAuthFailure } from '../lib/loadGoogleMaps'
import { isDevelopmentHost, type MapConfig } from '../lib/mapMode'
import { backToJapan, MAX_ZOOM, MIN_ZOOM, type MapView, unproject, viewBetween, viewForBounds, viewGap, viewZoomingOut, WHOLE_JAPAN } from '../lib/mercator'
import type { AreaLook, SurfaceMarker, SurfaceProps } from '../model/surface'
import { useCountMapLoad } from '../model/useCountMapLoad'
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
/** 日本の外まで動かしたとき、日本全体へ戻るのにかける時間（ms） */
const BACK_TO_JAPAN_MS = 900
/** 地図の上に重ねる帯の高さ（px）のおよそ。見えている所の真ん中を出すのに使う */
const TOP_BAR = 80
/** 指 1 本で地図を動かし始めてから、「動かした」と知らせるまで待つ時間（ms）。この間に 2 本目が来たら、拡大・縮小として扱う */
const PINCH_WAIT_MS = 150

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
function sharedMap(config: MapConfig, initialView: MapView, host: HTMLElement | null, onCreated: () => void): Promise<SharedMap> {
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
    // 作ったときだけ数える（使い回すときは数えない。API の使用量の表示のため）
    onCreated()
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
  onDrawsBuildings,
  areas,
  areaOutline = true,
  onAreaClick,
  minZoom,
  config,
  onFailed,
}: Props) {
  const countMapLoad = useCountMapLoad()
  const host = useRef<HTMLDivElement>(null)
  const [shared, setShared] = useState<SharedMap | null>(null)
  const [shrunk, setShrunk] = useState(false)
  const pendingView = useRef<MapView | null>(null)
  // 地図ができる前に頼まれた傾き（場所選びの地図は、最初から傾けて映す）
  const pendingTilt = useRef(0)

  const fail = useEffectEvent(onFailed)
  const countLoad = useEffectEvent(countMapLoad)
  const firstView = useRef(initialView)
  // なめらかに動かしている途中の、次のコマ。新しく動かすとき、人が地図を動かし始めたとき、外したときに捨てる
  // （続けてスワイプしたとき、古い動きで前の場所へ戻らないように。#224）
  const glide = useRef(0)
  useEffect(() => () => cancelAnimationFrame(glide.current), [])

  useEffect(() => {
    const effect = { cancelled: false }
    sharedMap(config, firstView.current, host.current, () => countLoad()).then(
      (value) => {
        if (effect.cancelled) return
        host.current?.append(value.element)
        const view = pendingView.current ?? firstView.current
        // 地図は使い回すので、前の画面で傾けたままになっていても、向きと傾きを戻して始める（傾けて始めると頼まれていれば、その傾き）
        value.map.moveCamera({ center: view.center, zoom: view.zoom, tilt: pendingTilt.current, heading: 0 })
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
          pendingTilt.current = tilt
          return
        }
        cancelAnimationFrame(glide.current)
        // 傾きは、ベクター地図だけが受け付ける（ラスター地図では Maps が 0 のままにする）
        shared.map.moveCamera({ center: view.center, zoom: view.zoom, tilt })
      },
      fly(view, tilt, ms, options) {
        if (!shared) {
          pendingView.current = view
          pendingTilt.current = tilt
          return
        }
        cancelAnimationFrame(glide.current)
        const { map } = shared
        const center = map.getCenter()
        const zoom = map.getZoom()
        if (!center || zoom === undefined || reducedMotion()) {
          map.moveCamera({ center: view.center, zoom: view.zoom, tilt })
          return
        }
        const from = { center: center.toJSON(), zoom }
        const fromTilt = map.getTilt() ?? 0
        // 引く深さ（拡大の度合い）。離れているほど深く引く
        // 日本全体のように引いた所から寄るときは、もう引いているので、引かずにまっすぐ寄る
        const zoomingIn = view.zoom - from.zoom
        const dip = options?.swoop && zoomingIn < 1 ? Math.min(2, Math.max(0.8, Math.log2(1 + viewGap(from, view) / 250))) * (1 - Math.max(0, zoomingIn)) : 0
        // 大きく引くときは、その場から引いてから動く（寄ったまま途中の土地を流して映さない）
        const zoomingOut = zoomingIn < -0.5
        const start = performance.now()
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / ms)
          const e = easeInOut(t)
          const between = zoomingOut ? viewZoomingOut(from, view, t) : viewBetween(from, view, e)
          map.moveCamera({
            center: between.center,
            zoom: between.zoom - dip * Math.sin(Math.PI * e),
            tilt: fromTilt + (tilt - fromTilt) * e,
          })
          if (t < 1) glide.current = requestAnimationFrame(step)
        }
        glide.current = requestAnimationFrame(step)
      },
    }),
    [shared],
  )

  // 日本の外まで動かしたら、日本全体（沖縄から北海道まで）へ、ぎゅいーんと引きながら戻る（傾きはそのまま、向きは北を上に戻す）。
  // 上の帯と下のシート・操作欄に隠れないよう、上は帯のぶん、下は bottomInset のぶんあける
  const backToWholeJapan = useEffectEvent(() => {
    const element = host.current
    if (!shared || !element) return
    cancelAnimationFrame(glide.current)
    const { map } = shared
    const center = map.getCenter()
    const zoom = map.getZoom()
    const size = { width: element.clientWidth, height: element.clientHeight }
    const view = viewForBounds(WHOLE_JAPAN, size, { top: TOP_BAR + 10, right: 16, bottom: bottomInset + 16, left: 16 })
    if (!center || zoom === undefined || reducedMotion()) {
      map.moveCamera({ center: view.center, zoom: view.zoom, heading: 0 })
      return
    }
    const from = { center: center.toJSON(), zoom }
    const fromTilt = map.getTilt() ?? 0
    const fromHeading = map.getHeading() ?? 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / BACK_TO_JAPAN_MS)
      // その場から引いて戻る（寄ったまま途中の土地を流して映さない）
      const between = viewZoomingOut(from, view, t)
      map.moveCamera({ center: between.center, zoom: between.zoom, tilt: fromTilt, heading: fromHeading * (1 - easeInOut(t)) })
      if (t < 1) glide.current = requestAnimationFrame(step)
    }
    glide.current = requestAnimationFrame(step)
  })

  // 見えている所（上の帯と、下のシート・操作欄のあいだ）の真ん中が、日本の外にあるか。
  // 地図そのものの真ん中で見ると、下のシートが大きい画面では、日本全体を映していても真ん中が沖縄より南の海になってしまう
  const outsideJapan = useEffectEvent((view: MapView, size: { width: number; height: number }) => {
    const middle = unproject(view, size, { x: size.width / 2, y: (TOP_BAR + size.height - bottomInset) / 2 })
    return backToJapan(middle) !== null
  })

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
      // 日本の外まで動かしたら、日本全体へ戻す（戻り終わったときに、もう一度ここへ来て知らせる）
      if (outsideJapan({ center: center.toJSON(), zoom }, { width: element.clientWidth, height: element.clientHeight })) {
        backToWholeJapan()
        return
      }
      const { north, south, east, west } = bounds.toJSON()
      reportView({ center: center.toJSON(), zoom }, { north, south, east, west }, { width: element.clientWidth, height: element.clientHeight })
    }
    // 指の操作の様子。Google の地図は、指 2 本の拡大・縮小でも dragstart を出すので、それを「地図を動かした」と取り違えないよう、
    // 触れ始めから今までに指が 2 本になったか（pinch）を覚えておく。指 1 本で動かし始めたときは、少し待ってから知らせる
    // （その間に 2 本目が来たら、拡大・縮小として扱う）。しおりのシートを出したまま、上の地図を拡大・縮小できるように（Takana の依頼、2026-11-22）
    const touch = { fingers: 0, pinch: false, pending: undefined as ReturnType<typeof setTimeout> | undefined }
    const cancelPendingMove = () => {
      clearTimeout(touch.pending)
      touch.pending = undefined
    }
    const flushPendingMove = () => {
      if (touch.pending === undefined) return
      cancelPendingMove()
      userMove()
    }
    const listeners = [
      map.addListener('idle', report),
      map.addListener('click', () => backgroundClick()),
      map.addListener('dragstart', () => {
        cancelAnimationFrame(glide.current)
        // 指 2 本の操作は拡大・縮小（シートは下げない）
        if (touch.pinch) return userZoom()
        // マウスで動かしたときは、すぐ知らせる
        if (touch.fingers === 0) return userMove()
        cancelPendingMove()
        touch.pending = setTimeout(flushPendingMove, PINCH_WAIT_MS)
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
      // 指が 1 本もない所から触れ始めたら、新しい操作
      if (touch.fingers === 0) touch.pinch = false
      touch.fingers = event.touches.length
      if (event.touches.length < 2) return
      // 2 本目が来た：待っていた「動かした」の知らせは出さない。この操作は、指を全部離すまで拡大・縮小として扱う
      touch.pinch = true
      cancelPendingMove()
      stopGlide()
      userZoom()
    }
    const releaseFingers = (event: TouchEvent) => {
      touch.fingers = event.touches.length
      // 待っている間に指を離した（指 1 本のまま、すぐ離した）：動かしたことにする
      if (touch.fingers === 0) flushPendingMove()
    }
    shared.element.addEventListener('pointerdown', stopGlide)
    shared.element.addEventListener('wheel', zoomByWheel, { passive: true })
    // Google の地図より先に指の本数を知るため、捕捉の段階で受け取る
    shared.element.addEventListener('touchstart', zoomByFingers, { passive: true, capture: true })
    shared.element.addEventListener('touchend', releaseFingers, { passive: true, capture: true })
    shared.element.addEventListener('touchcancel', releaseFingers, { passive: true, capture: true })
    report()
    return () => {
      listeners.forEach((listener) => listener.remove())
      cancelPendingMove()
      shared.element.removeEventListener('pointerdown', stopGlide)
      shared.element.removeEventListener('wheel', zoomByWheel)
      shared.element.removeEventListener('touchstart', zoomByFingers, { capture: true })
      shared.element.removeEventListener('touchend', releaseFingers, { capture: true })
      shared.element.removeEventListener('touchcancel', releaseFingers, { capture: true })
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

  // いちばん引けるところ。地図は旅をつくる画面と旅の画面で使い回すので、渡されなければ（外したときも）日本全体まで引けるように戻す
  useEffect(() => {
    if (!shared) return
    shared.map.setOptions({ minZoom: minZoom ?? MIN_ZOOM })
    return () => shared.map.setOptions({ minZoom: MIN_ZOOM })
  }, [shared, minZoom])

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
    shared.buildings ??= createBuildingsOverlay(shared.map, outlineColors)
    shared.buildings.setBuildings(buildings)
  }, [shared, vector, buildings])

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

  // ---- 塗る範囲（旅をつくるときに選ぶ地方）：google.maps.Polygon で塗る。押すと onAreaClick ----
  const clickArea = useEffectEvent((id: string) => onAreaClick?.(id))
  // 押せるかどうかだけを見る（onAreaClick は描き直すたびに新しい関数になるので、そのたびに塗り直さない）
  const clickable = Boolean(onAreaClick)
  // ---- 地図の境界の層（Google の県境）：マップ ID の地図のスタイルで都道府県の層をオンにしてあれば使える ----
  // （todo/humans/2026-11-16-boundary-layer.md）。使えて、すべての範囲に県の場所の ID があれば、自前の形の代わりにこれで塗る
  const boundaryLayer = useRef<google.maps.FeatureLayer | null>(null)
  const [boundaries, setBoundaries] = useState(false)
  useEffect(() => {
    if (!shared) return
    const check = () => {
      // 使えないときに getFeatureLayer を呼ぶとエラーが出るので、先に地図ができることを確かめる
      const layer = shared.map.getMapCapabilities().isDataDrivenStylingAvailable
        ? shared.map.getFeatureLayer(google.maps.FeatureType.ADMINISTRATIVE_AREA_LEVEL_1)
        : null
      boundaryLayer.current = layer?.isAvailable ? layer : null
      setBoundaries(Boolean(boundaryLayer.current))
    }
    check()
    const listener = shared.map.addListener('mapcapabilities_changed', check)
    return () => listener.remove()
  }, [shared])
  // 開発のときだけ：県を押すと、その県の場所の ID と押した位置をコンソールに出す（entities/trip の prefecturePlaceIds.ts を書くため）
  useEffect(() => {
    const layer = boundaryLayer.current
    if (!boundaries || !layer || !isDevelopmentHost()) return
    const listener = layer.addListener('click', (event: google.maps.FeatureMouseEvent) => {
      const feature = event.features.at(0) as google.maps.PlaceFeature | undefined
      console.info('[boundary]', feature?.placeId, event.latLng?.lat(), event.latLng?.lng())
    })
    return () => listener.remove()
  }, [boundaries])
  const byBoundaries = Boolean(boundaries && areas && areas.length > 0 && areas.every((area) => area.places?.length))

  const areaLooks = (): Record<AreaLook, google.maps.PolygonOptions> => {
    const css = host.current ? getComputedStyle(host.current) : null
    const go = css?.getPropertyValue('--color-go').trim() || '#1a9337'
    const goEdge = css?.getPropertyValue('--color-go-edge').trim() || '#12732a'
    const surface = css?.getPropertyValue('--color-surface').trim() || '#ffffff'
    const ink = css?.getPropertyValue('--color-text').trim() || '#2a2e33'
    // 塗り方ごとの色（model/surface.ts の AreaLook）。選んでいない範囲は、白く薄く塗って白い縁で区切る
    // （地図の陸の色の上で、地方の境目が見えるように）
    return {
      picked: { fillColor: go, fillOpacity: 0.45, strokeColor: goEdge, strokeOpacity: 1, strokeWeight: 2.5, zIndex: 2 },
      unpicked: { fillColor: surface, fillOpacity: 0.2, strokeColor: surface, strokeOpacity: 0.95, strokeWeight: 1.5, zIndex: 1 },
      outside: { fillColor: ink, fillOpacity: 0.28, strokeOpacity: 0, strokeWeight: 0, zIndex: 1 },
      'inside-line': { fillOpacity: 0, strokeColor: goEdge, strokeOpacity: 0.9, strokeWeight: 2.5, zIndex: 2 },
    }
  }

  // 地図の境界の層で塗る（県ごとの塗り方）
  useEffect(() => {
    const layer = boundaryLayer.current
    if (!layer || !byBoundaries || !areas) return
    const looks = areaLooks()
    const byPlace = new Map<string, { area: string; look: google.maps.PolygonOptions }>()
    for (const area of areas) for (const place of area.places ?? []) byPlace.set(place.placeId, { area: area.id, look: looks[place.look] })
    layer.style = ({ feature }) => {
      const found = byPlace.get((feature as google.maps.PlaceFeature).placeId)
      if (!found) return null
      const { look } = found
      // 境界の層では、どの県の縁を上に描くかを決められない（zIndex がない）。下に描くはずの塗り方（zIndex 1。選んでいない県）の
      // 縁を描くと、隣の選んだ県の緑の縁の上に重なることがあるので、描かない（県の境目は地図の県境の線で見える）
      const lower = (look.zIndex ?? 0) < 2
      return {
        fillColor: look.fillColor as string | undefined,
        fillOpacity: look.fillOpacity ?? 0,
        strokeColor: look.strokeColor as string | undefined,
        strokeOpacity: areaOutline && !lower ? (look.strokeOpacity ?? 0) : 0,
        strokeWeight: look.strokeWeight ?? undefined,
      }
    }
    const listener = clickable
      ? layer.addListener('click', (event: google.maps.FeatureMouseEvent) => {
          const feature = event.features.at(0) as google.maps.PlaceFeature | undefined
          const found = feature && byPlace.get(feature.placeId)
          if (found) clickArea(found.area)
        })
      : null
    return () => {
      listener?.remove()
      layer.style = null
    }
  }, [byBoundaries, areas, clickable, areaOutline])

  // 自前の形で塗る（境界の層が使えないとき、県の場所の ID がそろっていないとき）
  useEffect(() => {
    if (!shared || !areas || areas.length === 0 || byBoundaries) return
    const looks = areaLooks()
    const drawn = areas.map((area) => {
      const look = looks[area.look]
      const polygon = new google.maps.Polygon({
        map: shared.map,
        paths: area.rings,
        clickable,
        ...look,
        strokeOpacity: areaOutline ? look.strokeOpacity : 0,
      })
      if (clickable) polygon.addListener('click', () => clickArea(area.id))
      return polygon
    })
    // 範囲が変わったとき、画面を離れるときに外す（地図は使い回すので、残すと次の画面に出てしまう）
    return () => drawn.forEach((polygon) => polygon.setMap(null))
  }, [shared, areas, clickable, byBoundaries, areaOutline])

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
      {shared && <Markers shared={shared} markers={markers} onFailed={onFailed} />}
    </div>
  )
}

/**
 * 印の操作（作る、動かす、地図から外す）を、例外を外に出さずに行う。地図を読み込めなかったとき（キーが通らないなど）、
 * Maps の印は中の地図が使えず例外を出す。そのまま投げると画面ごと落ちるので、ここで止めて、失敗したかを返す
 */
function markerSafely(action: () => void): boolean {
  try {
    action()
    return true
  } catch (error) {
    console.warn('地図の印を操作できませんでした', error)
    return false
  }
}

/** 印を地図に置く。印 1 つにつき AdvancedMarkerElement を 1 つ作り、その中身に React の部品を差し込む */
function Markers({ shared, markers, onFailed }: { shared: SharedMap; markers: SurfaceMarker[]; onFailed: () => void }) {
  const live = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>())
  const [slots, setSlots] = useState<ReadonlyMap<string, HTMLElement>>(new Map())
  const fail = useEffectEvent(onFailed)

  useEffect(() => {
    const { map, Marker } = shared
    const wanted = new Set(markers.map((marker) => marker.id))
    let ok = true
    for (const [id, marker] of live.current) {
      if (wanted.has(id)) continue
      ok = markerSafely(() => (marker.map = null)) && ok
      live.current.delete(id)
    }
    for (const { id, lat, lng, zIndex, hidesLabels } of markers) {
      const marker = live.current.get(id)
      if (!marker) {
        const content = document.createElement('div')
        content.className = styles.anchor
        content.dataset.marker = id
        // 大きさを持たせた印は、重なる地図の地名を隠す（地名より印を優先する）
        if (hidesLabels) {
          content.style.width = `${hidesLabels.width}px`
          content.style.height = `${hidesLabels.height}px`
        }
        const collisionBehavior = hidesLabels ? ('REQUIRED_AND_HIDES_OPTIONAL' as google.maps.CollisionBehaviorString) : undefined
        ok = markerSafely(() => live.current.set(id, new Marker({ map, content, position: { lat, lng }, zIndex, collisionBehavior }))) && ok
      } else {
        ok =
          markerSafely(() => {
            const position = marker.position as google.maps.LatLngLiteral | null
            if (!position || position.lat !== lat || position.lng !== lng) marker.position = { lat, lng }
            if (marker.zIndex !== zIndex) marker.zIndex = zIndex
          }) && ok
      }
    }
    // 印を扱えなければ、地図を読み込めなかったのと同じに扱う（地図なしの表示に切り替える）
    if (!ok) fail()
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
      // 地図を読み込めなかったあとは外すときにも例外が出るので、止めて残りを続ける
      for (const marker of markersOnMap.values()) markerSafely(() => (marker.map = null))
      markersOnMap.clear()
    }
  }, [])

  return markers.map((marker) => {
    const slot = slots.get(marker.id)
    return slot ? createPortal(marker.node, slot, marker.id) : null
  })
}
