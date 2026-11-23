import type { ReactNode, Ref } from 'react'
import type { ModelJson } from '@/entities/model3d'
import type { MapBounds } from '@/entities/wish'
import type { MapView, Size } from '../lib/mercator'

// 地図の面（本物の Google Maps か、地図なしの表示）が満たす形。
// TripMap は、どちらの面でも同じ使い方をする。面を足すときは、この形に合わせる。

/** 地図の上に置く印。node は、その位置を指す大きさ 0 の点を基準に描く（ui/MapPin.module.css） */
export interface SurfaceMarker {
  id: string
  lat: number
  lng: number
  /** 大きいほど手前 */
  zIndex: number
  node: ReactNode
  /**
   * 印の大きさ（px）。渡すと、本物の地図では、この大きさの中に重なる地図の地名を隠す（家や名札が地名とかぶらないように）。
   * 印は大きさ 0 の点を基準に描くので、中身は left: 50% と bottom で置く（ui/OriginHouse.module.css）
   */
  hidesLabels?: { width: number; height: number }
}

/** 地図の上に建てる模型。面が 3D で描けるとき（本物のベクター地図）に使う */
export interface SurfaceBuilding {
  id: string
  lat: number
  lng: number
  model: ModelJson
  /** 選んでいる建物。オレンジの輪郭線を付ける */
  selected: boolean
  /** いま建ったばかり。青い輪郭線を付ける（選んでいるときはオレンジだけ） */
  celebrating: boolean
  /** 画面の上での大きさ（px。絵にして置くときと同じ大きさ）。拡大の度合いとまわりの混み具合で変わる */
  size: number
}

/** 地図の上に引く線（ルート）。自分たちで計算した順番を、場所から場所へまっすぐ結ぶ（道なりではない） */
export interface SurfaceLine {
  id: string
  points: { lat: number; lng: number }[]
  /** 点線で引く（まだ決まっていない案） */
  dashed: boolean
}

/**
 * 範囲の塗り方。
 * - picked / unpicked：旅をつくるときに地方を選ぶ地図の、選んだ地方と選んでいない地方
 * - outside：旅の地図で、旅の地方の外（灰色で覆う）
 * - inside-line：旅の地図で、旅の地方の中を緑の縁だけで囲む
 */
export type AreaLook = 'picked' | 'unpicked' | 'outside' | 'inside-line'

/**
 * 地図の上に塗る範囲（地方）。輪の一覧で、島が多い地方は輪が多い。
 * 形は自分たちで用意したもの（entities/trip の regionShapes。Natural Earth）で、Maps の内容ではない
 */
export interface SurfaceArea {
  id: string
  rings: { lat: number; lng: number }[][]
  look: AreaLook
  /**
   * その範囲の県ごとの Google の場所の ID と塗り方。地図の境界の層（Google の県境）が使えて、すべての範囲にこれがあれば、
   * rings の代わりに地図の県境で、県ごとに塗る（どれだけ寄ってもずれない。県で絞った旅は、選んだ県だけを塗れる）。
   * なければ rings と look で、範囲ごとに塗る
   */
  places?: { placeId: string; look: AreaLook }[]
}

/** 外から面を動かすための入口 */
export interface SurfaceHandle {
  /** 見え方を変える。animate は、近くなら滑らかに動かす */
  setView(view: MapView, animate?: boolean): void
  /**
   * 動いているものを追って、すぐにその見え方にする（しおりの再生で、1 コマごとに呼ぶ）。
   * tilt は地図を傾ける角度（度。0 が真上から）。傾けられない面は、傾けずに動かす
   */
  follow(view: MapView, tilt: number): void
  /**
   * いまの見え方から、その見え方と傾きへ、ms ミリ秒かけてなめらかに動かす（どれだけ離れていても動かす。地方を選ぶ地図で使う）。
   * 動いている途中で呼び直すと、そのときの見え方から続けて動く。傾けられない面は、傾けずに動かす。
   * swoop なら、途中でいったん引いてから寄る（離れた所へ、ぎゅいーんと飛び込むように）
   */
  fly(view: MapView, tilt: number, ms: number, options?: { swoop?: boolean }): void
}

export interface SurfaceProps {
  ref: Ref<SurfaceHandle>
  /** 最初の見え方 */
  initialView: MapView
  markers: SurfaceMarker[]
  /** 見え方が変わるたびに呼ぶ（動かし終わったとき） */
  onView: (view: MapView, bounds: MapBounds, size: Size) => void
  /**
   * 拡大の度合いが変わっている途中にも呼ぶ（指 2 本で縮めているあいだなど）。建物の大きさを決め直すのに使う。
   * onView しか呼ばない面（地図なしの表示。動かすたびに onView を呼ぶ）では渡さなくてよい
   */
  onZoom?: (zoom: number) => void
  /** 印のない所を押したとき */
  onBackgroundClick: () => void
  /** 人が指やマウスで地図を動かし始めたとき（プログラムで動かしたときは呼ばない） */
  onUserMove?: () => void
  /**
   * 人がホイールや指 2 本で拡大・縮小し始めたとき（プログラムで動かしたときは呼ばない）。onUserMove とは分ける
   * （動かしたときはしおりのシートを下げるが、拡大・縮小ではシートは動かさない）
   */
  onUserZoom?: () => void
  /** 下の操作欄やシートの高さ（px）。ロゴなどを、これより上に出す */
  bottomInset: number
  /** ルートの線。本物の地図は google.maps.Polyline、地図なしの表示は SVG で引く */
  lines: SurfaceLine[]
  /** 建物の模型と、画面の上での大きさ */
  buildings: SurfaceBuilding[]
  /**
   * 面が、建物を 3D で描けるかどうかを知らせる。true なら面が buildings を描く。
   * false なら（地図なしの表示、ベクターでない地図）、呼ぶ側が模型を絵にして印の中に置く
   */
  onDrawsBuildings: (draws: boolean) => void
  /** 塗る範囲。渡さなければ塗らない */
  areas?: SurfaceArea[]
  /**
   * 塗った範囲の縁を描くか。渡さなければ描く。街の中まで寄ったときに縁だけを消すのに使う
   * （Google の県境の海岸線は、地図の海岸線より粗く、そこまで寄ると数十 m ずれて見えるため）
   */
  areaOutline?: boolean
  /** 塗った範囲を押したとき。範囲の ID を渡す。渡さなければ、範囲は押せない（下の地図を押したことになる） */
  onAreaClick?: (id: string) => void
  /**
   * いちばん引けるところの拡大の度合い（旅の地図で、旅のエリアから決める。lib/mercator.ts の areaMinZoom）。
   * 渡さなければ MIN_ZOOM（日本全体まで引ける。旅をつくる画面の地図）
   */
  minZoom?: number
}
