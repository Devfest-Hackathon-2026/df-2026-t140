import { type CSSProperties, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type { Member } from '@/entities/member'
import type { ModelJson } from '@/entities/model3d'
import { isPastCandidate, type LatLng, type Pin } from '@/entities/pin'
import {
  ALL_PREFECTURES,
  pickedFromTrip,
  REGION_IDS,
  REGION_PREFECTURES,
  regionPrefecturePlaces,
  regionRings,
  regionsOfPicked,
} from '@/entities/trip'
import type { MapBounds } from '@/entities/wish'
import type { WithId } from '@/shared/api'
import { translate, playSound } from '@/shared/lib'
import { Button, Icon } from '@/shared/ui'
import { readMapConfig } from '../lib/mapMode'
import { legEndSize, legZoom, type TourLeg, tourMotion } from '../lib/tourPath'
import { regionsBounds, tripStartView } from '../lib/regionBounds'
import { areaMinZoom, JAPAN, MAX_ZOOM, MIN_ZOOM, type Padding, spotZoom, viewForPoints } from '../lib/mercator'
import type { SurfaceArea, SurfaceBuilding, SurfaceLine, SurfaceMarker } from '../model/surface'
import { useDeclutter } from '../model/useDeclutter'
import { useMapCamera } from '../model/useMapCamera'
import { usePinsInView } from '../model/usePinsInView'
import { GoogleSurface } from './GoogleSurface'
import { MapBuilding, MapBuildingSite } from './MapBuilding'
import { OriginMarker } from './OriginMarker'
import { MapPin } from './MapPin'
import { MapVehicle, type TourVehicle } from './MapVehicle'
import { PlainSurface } from './PlainSurface'
import styles from './TripMap.module.css'

interface Props {
  pins: WithId<Pin>[]
  /**
   * いちばん新しい検索の希望の ID。渡したときだけ、ほかの検索の候補を、灰色の半透明の小さいピン（名札なし）で出す
   * （Takana の依頼、2026-11-22）。渡さなければ、候補はどれもふつうのピン
   */
  currentWishId?: string | null
  members: WithId<Member>[]
  /** 建物（完成したピン）の模型。ピンの ID → 模型の JSON。まだ読めていないピンは入っていない */
  models: Record<string, ModelJson>
  /** いま建ったばかりのピン。青い輪郭線と「建築完了」の印を出す（S07） */
  celebratingPinId: string | null
  /** 選んでいるピン（場所カードを出しているピン） */
  selectedPinId: string | null
  /**
   * ピンを押したとき。印のない所を押したら null。
   * count は、押した建物が近くの建物をまとめた代表のとき、その数（自分を含む。まとめていなければ 1）
   */
  onSelectPin: (pinId: string | null, count?: number) => void
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
   * 市街地のあたりでは、この 0.81 倍で描く（BUILDING_SCALE）。引くと小さく、寄ってまわりが空いていれば大きくする（lib/declutter.ts の buildingSizes）
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
  /** しおりで地図に出す空港（飛行機の区間で乗り降りする空港）。押せない印 */
  airports?: readonly MapAirport[]
  /**
   * 旅を作った人が選んだ大まかな場所（地方と、県まで絞ったときの県）。外を灰色で覆い、中を緑の縁で囲む
   * （Youkin06 の決定、2026-11-16。案A）。Google の県境で塗れるときは、県で絞った旅は選んだ県だけを塗る。
   * すべて選んだ旅と、地方のない旅では塗らない
   */
  regions?: readonly string[]
  prefectures?: readonly string[]
  /**
   * 最初の見え方を、建物があっても日本全体にする（日本コレクション。企画書「ユーザー体験」4-3）。
   * 渡さなければ、建物が全部入る範囲から始める
   */
  startWhole?: boolean
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
  /**
   * 一時停止しているか。車はその場に出したまま、追うのをやめる。地図は、傾きを戻しながら、
   * focus の場所（spot）へ途切れずに寄る。false に戻ると、そこから車へ追いつく
   */
  hold?: boolean
  /** 走る乗り物（区間の手段で変える）。ないときは車 */
  vehicle?: TourVehicle
}

/** しおりの地図に出す空港の印（飛行機の区間で乗り降りする空港。集合場所と同じ形の印に、飛行機の絵と名札） */
export interface MapAirport {
  code: string
  name: string
  location: LatLng
}

const NO_AIRPORTS: MapAirport[] = []

/** 地図に引く線 1 本 */
export interface MapLine {
  id: string
  points: LatLng[]
  dashed?: boolean
}

const NO_LINES: MapLine[] = []

/** 建物の模型の、画面の上での大きさのもと（px。模型を斜め上から見た絵の幅） */
const DEFAULT_BUILDING_SIZE = 140
/** 市街地のあたりで描く大きさは、buildingSize のこの倍（Takana の依頼：2026-11-07 に前の既定の 0.9 倍、2026-11-10 にさらに 0.9 倍） */
const BUILDING_SCALE = 0.81

/** しおりの再生で傾ける角度（度） */
const TOUR_TILT = 45
/** 寄り具合と傾きが、新しい値に近づく速さ（1 コマで縮める差の割合） */
const TOUR_EASE = 0.06
/** 一時停止して、その場所へ寄るときの速さ（1 コマで縮める差の割合）。止めたらすぐ場所が見えるよう、走るときより速くする */
const TOUR_SETTLE_EASE = 0.1
/** 続きから再生して、車へ追いつくときの速さ。この割合から始め、1 コマごとに上げて 1（車が真ん中）にする */
const TOUR_CATCH_START = 0.06
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
/** 飛行機が区間の真ん中で浮く高さ（乗り物の絵の大きさに対する割合） */
const PLANE_LIFT = 0.6
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
/**
 * これより寄ったら、旅の大まかな場所の緑の縁を消す（灰色の塗りは残す）。Google の県境の海岸線は地図の海岸線より粗く、
 * 街の中まで寄ると数十 m ずれて見えるため（Youkin06 の決定、2026-11-17。案A）
 */
const AREA_OUTLINE_MAX_ZOOM = 14
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
  currentWishId,
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
  airports = NO_AIRPORTS,
  regions,
  prefectures,
  startWhole = false,
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

  // 旅の大まかな場所（選んだ県）。すべて選んだ旅と、地方のない旅では空
  const pickedKey = pickedFromTrip(regions, prefectures).join(',')
  // 旅の地方。地方を絞っていない旅では空（日本全体を映す）
  const tripRegions = useMemo(() => {
    const picked = pickedKey ? pickedKey.split(',') : []
    return picked.length === ALL_PREFECTURES.length ? [] : regionsOfPicked(picked)
  }, [pickedKey])

  // 最初の見え方：ピンがあれば全部が入るように、なければ旅の地方の全体（地方を絞っていない旅は日本全体。S02「日本の3Dマップが出現」）
  const [initialView] = useState(() => {
    const size = guessSize()
    const start: Padding = { top: 150, right: 44, bottom: 200, left: 44 }
    if (startWhole) return tripStartView([], size)
    return viewForPoints(pins.map((pin) => pin.location), size, start, 9) ?? tripStartView(tripRegions, size)
  })
  const camera = useMapCamera(onViewChange, initialView.zoom)

  // いちばん引けるところ：旅のエリア（選んだ地方の範囲）の全体が、上の帯と下のシートに隠れずに見えるより、少し引いたところまで
  // （Takana の依頼、2026-11-22。lib/mercator.ts の areaMinZoom）。エリアの外に立った建物と、しおりで出す集合場所も入るようにする。
  // 下のシートを大きく広げたぶんまで引けるようにはしない（画面の高さの 45% まで数える。広げたシートの裏までエリアを収めると、引けすぎるため）。
  // 場所を絞っていない旅（日本コレクションも）は限らない
  const floorWidth = camera.width ?? guessSize().width
  const floorBottom = Math.min(bottomInset, window.innerHeight * 0.45)
  const pinPoints = pins.map((pin) => `${pin.location.lat},${pin.location.lng}`).join('|')
  const originPoint = origin ? `${origin.location.lat},${origin.location.lng}` : ''
  const minZoom = useMemo(() => {
    const bounds = startWhole ? null : regionsBounds(tripRegions)
    if (!bounds) return undefined
    const corners = [
      { lat: bounds.north, lng: bounds.west },
      { lat: bounds.south, lng: bounds.east },
    ]
    const extra = [pinPoints, originPoint]
      .flatMap((text) => (text ? text.split('|') : []))
      .map((point) => {
        const [lat, lng] = point.split(',').map(Number)
        return { lat, lng }
      })
    const size = { width: floorWidth, height: window.innerHeight }
    return areaMinZoom([...corners, ...extra], size, { top: topInset + 16, right: 16, bottom: floorBottom + 16, left: 16 }) ?? undefined
  }, [startWhole, tripRegions, pinPoints, originPoint, floorWidth, topInset, floorBottom])

  // 建物の大きさは、引くと小さく、寄ってまわりが空いていれば大きくする。引いてぶつかるときは、位置を変えずに 1 つを代表にして数を出す。
  // 名札は、十分に寄っているときだけ出す（lib/declutter.ts、model/useDeclutter.ts）
  const modelSize = Math.round(buildingSize * BUILDING_SCALE)
  const mapWidth = camera.width ?? guessSize().width
  // 前の検索の候補（灰色のピン）は、見えている所がまるごとその場所の近くに収まるまで寄ったら出す（model/usePinsInView.ts）
  const shownPins = usePinsInView(pins, { currentWishId, selectedId: selectedPinId, shown: camera.shown, topInset, bottomInset })
  const layout = useDeclutter({
    pins: shownPins,
    members,
    orders,
    size: modelSize,
    mapWidth,
    selectedId: selectedPinId,
    celebratingId: celebratingPinId,
    zoom: camera.zoom,
    currentWishId,
  })

  // 印を押した直後に届く「地図を押した」は、印を押したぶんなので捨てる（選んだピンがすぐ外れるのを防ぐ）
  const lastMarkerClick = useRef(0)
  const onBackgroundClick = () => {
    if (Date.now() - lastMarkerClick.current > 250) onSelectPin(null)
  }

  const markers = useMemo<SurfaceMarker[]>(
    () =>
      shownPins.flatMap((pin): SurfaceMarker[] => {
        const selected = pin.id === selectedPinId
        const wisher = members.find((member) => member.id === pin.uid)
        const onSelect = () => {
          lastMarkerClick.current = Date.now()
          onSelectPin(pin.id, layout.placements[pin.id]?.count ?? 1)
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
                  size={layout.sizes[pin.id] ?? layout.baseSize}
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
        // 候補と、建築に失敗したもの（もう一度建てられる）。前の検索の候補は、灰色の小さいピンで、ほかの印より奥に置く
        const past = currentWishId !== undefined && isPastCandidate(pin, currentWishId)
        return [
          {
            ...at,
            zIndex: selected ? 1000 : past ? 30 : pin.namedMatch ? 50 : 40,
            node: <MapPin pin={pin} wisher={wisher} selected={selected} past={past} labelHidden={labelHidden} onSelect={onSelect} />,
          },
        ]
      }),
    [shownPins, currentWishId, members, models, selectedPinId, celebratingPinId, surfaceDrawsBuildings, onSelectPin, orders, layout],
  )

  // 集合場所の印（しおり）。建物より奥に置く（近くの建物を押せるように）。見ているときは、いちばん手前
  // 空港の印も同じ形で、同じ奥行きに置く（飛行機の区間で乗り降りする場所）
  const markersWithOrigin = useMemo<SurfaceMarker[]>(() => {
    const airportMarkers: SurfaceMarker[] = airports.map((airport) => ({
      id: `airport-${airport.code}`,
      lat: airport.location.lat,
      lng: airport.location.lng,
      zIndex: 10,
      node: <OriginMarker name={airport.name} kind={translate('空港', 'Airport')} icon="plane" selected={false} />,
    }))
    if (!origin) return [...airportMarkers, ...markers]
    const onSelect = () => {
      lastMarkerClick.current = Date.now()
      onSelectOrigin?.()
    }
    const node = <OriginMarker name={origin.name} selected={origin.selected} onSelect={onSelectOrigin ? onSelect : undefined} />
    return [{ id: 'trip-origin', lat: origin.location.lat, lng: origin.location.lng, zIndex: origin.selected ? 1000 : 10, node }, ...airportMarkers, ...markers]
  }, [markers, origin, onSelectOrigin, airports])

  // しおりの再生中は、走る車をいちばん手前に置く。建物の模型の真ん中ではなく、縁から走り出して縁で止まる。
  // 建物も車も画面の上の大きさ（px）で描くので、詰める道のり（m）は、いまの拡大の度合いと、両端の建物の大きさで決める
  const zoom = camera.zoom
  const motion = useMemo(() => {
    if (!tour) return null
    const middle = tour.leg.points[0]
    const metersPerPixel = middle ? (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((middle.lat * Math.PI) / 180)) / 2 ** zoom : 0
    const built = pins.flatMap((pin) => {
      const size = layout.sizes[pin.id]
      return size === undefined ? [] : [{ location: pin.location, size }]
    })
    const endSize = Math.max(layout.baseSize, legEndSize(tour.leg, built, metersPerPixel) ?? 0)
    return tourMotion(tour.leg, tour.progress, (endSize * BUILDING_REACH + CAR_SIZE * CAR_REACH) * metersPerPixel)
  }, [tour, zoom, layout, pins])
  const car = motion?.place ?? null
  // 空港を経由する飛行機の区間は、ページが空港で区切って渡す（空港の前後は、それぞれ地上の乗り物の区間）
  const vehicle = tour?.vehicle ?? 'car'
  // 区間を進んでいる途中か（着いて止まっているときは、区間の端の 0 か 1）。歩く人は、このあいだだけ足を動かす
  const moving = Boolean(tour && !tour.hold && tour.progress > 0 && tour.progress < 1)
  // 飛行機は、飛ぶところの途中で浮かせて飛ぶ（真ん中でいちばん高く、両端で地面に下りる）。
  // 空港を経由する区間は空の移動の中だけ、ほかは区間の全部（どちらも motion.flown）
  const lift = vehicle === 'plane' && motion ? Math.round(Math.sin(Math.PI * motion.flown) * CAR_SIZE * PLANE_LIFT) : 0
  const markersWithCar = useMemo<SurfaceMarker[]>(
    () =>
      car
        ? [...markersWithOrigin, { id: 'tour-car', lat: car.point.lat, lng: car.point.lng, zIndex: 1100, node: <MapVehicle vehicle={vehicle} heading={car.heading} size={CAR_SIZE} moving={moving} lift={lift} /> }]
        : markersWithOrigin,
    [markersWithOrigin, car, vehicle, moving, lift],
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
            size: layout.sizes[pin.id] ?? layout.baseSize,
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

  // ピンがまだないあいだは、下のシートの高さが変わっても、旅の地方の全体（絞っていなければ日本全体）が見える所に収め直す（S02）
  const noPins = pins.length === 0
  // ただし、しおりで集合場所を見ているとき（建物がなくても場所の focus がある）は、そちらに任せる（日本全体へ跳ばない）
  const showJapan = useEffectEvent(() => {
    if (!spotFocus) camera.showBounds(regionsBounds(tripRegions) ?? JAPAN, { ...padding, top: topInset + 16, bottom: bottomInset + 16 })
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
  // 終わったら傾きを 0 に戻す（そのあと、呼ぶ側の focus で全体へ戻る）。
  // 一時停止（tour.hold）のあいだは追わず、傾きを戻しながら focus の場所へ寄り、寄り終えたら地図を手放す（そのあとは keepSpot が見る）
  const latestTour = useRef(tour && car ? { ...tour, car } : null)
  useEffect(() => {
    latestTour.current = tour && car ? { ...tour, car } : null
  })
  const touring = tour !== null
  const { currentZoom, currentSize, follow } = camera
  const tourPadding = useEffectEvent(() => padding)
  // 一時停止で寄る先（場所と、showFocused が決めた寄り具合）。場所の focus がまだ届いていなければ null
  const holdGoal = useEffectEvent(() => {
    const shown = spotShown.current
    if (!spotFocus || !shown || shown.key !== spotFocus.key) return null
    return { point: spotFocus.spot, zoom: shown.zoom, moved: shown.moved }
  })
  // 寄っている途中で再生が捨てられた（ほかの場所やしおりへ移った）とき、いまの focus へ寄せ直す
  const refocus = useEffectEvent(() => showFocused())
  // 一時停止した：前に人が地図を動かしていても、その場所へ寄せ直す
  const beginHold = useEffectEvent(() => {
    if (spotShown.current) spotShown.current.moved = false
  })
  useEffect(() => {
    if (!touring || !cameraReady) return
    // mode：follow は車を追う、settling は一時停止した場所へ寄っている途中、released は寄り終えて地図を手放した
    const shown = {
      zoom: currentZoom() ?? TOUR_STOP_ZOOM,
      tilt: 0,
      target: TOUR_STOP_ZOOM,
      point: null as LatLng | null,
      bottom: tourPadding().bottom,
      mode: 'follow' as 'follow' | 'settling' | 'released',
      catchUp: 1,
    }
    const frame = { id: 0 }
    const settle = (target: Padding) => {
      const goal = holdGoal()
      if (goal?.moved || !shown.point) {
        // 人が地図を動かした：取り合わずに手放す
        shown.mode = 'released'
        return
      }
      shown.bottom += (target.bottom - shown.bottom) * TOUR_SETTLE_EASE
      shown.tilt += (0 - shown.tilt) * TOUR_SETTLE_EASE
      let near = true
      if (goal) {
        shown.zoom += (goal.zoom - shown.zoom) * TOUR_SETTLE_EASE
        shown.point = {
          lat: shown.point.lat + (goal.point.lat - shown.point.lat) * TOUR_SETTLE_EASE,
          lng: shown.point.lng + (goal.point.lng - shown.point.lng) * TOUR_SETTLE_EASE,
        }
        // 画面の上で 0.5px より近く、寄り具合もほぼ同じなら、着いたことにする
        const gapPx = (Math.hypot(goal.point.lat - shown.point.lat, goal.point.lng - shown.point.lng) * 256 * 2 ** shown.zoom) / 360
        near = gapPx < 0.5 && Math.abs(goal.zoom - shown.zoom) < 0.01
      }
      if (near && shown.tilt < 0.3) {
        if (goal) shown.point = goal.point
        shown.zoom = goal?.zoom ?? shown.zoom
        shown.tilt = 0
        shown.bottom = target.bottom
        shown.mode = 'released'
      }
      follow(shown.point, shown.zoom, { ...target, bottom: shown.bottom }, shown.tilt)
    }
    const step = () => {
      const now = latestTour.current
      if (now?.hold) {
        if (shown.mode === 'follow') {
          shown.mode = 'settling'
          beginHold()
        }
        if (shown.mode === 'settling') settle(tourPadding())
      } else if (now) {
        if (shown.mode !== 'follow') {
          // 続きから再生した：いまの見え方から、車へ追いつく。人が地図を動かしていたら（どこを見ているか分からないので）すぐ車へ
          const moved = holdGoal()?.moved ?? false
          shown.zoom = currentZoom() ?? shown.zoom
          shown.catchUp = shown.point && !moved ? TOUR_CATCH_START : 1
          shown.mode = 'follow'
        }
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
        const from = shown.point
        shown.point =
          from && shown.catchUp < 1
            ? { lat: from.lat + (now.car.point.lat - from.lat) * shown.catchUp, lng: from.lng + (now.car.point.lng - from.lng) * shown.catchUp }
            : now.car.point
        shown.catchUp = Math.min(1, shown.catchUp * 1.06 + 0.002)
        follow(shown.point, shown.zoom, edge, shown.tilt)
      }
      frame.id = requestAnimationFrame(step)
    }
    frame.id = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(frame.id)
      // 手放したあとは、動かさない（人が動かした地図や、場所へ寄せた地図を、古い位置へ戻さない）
      if (!shown.point || shown.mode === 'released') return
      follow(shown.point, shown.zoom, tourPadding(), 0)
      // 一時停止した場所へ寄っている途中だった：上の follow が、移った先への動き（showFocused）を取り消すので、寄せ直す
      if (shown.mode === 'settling') refocus()
    }
  }, [touring, cameraReady, currentZoom, currentSize, follow])

  const surfaceLines = useMemo<SurfaceLine[]>(
    () => lines.filter((line) => line.points.length >= 2).map((line) => ({ id: line.id, points: line.points, dashed: Boolean(line.dashed) })),
    [lines],
  )

  // 旅の大まかな場所の塗り：外を灰色で覆い、中を緑の縁で囲む（案A）。県ごとに塗れるときは、選んだ県だけが中
  const areas = useMemo<SurfaceArea[] | undefined>(() => {
    const picked = pickedKey ? pickedKey.split(',') : []
    if (picked.length === 0 || picked.length === ALL_PREFECTURES.length) return undefined
    return REGION_IDS.map((id) => ({
      id,
      rings: regionRings(id),
      look: REGION_PREFECTURES[id].some((name) => picked.includes(name)) ? 'inside-line' : 'outside',
      places: regionPrefecturePlaces(id)?.map(({ prefecture, placeId }) => ({
        placeId,
        look: picked.includes(prefecture) ? 'inside-line' : 'outside',
      })),
    }))
  }, [pickedKey])

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
    onDrawsBuildings: setSurfaceDrawsBuildings,
    areas,
    areaOutline: camera.zoom < AREA_OUTLINE_MAX_ZOOM,
    minZoom,
  }
  // 地図なしの表示に切り替えるのは開発のときだけ。本番で読み込めないときは、地図を出さずに文だけ出す
  const plain = config.mode === 'plain' || (failed && config.plainAllowed)
  const unavailable = config.mode === 'unavailable' || (failed && !config.plainAllowed)
  const style = { '--map-bottom-inset': `${bottomInset}px` } as CSSProperties
  if (unavailable) {
    return (
      <div className={styles.map} style={style}>
        <p className={styles.unavailable} role="status">
          {translate('地図を読み込めませんでした。電波のよいところで開き直してください', "Couldn't load the map. Check your connection and try again.")}
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
            aria-label={translate('地図を拡大する', "Zoom in")}
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
            aria-label={translate('地図を縮小する', "Zoom out")}
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
            ? translate('地図を読み込めなかったので、地図なしで表示しています', "The map failed to load. Showing the scene without it.")
            : config.reason === 'off'
              ? translate('地図なしで表示中（?map=on で地図を出す）', 'Map hidden. Add ?map=on to show it.')
              : translate('地図のキーがないので、地図なしで表示しています', "No map key is available. Showing the scene without the map.")}
        </p>
      )}
    </div>
  )
}
