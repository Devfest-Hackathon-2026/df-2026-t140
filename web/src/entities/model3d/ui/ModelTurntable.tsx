import { useEffect, useRef, useState } from 'react'
import { Scene, WebGLRenderer } from 'three'
import { buildModelObject, disposeModelObject } from '../lib/buildModelObject'
import { fitTurntableCamera } from '../lib/fitTurntableCamera'
import { addLights } from '../lib/renderModelSprite'
import type { ModelJson } from '../model/types'
import { ModelSprite } from './ModelSprite'

/** 1 周にかける時間（ミリ秒） */
const TURN_MS = 9000
/** 描く間隔（ミリ秒）。30 コマ／秒 */
const FRAME_MS = 1000 / 30
/** WebGL が使えないときの、止まった絵の大きさ（px） */
const STILL_SIZE = 120

interface Props {
  model: ModelJson
  className?: string
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 模型を、斜め上から見ながら、ゆっくり回して見せる（建った建物の場所カードで使う）。
 * 親の枠いっぱいに広がり、枠の大きさが変わると描き直す。回しても枠からはみ出さない範囲で、いちばん大きく写す。
 * 動きを減らす設定のときは回さない。WebGL が使えないときは、止まった絵（ModelSprite）を出す。
 */
export function ModelTurntable({ model, className }: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    // canvas は描くたびに作り直す。後片付けで WebGL を手放した canvas は、もう使えないため
    // （開発中の StrictMode では、作って片付けてもう一度作る）
    const canvas = document.createElement('canvas')
    canvas.style.position = 'absolute'
    canvas.style.inset = '0'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    box.append(canvas)
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
    } catch {
      canvas.remove()
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, 0)

    const scene = new Scene()
    addLights(scene)
    const object = buildModelObject(model)
    scene.add(object)
    const { camera, fit } = fitTurntableCamera(object)

    let frame = 0
    const still = prefersReducedMotion()
    const start = performance.now()
    const draw = (now: number) => {
      object.rotation.y = still ? 0 : (((now - start) % TURN_MS) / TURN_MS) * Math.PI * 2
      renderer.render(scene, camera)
    }
    // ゆっくり回すだけなので、30 コマ／秒に間引く（スマホの電池と発熱を抑える）。タブが隠れている間は、ブラウザが止める
    let last = -Infinity
    const loop = (now: number) => {
      // 60Hz の画面で 1 コマおきになるよう、少しの揺れは許す
      if (now - last >= FRAME_MS - 4) {
        last = now
        draw(now)
      }
      frame = requestAnimationFrame(loop)
    }

    // 枠の大きさに合わせて、描く大きさと写す範囲を変える（取っ手で閉じると、枠が低くなる）
    const resize = () => {
      const width = box.clientWidth
      const height = box.clientHeight
      if (width <= 0 || height <= 0) return
      renderer.setSize(width, height, false)
      fit(width / height)
      if (still) draw(start)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(box)
    resize()
    if (!still) frame = requestAnimationFrame(loop)

    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      scene.remove(object)
      disposeModelObject(object)
      renderer.dispose()
      // 開いたり閉じたりを繰り返しても、WebGL の枠（ブラウザごとに数の上限がある）を溜めない
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [model])

  if (failed) return <ModelSprite model={model} size={STILL_SIZE} className={className} />
  return <div ref={boxRef} className={className} style={{ position: 'relative', width: '100%', height: '100%' }} aria-hidden="true" />
}
