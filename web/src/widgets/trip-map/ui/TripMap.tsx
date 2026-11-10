import { type CSSProperties, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { Member } from '@/entities/member'
import type { ModelJson } from '@/entities/model3d'
import type { LatLng, Pin } from '@/entities/pin'
import type { MapBounds } from '@/entities/wish'
import type { WithId } from '@/shared/api'
import { playSound } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import { readMapConfig } from '../lib/mapMode'
import { legZoom, placeAlong, type TourLeg } from '../lib/tourPath'
import { JAPAN, MAX_ZOOM, MIN_ZOOM, type Padding, spotZoom, viewForBounds, viewForPoints } from '../lib/mercator'
import type { SurfaceBuilding, SurfaceLine, SurfaceMarker } from '../model/surface'
import { useDeclutter } from '../model/useDeclutter'
import { useMapCamera } from '../model/useMapCamera'
import { GoogleSurface } from './GoogleSurface'
import { MapBuilding, MapBuildingSite } from './MapBuilding'
import { OriginMarker } from './OriginMarker'
import { MapPin } from './MapPin'
import { MapVehicle } from './MapVehicle'
import { PlainSurface } from './PlainSurface'
import styles from './TripMap.module.css'

interface Props {
  pins: WithId<Pin>[]
  members: WithId<Member>[]
  /** 建物（完成したピン）の模型。ピンの ID → 模型の JSON。まだ読めていないピンは入っていない */
  models: Record<string, ModelJson>
  /** いま建ったばかりのピン。青い輪郭線と「建築完了」の印を出す（S07） */
  celebratingPinId: string | null
  /** 選んでいるピン（場所カードを出しているピン） */
  selectedPinId: string | null
  /** ピンを押したとき。印のない所を押したら null */
  onSelectPin: (pinId: string | null) => void
  /** 見え方が変わるたびに、映っている範囲と、そのあたりの名前（「甲信越・関東」）を渡す */
  onViewChange: (bounds: MapBounds, label: string) => void
  /** key が変わったら、地図を動かす（MapFocus） */
  focus: MapFocus | null
  /** 上の帯の高さと、下の操作欄・シートの高さ（px）。ピンがこれらに隠れないように動かす */
  topInset: number
  bottomInset: number
  /** ルートの線。場所から場所へまっすぐ結ぶ（道なりではない）。dashed は、まだ決まっていない案 */
  lines?: MapLine[]
  /** 回る順番（ピンの ID → 1 からの番号）。建物の名札に番号を出す（ルート案、しおり） */
  orders?: Record<string, number>
  /**
   * 建物の模型の、画面の上での大きさのもと（px）。渡さなければ 140。線を見せたい画面（しおり）では小さくする。
   * 実際には、この 0.9 倍で描く（BUILDING_SCALE）
   */
  buildingSize?: number
  /** 人が地図を動かし始めたとき（しおりの場所の情報で、シートを閉じるのに使う） */
  onUserMove?: () => void
  /**
   * しおりの再生。渡しているあいだ、車を描き、地図が車を追う（ベクター地図では傾ける）。
   * 寄り具合は区間ごとに、建物と建物のあいだが画面の縦の長さの半分より長く見えるように決める
   */
  tour?: MapTour | null
  /** しおりで地図に出す集合場所（#226）。位置が分かるときだけ渡す。押すと onSelectOrigin */
  origin?: MapOrigin | null
  onSelectOrigin?: () => void
}

/**
 * 地図を動かす合図。key が変わったら動かす。
 * - pinIds：そのピンが全部見えるように動かす（自分の希望にピンが立ったとき、しおりの全体、など）
 * - spot：その場所を真ん中にして、まわりの建物の混み具合で寄り具合を決める（しおりの場所の情報、#224。lib/mercator.ts の spotZoom）。
 *   pinId は、その場所にある建物（まわりの建物に数えない）。集合場所のときは渡さない。
 *   人が地図を指で動かすまでは、上の帯や下のシートの高さが変わるたびに、同じ寄り具合のまま、場所が隠れない所へ寄せ直す
 */
export type MapFocus = { key: string; pinIds: string[] } | { key: string; spot: LatLng; pinId?: string }

/** しおりの地図に出す集合場所。selected は、場所の情報で集合場所を見ているとき */
export interface MapOrigin {
  name: string
  location: LatLng
  selected: boolean
}

/** しおりの再生で、地図に渡すもの。車は、区間の道 leg の progress（0〜1）の所にいる（両端は建物の縁で詰める） */
export interface MapTour {
  leg: TourLeg
  progress: number
}

/** 地図に引く線 1 本 */
export interface MapLine {
  id: string
  points: LatLng[]
  dashed?: boolean
}

const NO_LINES: MapLine[] = []

/** 建物の模型の、画面の上での大きさ（px。模型を斜め上から見た絵の幅） */
const DEFAULT_BUILDING_SIZE = 140
/** 実際に描く大きさは、buildingSize のこの倍（Takana の依頼：2026-11-07 に前の既定の 0.9 倍、2026-11-10 にさらに 0.9 倍） */
const BUILDING_SCALE = 0.81

/** しおりの再生で傾ける角度（度） */
const TOUR_TILT = 45
/** 寄り具合と傾きが、新しい値に近づく速さ（1 コマで縮める差の割合） */
const TOUR_EASE = 0.06
/**
 * 区間を走るときの寄り具合：建物と建物のあいだを、画面の縦の長さのこの割合の長さに見せる。
 * 「縦の長さの半分以上」にする（Youkin06 の要望、2026-11-09）。地図を 45 度傾けると南北の長さが約 0.7 倍に縮んで見えるので、
 * 0.5 を 0.7 で割った 0.7 にして、どの向きの区間でも半分を下回らないようにする
 */
const TOUR_LEG_SCREEN_RATIO = 0.7
/** 場所が 1 つだけで区間がないときの寄り具合 */
const TOUR_STOP_ZOOM = 14
/** 車の絵の大きさ（px） */
const CAR_SIZE = 72
/**
 * 車を止める、建物の真ん中からの近さ。建物の絵の大きさと車の絵の大きさに掛ける割合（それぞれ、模型の土台と車体の半分ほど。
 * 絵の幅は模型の 18 単位ぶんで、建物の土台は 10、車体は長さ 8）
 */
const BUILDING_REACH = 0.3
const CAR_REACH = 0.22
/**
 * しおりの場所の情報で、場所を真ん中にするときの寄り具合の決め（#224。lib/mercator.ts の spotZoom）。
 * 建物の絵の幅の 1.1 倍まで離れれば、2 つの建物の絵は重ならない（絵の中で建物が描かれるのは幅の 0.76 倍、高さの 0.8 倍）。
 * 9 は県のあたり、15 は街のあたり。まわりに建物がないときは、前の決め（場所の情報は 11 でアップ）のまま。
 * 今の拡大の度合いとの差が 0.5 以内なら変えない。どれも、スマホ（390×844）の見え方で仮に決めた値
 */
const SPOT_RULE = { gap: 1.1, min: 9, max: 15, alone: 11, keep: 0.5 }
/** 拡大の度合い 0、赤道での、1px あたりの長さ（m） */
const METERS_PER_PIXEL_AT_ZOOM_0 = 156_543.03392

/** 最初に出す見え方を決めるときの、画面の大きさの見込み（ページの枠は幅 480px まで） */
const guessSize = () => ({ width: Math.min(window.innerWidth, 480), height: window.innerHeight })

/**
 * みんなの地図（S02、S04〜S08 の地図）。候補のピン、工事中の場所、建った建物と、誰の希望かを出す。
 *
 * 建物の模型は、面が 3D で描けるとき（本物のベクター地図）は面に任せ（WebGL で地図に重ねる）、
 * そうでないとき（地図なしの表示など）は、同じ模型を絵にして印の中に置く。
 *
 * 本物の地図（Google Maps）と、地図なしの表示のどちらかの「面」に、同じ印を置く（model/surface.ts）。
 * どちらにするかは lib/mapMode.ts が決める。本物の地図を読み込めなかったら、地図なしに切り替える。
 * 親は position: relative で画面いっぱいの枠を用意していて、上の帯と下のシートがこの上に重なる。
 *
 * ルートの線（lines）は、面が描く（本物の地図は google.maps.Polyline、地図なしの表示は SVG）。
 */
export function TripMap({
  pins,
  members,
  models,
  celebratingPinId,
  selectedPinId,
  onSelectPin,
  onViewChange,
  focus,
  topInset,
  bottomInset,
  lines = NO_LINES,
  orders,
  buildingSize = DEFAULT_BUILDING_SIZE,
  onUserMove,
  tour = null,
  origin = null,
  onSelectOrigin,
}: Props) {
  const config = useMemo(() => readMapConfig(), [])
  const [failed, setFailed] = useState(false)
  // 面が、建物を 3D で描いているか。描いていなければ、絵にして印の中に置く
  const [surfaceDrawsBuildings, setSurfaceDrawsBuildings] = useState(false)

  const padding = useMemo<Padding>(
    // 右は、名札がはみ出さないぶん空ける（地図なしの表示では、拡大・縮小のボタンのぶんにもなる）
    () => ({ top: topInset + 70, right: 76, bottom: bottomInset + 44, left: 44 }),
    [topInset, bottomInset],
  )

  // 最初の見え方：ピンがあれば全部が入るように、なければ日本全体（S02「日本の3Dマップが出現」）
  const [initialView] = useState(() => {
    const size = guessSize()
    const start: Padding = { top: 150, right: 44, bottom: 200, left: 44 }
    return viewForPoints(pins.map((pin) => pin.location), size, start, 9) ?? viewForBounds(JAPAN, size, { ...start, top: 90, bottom: 150 })
  })
  const camera = useMapCamera(onViewChange, initialView.zoom)

  // 建物はいつも同じ大きさで描く。引いてぶつかるときは、位置を変えずに 1 つを代表にして数を出す。
  // 名札は、十分に寄っているときだけ出す（lib/declutter.ts、model/useDeclutter.ts）
  const modelSize = Math.round(buildingSize * BUILDING_SCALE)
  const layout = useDeclutter({ pins, members, orders, size: modelSize, selectedId: selectedPinId, celebratingId: celebratingPinId, zoom: camera.zoom })

  // 印を押した直後に届く「地図を押した」は、印を押したぶんなので捨てる（選んだピンがすぐ外れるのを防ぐ）
  const lastMarkerClick = useRef(0)
  const onBackgroundClick = () => {
    if (Date.now() - lastMarkerClick.current > 250) onSelectPin(null)
  }

  const markers = useMemo<SurfaceMarker[]>(
    () =>
      pins.flatMap((pin): SurfaceMarker[] => {
        const selected = pin.id === selectedPinId
        const wisher = members.find((member) => member.id === pin.uid)
        const onSelect = () => {
          lastMarkerClick.current = Date.now()
          onSelectPin(pin.id)
        }
        const at = { id: pin.id, lat: pin.location.lat, lng: pin.location.lng }
        const placement = layout.placements[pin.id] ?? { hidden: false, count: 1, labelHidden: false }
        // ほかの建物の代表にまとめられた建物は出さない
        if (placement.hidden) return []
        const labelHidden = placement.labelHidden
        if (pin.status === 'building') {
          const builder = members.find((member) => member.id === pin.builtBy)
          return [{ ...at, zIndex: selected ? 1000 : 60, node: <MapBuildingSite pin={pin} builder={builder} labelHidden={labelHidden} /> }]
        }
        if (pin.status === 'done') {
          const model = models[pin.id] ?? null
          return [
            {
              ...at,
              // 建物は大きいので、候補のピンより奥に置く（近くのピンを押せるように）。
              // まとめた代表は、数の札を見せたいので、ピンと工事中の印より手前に置く
              zIndex: selected ? 1000 : placement.count > 1 ? 70 : 20,
              node: (
                <MapBuilding
                  pin={pin}
                  wisher={wisher}
                  sprite={surfaceDrawsBuildings ? null : model}
                  size={modelSize}
                  selected={selected}
                  celebrating={pin.id === celebratingPinId}
                  order={orders?.[pin.id]}
                  labelHidden={labelHidden}
                  count={placement.count}
                  onSelect={onSelect}
                />
              ),
            },
          ]
        }
        // 候補と、建築に失敗したもの（もう一度建てられる）
        return [
          {
            ...at,
            zIndex: selected ? 1000 : 40,
            node: <MapPin pin={pin} wisher={wisher} selected={selected} labelHidden={labelHidden} onSelect={onSelect} />,
          },
        ]
      }),
    [pins, members, models, selectedPinId, celebratingPinId, surfaceDrawsBuildings, onSelectPin, orders, modelSize, layout],
  )

  // 集合場所の印（しおり）。建物より奥に置く（近くの建物を押せるように）。見ているときは、いちばん手前
  const markersWithOrigin = useMemo<SurfaceMarker[]>(() => {
    if (!origin) return markers
    const onSelect = () => {
      lastMarkerClick.current = Date.now()
      onSelectOrigin?.()
    }
    const node = <OriginMarker name={origin.name} selected={origin.selected} onSelect={onSelectOrigin ? onSelect : undefined} />
    return [{ id: 'trip-origin', lat: origin.location.lat, lng: origin.location.lng, zIndex: origin.selected ? 1000 : 10, node }, ...markers]
  }, [markers, origin, onSelectOrigin])

  // しおりの再生中は、走る車をいちばん手前に置く。建物の模型の真ん中ではなく、縁から走り出して縁で止まる。
  // 建物も車も画面の上でいつも同じ大きさに描くので、詰める道のり（m）は、いまの拡大の度合いで決める
  const zoom = camera.zoom
  const car = useMemo(() => {
    if (!tour) return null
    const middle = tour.leg.points[0]
    const metersPerPixel = middle ? (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((middle.lat * Math.PI) / 180)) / 2 ** zoom : 0
    return placeAlong(tour.leg, tour.progress, (modelSize * BUILDING_REACH + CAR_SIZE * CAR_REACH) * metersPerPixel)
  }, [tour, zoom, modelSize])
  const markersWithCar = useMemo<SurfaceMarker[]>(
    () =>
      car
        ? [...markersWithOrigin, { id: 'tour-car', lat: car.point.lat, lng: car.point.lng, zIndex: 1100, node: <MapVehicle heading={car.heading} size={CAR_SIZE} /> }]
        : markersWithOrigin,
    [markersWithOrigin, car],
  )

  const buildings = useMemo<SurfaceBuilding[]>(
    () =>
      pins.flatMap((pin) => {
        const model = pin.status === 'done' ? models[pin.id] : undefined
        const placement = layout.placements[pin.id]
        if (!model || placement?.hidden) return []
        return [
          {
            id: pin.id,
            lat: pin.location.lat,
            lng: pin.location.lng,
            model,
            selected: pin.id === selectedPinId,
            celebrating: pin.id === celebratingPinId,
          },
        ]
      }),
    [pins, models, selectedPinId, celebratingPinId, layout],
  )

  // しおりの場所の情報（focus の spot）で、寄せた拡大の度合い。moved は、そのあと人が地図を指で動かしたか
  const spotShown = useRef<{ key: string; zoom: number; moved: boolean } | null>(null)
  const spotFocus = focus && 'spot' in focus ? focus : null
  // 人が地図を動かし始めた：寄せ直しをやめる（指で動かしている地図と取り合わない）
  const userMove = () => {
    if (spotShown.current) spotShown.current.moved = true
    onUserMove?.()
  }
  // 人が拡大・縮小した（ホイール、指 2 本、地図なしの表示の ＋ −）：寄せ直しをやめ、人の選んだ寄り具合を保つ。シートは下げない
  const userZoom = () => {
    if (spotShown.current) spotShown.current.moved = true
  }

  // 選んだピンが、下のシートや上の帯に隠れないようにする。
  // しおりの場所の情報でその建物を寄せているあいだは、下の寄せ直し（keepSpot）に任せる（人が地図を動かしたあとは、ここで見る）
  const showPoints = camera.showPoints
  const showSelected = useEffectEvent(() => {
    const shown = spotShown.current
    if (spotFocus && spotFocus.pinId === selectedPinId && !(shown?.key === spotFocus.key && shown.moved)) return
    const pin = pins.find((item) => item.id === selectedPinId)
    if (pin) showPoints([pin.location], padding)
  })
  useEffect(() => {
    if (selectedPinId) showSelected()
  }, [selectedPinId, bottomInset])

  // ピンがまだないあいだは、下のシートの高さが変わっても、日本全体が見える所に収め直す（S02）
  const noPins = pins.length === 0
  // ただし、しおりで集合場所を見ているとき（建物がなくても場所の focus がある）は、そちらに任せる（日本全体へ跳ばない）
  const showJapan = useEffectEvent(() => {
    if (!spotFocus) camera.showBounds(JAPAN, { ...padding, top: topInset + 16, bottom: bottomInset + 16 })
  })
  useEffect(() => {
    if (noPins && bottomInset > 0) showJapan()
  }, [noPins, bottomInset])

  const showFocused = useEffectEvent(() => {
    if (!focus) return
    if ('spot' in focus) {
      // まわりの建物の混み具合で寄り具合を決める。比べる「今の拡大の度合い」は、続けてスワイプしたときは前に決めた値
      // （地図が動いている途中の値で決めると、速く続けて移ったときに寄り具合がばらつく）
      const previous = spotShown.current && !spotShown.current.moved ? spotShown.current.zoom : camera.currentZoom()
      const others = pins.filter((pin) => pin.id !== focus.pinId).map((pin) => pin.location)
      const zoom = spotZoom(focus.spot, others, camera.currentSize() ?? guessSize(), padding, { ...SPOT_RULE, size: modelSize }, previous)
      spotShown.current = { key: focus.key, zoom, moved: false }
      camera.centerOn(focus.spot, zoom, padding)
      return
    }
    spotShown.current = null
    showPoints(
      pins.filter((pin) => focus.pinIds.includes(pin.id)).map((pin) => pin.location),
      padding,
    )
  })
  const focusKey = focus?.key
  const cameraReady = camera.ready
  useEffect(() => {
    // 面がまだ見え方を知らせていないうちは動かせないので、知らせてきてから動かす
    if (focusKey && cameraReady) showFocused()
  }, [focusKey, cameraReady])

  // しおりの場所の情報：人が地図を動かすまでは、上の帯や下のシートの高さが変わるたびに、
  // 同じ拡大の度合いのまま、場所が隠れない所へ寄せ直す（写真や口コミが届いてシートが伸びたとき、取っ手でシートを下げたとき）
  const keepSpot = useEffectEvent(() => {
    const shown = spotShown.current
    if (spotFocus && shown && !shown.moved && shown.key === spotFocus.key) camera.centerOn(spotFocus.spot, shown.zoom, padding)
  })
  useEffect(() => {
    if (cameraReady) keepSpot()
  }, [topInset, bottomInset, cameraReady])

  // しおりの再生：1 コマごとに車を真ん中にして追う。寄り具合と傾きは、目標へ少しずつ近づける。
  // 終わったら傾きを 0 に戻す（そのあと、呼ぶ側の focus で全体へ戻る）
  const latestTour = useRef(tour && car ? { ...tour, car } : null)
  useEffect(() => {
    latestTour.current = tour && car ? { ...tour, car } : null
  })
  const touring = tour !== null
  const { currentZoom, currentSize, follow } = camera
  const tourPadding = useEffectEvent(() => padding)
  useEffect(() => {
    if (!touring || !cameraReady) return
    const shown = { zoom: currentZoom() ?? TOUR_STOP_ZOOM, tilt: 0, target: TOUR_STOP_ZOOM, point: null as LatLng | null, bottom: tourPadding().bottom }
    const frame = { id: 0 }
    const step = () => {
      const now = latestTour.current
      if (now) {
        // 下に出るもの（着いた場所の写真）の高さが変わっても、地図が跳ばないよう、下の空きもなめらかに変える
        const target = tourPadding()
        shown.bottom += (target.bottom - shown.bottom) * TOUR_EASE
        const edge = { ...target, bottom: shown.bottom }
        // 寄り具合は区間ごとに決める（走っているあいだも、着いて止まっているあいだも同じ。着いたときは入ってきた区間）
        const heightPx = currentSize()?.height ?? guessSize().height
        const legLevel = legZoom(now.leg, heightPx * TOUR_LEG_SCREEN_RATIO)
        shown.target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, legLevel ?? TOUR_STOP_ZOOM))
        shown.zoom += (shown.target - shown.zoom) * TOUR_EASE
        shown.tilt += (TOUR_TILT - shown.tilt) * TOUR_EASE
        shown.point = now.car.point
        follow(now.car.point, shown.zoom, edge, shown.tilt)
      }
      frame.id = requestAnimationFrame(step)
    }
    frame.id = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame.id)
      if (shown.point) follow(shown.point, shown.zoom, tourPadding(), 0)
    }
  }, [touring, cameraReady, currentZoom, currentSize, follow])

  const surfaceLines = useMemo<SurfaceLine[]>(
    () => lines.filter((line) => line.points.length >= 2).map((line) => ({ id: line.id, points: line.points, dashed: Boolean(line.dashed) })),
    [lines],
  )

  const surfaceProps = {
    ref: camera.surface,
    initialView,
    markers: markersWithCar,
    lines: surfaceLines,
    onView: camera.onView,
    onZoom: camera.onZoom,
    onBackgroundClick,
    onUserMove: userMove,
    onUserZoom: userZoom,
    bottomInset,
    buildings,
    buildingSize: modelSize,
    onDrawsBuildings: setSurfaceDrawsBuildings,
  }
  // 地図なしの表示に切り替えるのは開発のときだけ。本番で読み込めないときは、地図を出さずに文だけ出す
  const plain = config.mode === 'plain' || (failed && config.plainAllowed)
  const unavailable = config.mode === 'unavailable' || (failed && !config.plainAllowed)
  const style = { '--map-bottom-inset': `${bottomInset}px` } as CSSProperties
  if (unavailable) {
    return (
      <div className={styles.map} style={style}>
        <p className={styles.unavailable} role="status">
          地図を読み込めませんでした。電波のよいところで開き直してください
        </p>
      </div>
    )
  }
  return (
    <div className={styles.map} style={style}>
      {plain ? (
        <PlainSurface {...surfaceProps} />
      ) : (
        <GoogleSurface {...surfaceProps} config={config} onFailed={() => {
          playSound('error', { key: 'map-load-error', channel: 'notification' })
          setFailed(true)
        }} />
      )}

      {/* Google の地図は指 2 本とホイールで拡大・縮小できるので、＋ − は出さない（持ち主の判断、2026-11-07）。
          地図なしの表示は指 2 本に対応していないので、＋ − を残す */}
      {plain && (
        <div className={styles.zoom}>
          <Button
            iconOnly
            aria-label="地図を拡大する"
            onClick={() => {
              userZoom()
              playSound('move')
              camera.zoomBy(1)
            }}
          >
            <Icon name="plus" />
          </Button>
          <Button
            iconOnly
            aria-label="地図を縮小する"
            onClick={() => {
              userZoom()
              playSound('move')
              camera.zoomBy(-1)
            }}
          >
            <Icon name="minus" />
          </Button>
        </div>
      )}

      {plain && (
        <p className={styles.note}>
          {failed
            ? '地図を読み込めなかったので、地図なしで表示しています'
            : config.reason === 'off'
              ? '地図なしで表示中（?map=on で地図を出す）'
              : '地図のキーがないので、地図なしで表示しています'}
        </p>
      )}
    </div>
  )
}
