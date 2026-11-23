import { type BufferAttribute, type Mesh, type Object3D, OrthographicCamera, Vector3 } from 'three'
import { TURNTABLE_FRAME } from './renderModelSprite'
import { fitFrame, turntableFrame } from './turntableFrame'

/**
 * 模型を y の軸のまわりに回しても、絵からはみ出さない、いちばん寄ったカメラ（斜め上から見下ろす、平行投影）。
 * 範囲の計算は turntableFrame。頂点が無ければ、止まった絵と同じ範囲を写す。絵の縦横の比が変わったら fit で合わせ直す。
 */
export function fitTurntableCamera(object: Object3D): { camera: OrthographicCamera; fit: (aspect: number) => void } {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  camera.position.set(40, 33, 40)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  const toViewMatrix = camera.matrixWorldInverse

  object.updateMatrixWorld(true)
  const points: [number, number, number][] = []
  const point = new Vector3()
  object.traverse((child) => {
    const position = (child as Mesh).geometry?.getAttribute?.('position') as BufferAttribute | undefined
    if (!(child as Mesh).isMesh || !position) return
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(child.matrixWorld)
      points.push([point.x, point.y, point.z])
    }
  })

  const view = new Vector3()
  const frame = turntableFrame(
    points,
    (x, y, z) => {
      view.set(x, y, z).applyMatrix4(toViewMatrix)
      return [view.x, view.y]
    },
    {
      halfWidth: TURNTABLE_FRAME.halfWidth,
      halfHeight: (TURNTABLE_FRAME.top - TURNTABLE_FRAME.bottom) / 2,
      middle: (TURNTABLE_FRAME.top + TURNTABLE_FRAME.bottom) / 2,
    },
  )

  const fit = (aspect: number) => {
    Object.assign(camera, fitFrame(frame, aspect))
    camera.updateProjectionMatrix()
  }
  fit(1)
  return { camera, fit }
}
