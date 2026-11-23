import { useEffect, useState } from 'react'
import { type ModelJson, renderModelSprite } from '@/entities/model3d'

/**
 * ようこその 1 枚の後ろに流す模型。地図に実際に建つ模型（functions の build-model/logic/prebuilt.ts。Gemini で作って検証した見本の模型）から、
 * 名所らしい 16 個を 2026-11-23 に写した（善光寺、東京タワー、姫路城など。並べ替えや入れ替えは assets/welcome-models.json を直す。
 * 元の模型を直しても、こちらは変わらない）。チュートリアルを開いたときだけ読み込む（見終えた端末の最初の読み込みに入れない）
 */
const loadModels = () =>
  import('../assets/welcome-models.json').then((module) =>
    (module.default as { name: string; model: unknown }[]).map((entry) => entry.model as ModelJson),
  )

/**
 * 模型を 1 つずつ、斜め上から見た絵にする（renderModelSprite。1 回描いたら覚えている）。
 * 読み込んでから描くので、最初の 1 コマはアプリの名前だけで、模型はすぐあとに出る。WebGL が使えず描けないものは除く
 */
export function useWelcomeSprites(): string[] | null {
  const [sprites, setSprites] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadModels().then((models) => {
      if (!alive) return
      setSprites(models.map((model) => renderModelSprite(model, 0, false)).filter((src): src is string => src !== null))
    })
    return () => {
      alive = false
    }
  }, [])
  return sprites
}
