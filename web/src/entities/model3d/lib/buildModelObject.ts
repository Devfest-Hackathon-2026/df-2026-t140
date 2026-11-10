import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three'
import type { ModelJson, ModelShape } from '../model/types'

// 模型の JSON を three.js の物体にする、共通の処理。
// 本物の地図（WebGLOverlayView）でも、地図なしの表示（絵にして置く）でも、これ 1 つを使う。
// JSON に書けるのは、決まった形・大きさ・位置・回転・色だけ。AI が書いたコードは実行しない。

/** 三角の屋根。大きさ 1 の箱に入る三角柱で、棟（いちばん高い線）が x の向き */
function roofGeometry(): BufferGeometry {
  const a = [-0.5, -0.5, -0.5]
  const b = [0.5, -0.5, -0.5]
  const c = [0.5, -0.5, 0.5]
  const d = [-0.5, -0.5, 0.5]
  const e = [-0.5, 0.5, 0]
  const f = [0.5, 0.5, 0]
  // 手前の斜面、奥の斜面、左の三角、右の三角、底
  const triangles = [d, c, f, d, f, e, b, a, e, b, e, f, a, d, e, c, b, f, a, b, c, a, c, d]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(triangles.flat(), 3))
  geometry.computeVertexNormals()
  return geometry
}

// 形ごとの元になる形（大きさ 1）。全部の模型で使い回す
let geometries: Record<ModelShape, BufferGeometry> | undefined
function sharedGeometries(): Record<ModelShape, BufferGeometry> {
  geometries ??= {
    box: new BoxGeometry(1, 1, 1),
    cylinder: new CylinderGeometry(0.5, 0.5, 1, 20),
    cone: new ConeGeometry(0.5, 1, 20),
    // 底が、辺の長さ 1 の正方形になる四角すい
    pyramid: new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4),
    sphere: new SphereGeometry(0.5, 16, 12),
    roof: roofGeometry(),
  }
  return geometries
}

const DEGREES = Math.PI / 180

/** 輪郭線の色は模型（renderOrder 0）より先に、奥行きは模型のあとに描く（buildOutlineObject） */
const OUTLINE_COLOR_ORDER = -1
const OUTLINE_DEPTH_ORDER = 1

/** 模型の下に落とす、うすい影の大きさ（土台の板より少し大きい円） */
const SHADOW_SIZE = 13

/**
 * 模型の JSON から、three.js の物体（Group）を作る。原点は地面の真ん中、y が上。
 * 使い終わったら disposeModelObject で片付ける。
 */
export function buildModelObject(model: ModelJson): Group {
  const shapes = sharedGeometries()
  const group = new Group()
  const materials = new Map<string, Material>()

  const shadow = new Mesh(shapes.cylinder, new MeshBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.14, depthWrite: false }))
  shadow.scale.set(SHADOW_SIZE, 0.02, SHADOW_SIZE)
  shadow.position.set(0.6, 0.01, 0.6)
  group.add(shadow)

  for (const part of model.parts) {
    const opacity = part.opacity ?? 1
    const key = `${part.color}/${opacity}`
    let material = materials.get(key)
    if (!material) {
      material = new MeshLambertMaterial({ color: part.color, flatShading: true, transparent: opacity < 1, opacity })
      materials.set(key, material)
    }
    const mesh = new Mesh(shapes[part.shape], material)
    mesh.scale.set(part.size[0], part.size[1], part.size[2])
    mesh.position.set(part.position[0], part.position[1], part.position[2])
    if (part.rotation) {
      mesh.rotation.set(part.rotation[0] * DEGREES, part.rotation[1] * DEGREES, part.rotation[2] * DEGREES)
    }
    group.add(mesh)
  }
  return group
}

/**
 * 模型の輪郭線（選んでいる建物の印）。部品ごとに、少し大きくした同じ形の「裏側」だけを描く。
 * thickness は模型の単位（土台の幅が 10）。
 *
 * 部品どうしの継ぎ目には線を出さず、模型全体の外側の輪郭だけに出すため、2 回に分けて描く。
 * 1. 色：模型より先に、奥行きを書き込まずに塗る。あとから描く模型が自分の形の内側をすべて塗りつぶすので、
 *    模型全体の外へはみ出したぶんだけが縁取りに残る
 * 2. 奥行き：模型のあとに、色を塗らずに奥行きだけを書く。あとから描くほかの建物が、縁取りの上に出ないようにする
 * どちらも奥行きの比べは残すので、手前にある地図の建物や、先に描いた別の模型より前には出ない。
 */
export function buildOutlineObject(model: ModelJson, color: string, thickness = 0.28): Group {
  const shapes = sharedGeometries()
  const group = new Group()
  const colorPass = new MeshBasicMaterial({ color, side: BackSide, depthWrite: false })
  const depthPass = new MeshBasicMaterial({ side: BackSide, colorWrite: false })
  for (const part of model.parts) {
    for (const [material, renderOrder] of [
      [colorPass, OUTLINE_COLOR_ORDER],
      [depthPass, OUTLINE_DEPTH_ORDER],
    ] as const) {
      const mesh = new Mesh(shapes[part.shape], material)
      mesh.renderOrder = renderOrder
      mesh.scale.set(part.size[0] + thickness * 2, part.size[1] + thickness * 2, part.size[2] + thickness * 2)
      mesh.position.set(part.position[0], part.position[1], part.position[2])
      if (part.rotation) {
        mesh.rotation.set(part.rotation[0] * DEGREES, part.rotation[1] * DEGREES, part.rotation[2] * DEGREES)
      }
      group.add(mesh)
    }
  }
  return group
}

/** buildModelObject で作った物体の、色の情報（マテリアル）を片付ける。形は使い回すので片付けない */
export function disposeModelObject(group: Group): void {
  const done = new Set<Material>()
  group.traverse((child) => {
    const material = (child as Mesh).material as Material | undefined
    if (material && !done.has(material)) {
      material.dispose()
      done.add(material)
    }
  })
}
