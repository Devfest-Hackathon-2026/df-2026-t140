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
}

/** 地図の上に引く線（ルート）。自分たちで計算した順番を、場所から場所へまっすぐ結ぶ（道なりではない） */
export interface SurfaceLine {
  id: string
  points: { lat: number; lng: number }[]
  /** 点線で引く（まだ決まっていない案） */
  dashed: boolean
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
  /** 建物の模型と、画面の上での大きさ（px。絵にして置くときと同じ大きさ） */
  buildings: SurfaceBuilding[]
  buildingSize: number
  /**
   * 面が、建物を 3D で描けるかどうかを知らせる。true なら面が buildings を描く。
   * false なら（地図なしの表示、ベクターでない地図）、呼ぶ側が模型を絵にして印の中に置く
   */
  onDrawsBuildings: (draws: boolean) => void
}
