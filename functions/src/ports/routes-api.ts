// Google の Routes API で、移動時間を聞く口の型（ポート）。実体は adapters/routes-api.ts。
// Maps 由来の内容なので、3D 生成の入力（features/build-model）には渡さない（maps/no-generation-input）。
import type { LatLng } from '../domain/pin'

/** 区間ごとの移動時間（秒）と道の形（緯度経度の並び）。どちらも取れなかった区間は null */
export interface RouteLegs {
  seconds: (number | null)[]
  paths: (LatLng[] | null)[]
}

export interface RoutesApiPort {
  /** 呼べる設定か（キーがあり、Emulator ではない）。false なら legs は呼ばない */
  enabled(): boolean
  /** 開発環境（Emulator）か。true なら Routes を呼ばず、見本の線を返す（見た目を確かめるため） */
  sampleMode(): boolean
  /**
   * 点を順にたどったときの、区間ごとの移動時間（秒）と道の形。返す長さはどちらも points.length - 1。
   * 道がない区間は null。呼べなかった（失敗、上限）ときは全体が null。道の形は画面に出すだけで、保存しない
   */
  legs(points: readonly LatLng[]): Promise<RouteLegs | null>
}
