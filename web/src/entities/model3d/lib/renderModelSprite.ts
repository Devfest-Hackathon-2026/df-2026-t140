import { AmbientLight, DirectionalLight, type Object3D, OrthographicCamera, Scene, WebGLRenderer } from 'three'
import type { ModelJson } from '../model/types'
import { buildModelObject, disposeModelObject } from './buildModelObject'

// 模型を、斜め上から見た 1 枚の絵にする。地図なしの表示と、場所カードで使う
// （本物の地図では、同じ buildModelObject の物体を WebGLOverlayView でそのまま描く）。

/** 絵に入れる範囲（模型の単位）。左右は ±9、下は -5、上は 13。模型の箱（幅 12、高さ 16）が斜めから入る */
const HALF_WIDTH = 9
const BOTTOM = -5
const TOP = 13

/** 絵の中で、模型の原点（地面の真ん中）がある位置（左上からの割合）。絵を置くときに、ここを場所に合わせる */
export const SPRITE_ORIGIN = { x: 0.5, y: TOP / (TOP - BOTTOM) }

/** 絵の幅に入る模型の単位の数。本物の地図で、絵と同じ大きさに見せるのに使う */
export const SPRITE_UNITS_ACROSS = HALF_WIDTH * 2

const PIXELS = 256

interface Studio {
  renderer: WebGLRenderer
  scene: Scene
  camera: OrthographicCamera
}

let studio: Studio | null | undefined

function openStudio(): Studio | null {
  if (studio !== undefined) return studio
  try {
    const canvas = document.createElement('canvas')
    canvas.width = PIXELS
    canvas.height = PIXELS
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(PIXELS, PIXELS, false)
    renderer.setClearColor(0x000000, 0)

    const scene = new Scene()
    addLights(scene)

    const camera = new OrthographicCamera(-HALF_WIDTH, HALF_WIDTH, TOP, BOTTOM, 0.1, 200)
    // 斜め上（南東の上）から見下ろす。見下ろす角度は 30 度ほど
    camera.position.set(40, 33, 40)
    camera.lookAt(0, 0, 0)
    studio = { renderer, scene, camera }
  } catch {
    // WebGL が使えない環境。絵は出せないので、呼ぶ側が代わりの印を出す
    studio = null
  }
  return studio
}

/** 模型に当てる光（模型と同じ向き：y が上）。本物の地図の上でも同じ光にする */
export function addLights(parent: Object3D): void {
  parent.add(new AmbientLight(0xffffff, 2.1))
  const sun = new DirectionalLight(0xffffff, 1.6)
  sun.position.set(6, 12, 9)
  parent.add(sun)
}

/** 模型 → 向き（度）ごとの絵 */
const cache = new WeakMap<ModelJson, Map<number, string | null>>()

/**
 * 模型の絵（PNG の data URL）。同じ模型・同じ向きは 1 回だけ描く。WebGL が使えなければ null。
 * yaw は、模型を上から見て反時計回りに回す角度（度。y の軸まわり）。しおりの再生で、車を走る向きに向けるのに使う
 */
export function renderModelSprite(model: ModelJson, yaw = 0): string | null {
  const byYaw = cache.get(model) ?? new Map<number, string | null>()
  cache.set(model, byYaw)
  const cached = byYaw.get(yaw)
  if (cached !== undefined) return cached

  const opened = openStudio()
  if (!opened) return null
  const object = buildModelObject(model)
  object.rotation.y = (yaw * Math.PI) / 180
  let url: string | null = null
  try {
    opened.scene.add(object)
    opened.renderer.render(opened.scene, opened.camera)
    url = opened.renderer.domElement.toDataURL('image/png')
  } catch {
    url = null
  } finally {
    opened.scene.remove(object)
    disposeModelObject(object)
  }
  byYaw.set(yaw, url)
  return url
}
