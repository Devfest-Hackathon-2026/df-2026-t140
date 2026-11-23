import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react'
import {
  ALL_PREFECTURES,
  type LatLng,
  REGION_IDS,
  type RegionId,
  regionPrefecturePlaces,
  regionRings,
} from '@/entities/trip'
import { translate, playSound } from '@/shared/lib'
import { readMapConfig } from '../lib/mapMode'
import { type MapView, type Padding, type Size, viewForBounds } from '../lib/mercator'
import { clusterTargets, placeLabels, pickedTargets } from '../lib/pickedTargets'
import { DIVE_MS, tripStartView } from '../lib/regionBounds'
import type { SurfaceArea, SurfaceHandle, SurfaceMarker } from '../model/surface'
import { GoogleSurface } from './GoogleSurface'
import { OriginHouse } from './OriginHouse'
import { PlainSurface } from './PlainSurface'
import styles from './RegionMap.module.css'

interface Props {
  /** 県が 1 つでも選ばれている地方。自前の地方の形で塗るとき（県境の層が使えないとき）に使う */
  selected: readonly RegionId[]
  /** 選んでいる県。Google の県境で塗るときは、県ごとに塗る */
  pickedPrefectures: readonly string[]
  /** 上の帯と、下のシートの高さ（px）。日本全体がこの間に入るように映す */
  topInset: number
  bottomInset: number
  /** 「ここへ出発！」を押したあと。旅の地図の最初の見え方へ向かって、画面いっぱいに寄っていく */
  dive?: boolean
  /** 出発地（名前と、名前から引いたおよその位置）。位置があれば家を立てる */
  origin?: { name: string; location: LatLng | null }
  /** サイコロをふっているあいだ、光らせる地方。そのあいだは日本全体のまま動かさない */
  rolling?: RegionId | null
}

/** 左右の余白（px） */
const SIDE_PADDING = 16
/** 映す範囲。沖縄まで入るように、旅の地図の日本全体（lib/mercator.ts の JAPAN）より南と西へ広げる */
const REGION_BOUNDS = { north: 45.6, south: 25.9, east: 146.0, west: 127.4 }

/**
 * 地図を傾ける角度（度）。この画面では、選ぶ前も選んだあとも、いつもこの角度にそろえる（出発の家の模型が立って見えるように）。
 * Google の地図は、この画面の縮尺（4〜8）では 30° までしか傾かないので、30° にする
 */
const PICK_TILT = 30
const FLY_MS = 650
/** 選んだ場所へ、いったん引いてから飛び込むときにかける時間（ms） */
const SWOOP_MS = 950

/** 寄せる範囲に入れる、出発地の家のまわりの幅（度） */
const HOME_MARGIN = 0.4
/** 家を入れると、これ（拡大の度合い）より引くことになるなら、家を入れない。行き先に寄ることを先にする */
const HOME_ZOOM_COST = 0.5
/** 地方の名札を、出発地の家からこれ（度）より離して立てる。近い地方の名札が家に重ならないように */
const LABEL_AWAY = 1.5
/** 家と名札の大きさ（px）。この中に重なる地図の地名を隠す */
const HOUSE_AREA = { width: 64, height: 66 }
const LABEL_AREA = { width: 72, height: 32 }

// 名札を立てる所。ふつうは行き先（地方のまん中か県）。出発地の家に近すぎるときは、家から行き先の向きへ離す。
// 行き先が家より南のとき（関東のように、島まで含めると地方のまん中が家の南に来る）は、名札が家の名前にかぶるので真上（北）へ離す
function labelPoint(center: LatLng, home: LatLng | null): LatLng {
  if (!home) return center
  const squeeze = Math.cos((36 * Math.PI) / 180)
  const [dx, dy] = [(center.lng - home.lng) * squeeze, center.lat - home.lat]
  const away = Math.hypot(dx, dy)
  if (away >= LABEL_AWAY) return center
  const [ux, uy] = dy > 0.1 ? [dx / away, dy / away] : [0, 1]
  return { lat: home.lat + uy * LABEL_AWAY, lng: home.lng + (ux * LABEL_AWAY) / squeeze }
}

const NO_BUILDINGS: never[] = []
const NO_LINES: never[] = []
const NO_TARGETS: never[] = []

const ignore = () => {}

/**
 * 旅をつくる画面（S01）の、見るだけの地図（#373。案3）。最初の問いから最後の「どこに行く？」まで、この地図 1 つを使い続ける。
 * 日本全体を映し、出発地に家を立て、大まかな場所（地方と県）を選ぶと選んだ県を緑に塗る。
 * 選ぶのは下の一覧と検索で行うので、地図に札は置かず、押しても選ばない。
 * 選ぶと、選んだ地方が全部入る所へ寄って少し傾く（選んだ先が見えて、地図が応えるように。案G）。すべて選んだときと、選んでいないときは日本全体。
 *
 * 地図は旅の画面と同じ Google Maps を使い回す（ui/GoogleSurface.tsx。ページを開いてから 1 つだけ作るので、
 * 作ったあとで旅の画面に移っても、地図の読み込みは増えない）。自作の日本地図にしないのは、
 * Maps Platform 規約 3.2.3(e) の心配をなくすため（企画書「ユーザー体験」1）。
 * 本番で地図を読み込めないときは、地図を出さない（一覧だけで選べる）。
 */
export function RegionMap({ selected, pickedPrefectures, topInset, bottomInset, dive = false, origin, rolling = null }: Props) {
  const config = useMemo(() => readMapConfig(), [])
  const [failed, setFailed] = useState(false)
  const surface = useRef<SurfaceHandle>(null)
  const frame = useRef<HTMLDivElement>(null)

  const padding = useMemo<Padding>(
    () => ({ top: topInset + 12, right: SIDE_PADDING, bottom: bottomInset + 12, left: SIDE_PADDING }),
    [topInset, bottomInset],
  )
  const [initialView] = useState(() =>
    viewForBounds(REGION_BOUNDS, { width: Math.min(window.innerWidth, 480), height: window.innerHeight }, padding),
  )
  // 選んでいる中身で覚える（呼ぶ側が描き直すたびに新しい配列を渡しても、塗りを作り直さない）
  const selectedKey = selected.join(',')
  const pickedKey = pickedPrefectures.join(',')
  const whole = pickedPrefectures.length === ALL_PREFECTURES.length
  // 出発地の位置は、中身の文字列で覚える（呼ぶ側が描き直すたびに新しい値を渡しても、印を作り直さない）
  const homeKey = origin?.location ? `${origin.location.lat},${origin.location.lng}` : ''
  const home = useMemo<LatLng | null>(() => {
    if (!homeKey) return null
    const [lat, lng] = homeKey.split(',').map(Number)
    return { lat, lng }
  }, [homeKey])
  // 行き先：地方をまるごと選んだら地方、県だけを選んだらその県（lib/pickedTargets.ts）
  const targets = useMemo(() => pickedTargets(pickedKey ? pickedKey.split(',') : []), [pickedKey])
  // 寄せる範囲：選んだ行き先の全部と、出発地の家。何も選んでいない・すべて選んだときは null（日本全体）。
  // 家まで入れると引きすぎるとき（東京から北海道など）は、家を入れずに行き先へ寄る
  const fitBounds = useMemo(() => {
    if (whole || targets.length === 0) return null
    const places = targets.flatMap((target) => [
      { lat: target.bounds.north, lng: target.bounds.east },
      { lat: target.bounds.south, lng: target.bounds.west },
    ])
    const around = (points: LatLng[]) => ({
      north: Math.max(...points.map((point) => point.lat)),
      south: Math.min(...points.map((point) => point.lat)),
      east: Math.max(...points.map((point) => point.lng)),
      west: Math.min(...points.map((point) => point.lng)),
    })
    const only = around(places)
    if (!home) return only
    const withHome = around([
      ...places,
      { lat: home.lat + HOME_MARGIN, lng: home.lng + HOME_MARGIN },
      { lat: home.lat - HOME_MARGIN, lng: home.lng - HOME_MARGIN },
    ])
    const size = { width: Math.min(window.innerWidth, 480), height: window.innerHeight }
    const cost = viewForBounds(only, size, padding).zoom - viewForBounds(withHome, size, padding).zoom
    return cost <= HOME_ZOOM_COST ? withHome : only
  }, [whole, targets, home, padding])
  // 選び足したかどうか。選び足したら、選んだ場所の全部へ、いったん引いてから飛び込む（外したときは、ふつうに動く）。
  // 前の行き先と比べて決める（描くときに前の値を覚えておく、React の「前の描画の値を覚える」やり方）
  const [seen, setSeen] = useState(targets)
  const [added, setAdded] = useState(false)
  if (targets !== seen) {
    setSeen(targets)
    setAdded(targets.some((target) => !seen.some((before) => before.id === target.id)))
  }
  // カメラが向かう範囲：選んだ場所の全部と家
  const cameraBounds = fitBounds
  // 地図が止まったときの、ほんとうの見え方と画面の大きさ。名札の置き場所は、これで決め直す
  // （動いている途中や、まだ止まっていないときは、寄せ先の見え方から見積もる）
  const [live, setLive] = useState<{ view: MapView; size: Size; key: string } | null>(null)
  const onView = (view: MapView, _bounds: unknown, size: Size) => setLive({ view, size, key: pickedKey })
  // 重なる名札をまとめ、重ならない所へ置く
  const labeled = useMemo(() => {
    if (!cameraBounds) return { targets, offsets: new Map<string, { dx: number; dy: number; beside?: boolean }>(), placed: false }
    const settled = live && live.key === pickedKey ? live : null
    const zoom = settled
      ? settled.view.zoom
      : viewForBounds(cameraBounds, { width: Math.min(window.innerWidth, 480), height: window.innerHeight }, padding).zoom
    const place = (point: LatLng) => labelPoint(point, home)
    const grouped = clusterTargets(targets, zoom, place)
    const screen = settled
      ? { view: settled.view, size: settled.size, top: padding.top, bottom: padding.bottom, tilt: PICK_TILT }
      : undefined
    return { targets: grouped, offsets: placeLabels(grouped, zoom, place, home, screen), placed: true }
  }, [targets, cameraBounds, padding, home, live, pickedKey])
  // 選んだ行き先が、上の帯と下のシートの間に全部入るように寄る。選び直したとき、帯やシートの高さが変わったときに動かし直す。
  // サイコロをふっているあいだは、日本全体のまま光だけを動かす（地図ごと飛び回ると目が回る）
  const still = rolling !== null
  useEffect(() => {
    const element = frame.current
    if (!element || element.clientWidth === 0) return
    const size = { width: element.clientWidth, height: element.clientHeight }
    const ids = whole || !selectedKey ? [] : (selectedKey.split(',') as RegionId[])
    if (dive) {
      surface.current?.fly(tripStartView(ids, size), 0, DIVE_MS)
      return
    }
    if (still) return
    // 選び足したときは、いったん引いてから、選んだ場所の全部が入る所へぎゅいーんと飛び込む
    const view = viewForBounds(cameraBounds ?? REGION_BOUNDS, size, padding)
    if (added && cameraBounds) surface.current?.fly(view, PICK_TILT, SWOOP_MS, { swoop: true })
    else surface.current?.fly(view, PICK_TILT, FLY_MS)
  }, [padding, selectedKey, whole, dive, still, cameraBounds, added])

  const areas = useMemo<SurfaceArea[]>(
    () =>
      REGION_IDS.map((id) => ({
        id,
        rings: regionRings(id),
        look: selectedKey.split(',').includes(id) || rolling === id ? 'picked' : 'unpicked',
        places: regionPrefecturePlaces(id)?.map(({ prefecture, placeId }) => ({
          placeId,
          look: pickedKey.split(',').includes(prefecture) || rolling === id ? 'picked' : 'unpicked',
        })),
      })),
    [selectedKey, pickedKey, rolling],
  )

  // 行き先の名札。サイコロをふっているあいだと、出発したあとは出さない
  const shown = still || dive || whole ? NO_TARGETS : labeled.targets
  const originName = origin?.name ?? ''
  const markers = useMemo<SurfaceMarker[]>(() => {
    const labels: SurfaceMarker[] = shown.flatMap((target) => {
      // 置き場所が決まっていない名札（見積もりの前）は真上に、重なって置けなかった名札は出さない
      const offset = labeled.offsets.size > 0 || labeled.placed ? labeled.offsets.get(target.id) : { dx: 0, dy: 0 }
      if (!offset) return []
      const { dx, dy } = offset
      const beside = offset.beside === true
      return [
        {
          id: `target-${target.id}`,
          ...labelPoint(target.point, home),
          zIndex: 2,
          hidesLabels: LABEL_AREA,
          // 点の横や下へずらした名札は、点を指す三角を出さない（名札の端が点に接する）
          node: (
            <span
              className={beside ? `${styles.label} ${styles.labelBeside}` : styles.label}
              style={{ '--label-dx': `${dx}px`, '--label-dy': `${dy}px` } as CSSProperties}
            >
              <span className={styles.labelText}>{target.name}</span>
            </span>
          ),
        },
      ]
    })
    if (!home || dive) return labels
    return [...labels, { id: 'origin-house', ...home, zIndex: 3, hidesLabels: HOUSE_AREA, node: <OriginHouse name={originName} /> }]
  }, [home, originName, dive, shown, labeled])

  const plain = config.mode === 'plain' || (failed && config.plainAllowed)
  const unavailable = config.mode === 'unavailable' || (failed && !config.plainAllowed)
  const style = { '--map-bottom-inset': `${bottomInset}px` } as CSSProperties
  if (unavailable) return <div ref={frame} className={styles.map} style={style} />

  const surfaceProps = {
    ref: surface,
    initialView,
    markers,
    lines: NO_LINES,
    areas,
    onView,
    onBackgroundClick: ignore,
    bottomInset,
    buildings: NO_BUILDINGS,
    onDrawsBuildings: ignore,
  }
  return (
    <div ref={frame} className={styles.map} style={style} data-region-map>
      {plain ? (
        <PlainSurface {...surfaceProps} />
      ) : (
        <GoogleSurface
          {...surfaceProps}
          config={config}
          onFailed={() => {
            playSound('error', { key: 'map-load-error', channel: 'notification' })
            setFailed(true)
          }}
        />
      )}
      {plain && <p className={styles.note}>{translate('地図なしで表示中（開発のときだけ）', "Map hidden in development.")}</p>}
    </div>
  )
}
