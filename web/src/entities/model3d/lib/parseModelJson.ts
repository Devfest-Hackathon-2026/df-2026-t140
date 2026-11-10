import { MODEL_SHAPES, MODEL_VERSION, type ModelJson, type ModelPart, type ModelShape, type Vec3 } from '../model/types'

// 検査の上限。functions/src/domain/model3d.ts の MODEL_LIMITS と合わせる
const MAX_PARTS = 80
const MIN_SIZE = 0.05
const MAX_SIZE = 14
const MAX_OFFSET = 7
const MIN_Y = -1
const MAX_Y = 16
const MIN_OPACITY = 0.2

function vec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  if (!value.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  return [value[0], value[1], value[2]]
}

function parsePart(raw: unknown): ModelPart | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  if (!(MODEL_SHAPES as readonly unknown[]).includes(item.shape)) return null
  const size = vec3(item.size)
  const position = vec3(item.position)
  if (!size || !position) return null
  if (size.some((value) => value < MIN_SIZE || value > MAX_SIZE)) return null
  const [x, y, z] = position
  if (Math.abs(x) > MAX_OFFSET || Math.abs(z) > MAX_OFFSET || y < MIN_Y || y > MAX_Y) return null
  if (typeof item.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(item.color)) return null

  const part: ModelPart = { shape: item.shape as ModelShape, size, position, color: item.color }
  if (item.rotation !== undefined) {
    const rotation = vec3(item.rotation)
    if (!rotation || rotation.some((value) => Math.abs(value) > 360)) return null
    part.rotation = rotation
  }
  if (item.opacity !== undefined) {
    if (typeof item.opacity !== 'number' || !(item.opacity >= MIN_OPACITY && item.opacity <= 1)) return null
    part.opacity = item.opacity
  }
  return part
}

/**
 * 保存されていた模型の JSON を、描く前にもう一度検査する。決めた形でなければ null。
 * Functions も保存の前に同じ検査をしているが、画面は受け取ったものをそのまま信じない
 * （JSON はデータとしてだけ扱い、決めた項目だけを取り出す）。
 */
export function parseModelJson(json: unknown): ModelJson | null {
  const model = json as { version?: unknown; parts?: unknown } | null
  if (!model || typeof model !== 'object' || model.version !== MODEL_VERSION) return null
  if (!Array.isArray(model.parts) || model.parts.length === 0 || model.parts.length > MAX_PARTS) return null
  const parts: ModelPart[] = []
  for (const raw of model.parts) {
    const part = parsePart(raw)
    if (!part) return null
    parts.push(part)
  }
  return { version: MODEL_VERSION, parts }
}
