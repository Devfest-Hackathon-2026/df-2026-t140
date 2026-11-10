import { Group, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from 'three'
import {
  addLights,
  buildModelObject,
  buildOutlineObject,
  disposeModelObject,
  type ModelJson,
  SPRITE_UNITS_ACROSS,
} from '@/entities/model3d'
import { createRouteLinesLayer, type LatLngPoint, type RouteLinesStyle } from './routeLinesLayer'

// 本物の地図（ベクター地図）の上に、建物の模型を three.js で重ねる（Maps の WebGLOverlayView）。
// 模型は、共通の処理（entities/model3d の buildModelObject）が JSON から作った物体をそのまま描く。
// 地図と同じカメラで描くので、地図を動かしても、傾けても、回しても、その場所に建ったまま見える。

export interface OverlayBuilding {
  id: string
  lat: number
  lng: number
  model: ModelJson
  /** 選んでいる建物。オレンジの輪郭線を付ける */
  selected: boolean
  /** いま建ったばかり。青い輪郭線を付ける（選んでいるときはオレンジだけ） */
  celebrating: boolean
}

export interface BuildingsOverlay {
  /** 出す建物を入れ替える。前になかった建物は、ふくらむ動きで出す */
  setBuildings(buildings: readonly OverlayBuilding[]): void
  /** 模型を、画面の上で幅 sizePx の絵と同じ大きさに見せる */
  setSize(sizePx: number): void
  /** ルートの線を入れ替える。模型より先に描くので、模型が線の上に出る（lib/routeLinesLayer.ts） */
  setLines(lines: readonly (readonly LatLngPoint[])[], style: RouteLinesStyle): void
}

/** 拡大の度合い 0、赤道での、1px あたりの長さ（m） */
const METERS_PER_PIXEL_AT_ZOOM_0 = 156_543.03392
/**
 * 模型を見下ろす角度の下限（度。0 が真上から）。地図の傾きがこれより小さいときは、足りないぶんだけ模型を
 * 奥へ倒して、斜め上から見た形に見せる（真上からだと屋根しか見えないため）
 */
const MIN_VIEW_TILT = 58
/** 模型の向き。南東の角を手前（北を上にしたときの下）に向ける。地図なしの表示の絵と同じ見え方 */
const YAW = -Math.PI / 4
const POP_MS = 700
/** 大きさが変わったとき、新しい値に近づく速さ（ms の時定数。約 320ms でほぼ追いつく） */
const EASE_MS = 80
/** 1 コマの時間として数える上限（ms）。しばらく描いていなかったあとに、一気に飛ばないようにする */
const MAX_FRAME_MS = 34

const UP = new Vector3(0, 0, 1)
/** 模型は y が上。地図の座標（東が x、北が y、上が z）に合わせて起こす */
const STAND = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
const TURN = new Quaternion().setFromAxisAngle(UP, YAW)

/** 少し行きすぎてから戻る、ふくらむ動き */
function pop(progress: number): number {
  const t = Math.min(Math.max(progress, 0), 1) - 1
  return 1 + 2.2 * t * t * t + 1.2 * t * t
}

interface Placed {
  building: OverlayBuilding
  holder: Group
  /** 選んでいるときの輪郭線 */
  outline: Group
  /** 建ったばかりのときの輪郭線。太さは選んでいるときと同じで、色だけ違う */
  celebrateOutline: Group
  bornAt: number | null
}

/**
 * @param outlineColors 輪郭線の色。選んでいる建物（--color-build）と、建ったばかりの建物（--color-route）。
 *   呼ぶ側がトークンから読んで渡す。空ならその輪郭線を出さない
 */
export function createBuildingsOverlay(
  map: google.maps.Map,
  sizePx: number,
  outlineColors: { selected: string; celebrating: string },
): BuildingsOverlay {
  const overlay = new google.maps.WebGLOverlayView()
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  // 光は、模型と同じ向きに回す入れ物に入れる
  const lights = new Group()
  addLights(lights)
  scene.add(lights)

  const routeLines = createRouteLinesLayer()
  const placed = new Map<string, Placed>()
  let renderer: WebGLRenderer | null = null
  let size = sizePx
  // いま描いている大きさ。setSize で変わったとき、全部の建物でそろって新しい大きさへなめらかに近づける
  let shownSize = sizePx
  let lastDraw = performance.now()
  let started = false

  overlay.onContextRestored = ({ gl }) => {
    renderer = new WebGLRenderer({ canvas: gl.canvas, context: gl, ...gl.getContextAttributes() })
    // 地図が描いたものを消さない
    renderer.autoClear = false
  }

  overlay.onContextLost = () => {
    renderer?.dispose()
    renderer = null
  }

  overlay.onDraw = ({ transformer }) => {
    if (!renderer || (placed.size === 0 && !routeLines.hasLines())) return
    // ルートの線を先に描く。このあとに描く模型が、線の上に出る
    routeLines.draw(renderer, transformer)
    const zoom = map.getZoom() ?? 5
    const tilt = map.getTilt() ?? 0
    const heading = ((map.getHeading() ?? 0) * Math.PI) / 180

    // 地図の傾きが足りないぶん、模型を奥（画面の上のほう）へ倒す。倒す軸は、画面の横の向き
    const lean = (Math.max(MIN_VIEW_TILT - tilt, 0) * Math.PI) / 180
    const screenRight = new Vector3(Math.cos(heading), -Math.sin(heading), 0)
    const orientation = new Quaternion().setFromAxisAngle(screenRight, -lean).multiply(TURN).multiply(STAND)
    lights.quaternion.copy(orientation)

    const now = performance.now()
    let animating = false
    const ease = 1 - Math.exp(-Math.min(now - lastDraw, MAX_FRAME_MS) / EASE_MS)
    lastDraw = now
    shownSize += (size - shownSize) * ease
    if (Math.abs(size - shownSize) < 0.5) shownSize = size
    else animating = true
    for (const item of placed.values()) item.holder.visible = false
    for (const { building, holder, outline, celebrateOutline, bornAt } of placed.values()) {
      // 色のトークンを読めなかったとき（空）は、黒い線にせず輪郭線を出さない。選んでいるときはオレンジだけ
      outline.visible = building.selected && outlineColors.selected !== ''
      celebrateOutline.visible = !building.selected && building.celebrating && outlineColors.celebrating !== ''
      const metersPerPixel = (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((building.lat * Math.PI) / 180)) / 2 ** zoom
      const metersPerUnit = (shownSize / SPRITE_UNITS_ACROSS) * metersPerPixel
      const age = bornAt === null ? POP_MS : now - bornAt
      if (age < POP_MS) animating = true
      holder.scale.setScalar(metersPerUnit * pop(age / POP_MS))
      holder.quaternion.copy(orientation)

      // この建物の場所を原点にした座標（m）から、画面への変換を、地図からもらう
      camera.projectionMatrix.fromArray(transformer.fromLatLngAltitude({ lat: building.lat, lng: building.lng, altitude: 0 }))
      holder.visible = true
      renderer.render(scene, camera)
      holder.visible = false
    }
    // 地図の描画とぶつからないよう、three.js が覚えている WebGL の状態を捨てる
    renderer.resetState()
    if (animating) overlay.requestRedraw()
  }

  overlay.setMap(map)

  return {
    setBuildings(buildings) {
      const wanted = new Map(buildings.map((building) => [building.id, building]))
      for (const [id, item] of placed) {
        const next = wanted.get(id)
        if (next && next.model === item.building.model) {
          item.building = next
          continue
        }
        scene.remove(item.holder)
        disposeModelObject(item.holder)
        placed.delete(id)
      }
      for (const building of buildings) {
        if (placed.has(building.id)) continue
        const holder = new Group()
        const outline = buildOutlineObject(building.model, outlineColors.selected)
        const celebrateOutline = buildOutlineObject(building.model, outlineColors.celebrating)
        outline.visible = false
        celebrateOutline.visible = false
        holder.add(buildModelObject(building.model), outline, celebrateOutline)
        holder.visible = false
        scene.add(holder)
        // 最初に並べるぶんは動かさない。あとから建ったものだけ、ふくらませる
        placed.set(building.id, { building, holder, outline, celebrateOutline, bornAt: started ? performance.now() : null })
      }
      started = true
      overlay.requestRedraw()
    },
    setSize(sizePx) {
      size = sizePx
      overlay.requestRedraw()
    },
    setLines(lines, style) {
      routeLines.setLines(lines, style)
      overlay.requestRedraw()
    },
  }
}
