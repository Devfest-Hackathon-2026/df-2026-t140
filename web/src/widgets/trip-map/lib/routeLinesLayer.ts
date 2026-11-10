import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, type WebGLRenderer } from 'three'

// 本物の地図（ベクター地図）で、ルートの線を、建物の模型と同じ WebGL の層に描く（lib/buildingsOverlay.ts から呼ぶ）。
// google.maps.Polyline は WebGL の層より上に出て、模型にかぶってしまう。この層で模型より先に描けば、模型が線の上に出る。
//
// 線は、場所の緯度経度を毎回、地図のカメラで画面の位置に直し、画面の上で決まった太さの帯として描く
// （白いふちの上に、ルートの色）。地面の上の直線は、傾けても画面の上で直線になるので、端の点だけを変換すればよい。
// 前の google.maps.Polyline は大圏（geodesic）の線だったが、ここでは地図の平面の上の直線にする。旅の中の距離なら違いは見えない。
// 線は場所から場所へまっすぐ結ぶ（道なりではない。Routes API は使わない）。

export interface LatLngPoint {
  lat: number
  lng: number
}

export interface RouteLinesStyle {
  /** 線の色（CSS の色） */
  color: string
  /** ふちの色 */
  edge: string
}

/** 線とふちの太さ（CSS の px）。google.maps.Polyline で引いていたときと同じ */
const LINE_PX = 6
const EDGE_PX = 10
/** つなぎ目と端を丸くする円の、辺の数 */
const ROUND_SEGMENTS = 16

type Transformer = google.maps.CoordinateTransformer

interface Point2 {
  x: number
  y: number
}

export interface RouteLinesLayer {
  /** 引く線を入れ替える。線ごとに、通る点の並び */
  setLines(lines: readonly (readonly LatLngPoint[])[], style: RouteLinesStyle): void
  hasLines(): boolean
  /** 地図の 1 回の描画の中で、模型より先に呼ぶ */
  draw(renderer: WebGLRenderer, transformer: Transformer): void
}

interface Clip {
  x: number
  y: number
  w: number
}

/** カメラのすぐ前とみなす w。これより手前（カメラの後ろ）に延びる区間は、ここで切る */
const NEAR_W = 1e-6

/** 緯度経度を、地図のカメラの同次座標（クリップ座標の x、y、w）にする */
function toClip(transformer: Transformer, point: LatLngPoint): Clip {
  const m = transformer.fromLatLngAltitude({ lat: point.lat, lng: point.lng, altitude: 0 })
  // 列優先の行列に (0, 0, 0, 1) を掛けると、4 列目がそのまま同次座標になる
  return { x: m[12], y: m[13], w: m[15] }
}

/** クリップ座標を、画面の位置（px。真ん中が原点、上が +y）にする */
function toScreen(clip: Clip, width: number, height: number): Point2 {
  return { x: ((clip.x / clip.w) * width) / 2, y: ((clip.y / clip.w) * height) / 2 }
}

/**
 * 区間 a→b のうち、カメラの前にある部分。両方とも後ろなら null。
 * 片方だけが後ろなら、同次座標のまま w が NEAR_W になる所で切る（割ったあとで切ると、位置がずれる）
 */
function visiblePart(a: Clip, b: Clip): [Clip, Clip] | null {
  const aFront = a.w > NEAR_W
  const bFront = b.w > NEAR_W
  if (aFront && bFront) return [a, b]
  if (!aFront && !bFront) return null
  const t = (NEAR_W - a.w) / (b.w - a.w)
  const cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: NEAR_W }
  return aFront ? [a, cut] : [cut, b]
}

/** 点の並びを、太さ half * 2 の帯（三角形の並び）にして positions に足す。つなぎ目と端は丸くする */
function addStroke(positions: number[], points: readonly Point2[], half: number): void {
  for (let index = 0; index + 1 < points.length; index += 1) {
    const a = points[index]
    const b = points[index + 1]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    if (length === 0) continue
    const nx = (-(b.y - a.y) / length) * half
    const ny = ((b.x - a.x) / length) * half
    positions.push(a.x + nx, a.y + ny, 0, a.x - nx, a.y - ny, 0, b.x + nx, b.y + ny, 0)
    positions.push(b.x + nx, b.y + ny, 0, a.x - nx, a.y - ny, 0, b.x - nx, b.y - ny, 0)
  }
  for (const point of points) {
    for (let step = 0; step < ROUND_SEGMENTS; step += 1) {
      const from = (step / ROUND_SEGMENTS) * Math.PI * 2
      const to = ((step + 1) / ROUND_SEGMENTS) * Math.PI * 2
      positions.push(point.x, point.y, 0)
      positions.push(point.x + Math.cos(from) * half, point.y + Math.sin(from) * half, 0)
      positions.push(point.x + Math.cos(to) * half, point.y + Math.sin(to) * half, 0)
    }
  }
}

export function createRouteLinesLayer(): RouteLinesLayer {
  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1)
  // 地図の奥行きに関係なく描く（模型はこのあとに描くので、模型が上に出る）
  const edgeMaterial = new MeshBasicMaterial({ depthTest: false, depthWrite: false })
  const lineMaterial = new MeshBasicMaterial({ depthTest: false, depthWrite: false })
  const edgeMesh = new Mesh(new BufferGeometry(), edgeMaterial)
  const lineMesh = new Mesh(new BufferGeometry(), lineMaterial)
  // ふちを先に、線をあとに描く
  edgeMesh.renderOrder = 0
  lineMesh.renderOrder = 1
  scene.add(edgeMesh, lineMesh)
  let lines: readonly (readonly LatLngPoint[])[] = []

  const setGeometry = (mesh: Mesh, positions: number[]) => {
    mesh.geometry.dispose()
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
    mesh.geometry = geometry
  }

  return {
    setLines(next, style) {
      lines = next.filter((line) => line.length >= 2)
      edgeMaterial.color = new Color(style.edge)
      lineMaterial.color = new Color(style.color)
    },
    hasLines() {
      return lines.length > 0
    },
    draw(renderer, transformer) {
      if (lines.length === 0) return
      const gl = renderer.getContext()
      const width = gl.drawingBufferWidth
      const height = gl.drawingBufferHeight
      const cssWidth = (gl.canvas as HTMLCanvasElement).clientWidth || width
      const pixelRatio = width / cssWidth
      camera.left = -width / 2
      camera.right = width / 2
      camera.top = height / 2
      camera.bottom = -height / 2
      camera.updateProjectionMatrix()

      const edges: number[] = []
      const strokes: number[] = []
      for (const line of lines) {
        const clips = line.map((point) => toClip(transformer, point))
        // カメラの前にある部分を、つながった点の並びにまとめてから描く
        let run: Point2[] = []
        const flush = () => {
          if (run.length >= 2) {
            addStroke(edges, run, (EDGE_PX / 2) * pixelRatio)
            addStroke(strokes, run, (LINE_PX / 2) * pixelRatio)
          }
          run = []
        }
        for (let index = 0; index + 1 < clips.length; index += 1) {
          const part = visiblePart(clips[index], clips[index + 1])
          if (!part) {
            flush()
            continue
          }
          const [from, to] = part
          // 区間の始まりが前の区間の終わりと同じ点でなければ（後ろから戻ってきた所）、並びを切り直す
          if (from !== clips[index]) flush()
          if (run.length === 0) run.push(toScreen(from, width, height))
          run.push(toScreen(to, width, height))
          // 区間の終わりを切ったなら、次の区間とはつながらない
          if (to !== clips[index + 1]) flush()
        }
        flush()
      }
      setGeometry(edgeMesh, edges)
      setGeometry(lineMesh, strokes)
      renderer.render(scene, camera)
    },
  }
}
