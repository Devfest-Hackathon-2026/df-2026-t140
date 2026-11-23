import { createHash } from 'node:crypto'
import { MODEL_VERSION, type PinModel, validateModelJson } from '../../../domain/model3d'
import { isPinCategory, type Pin } from '../../../domain/pin'

/** プロンプトや模型の形式を変えるときは辞書の版も更新する。 */
export const LIBRARY_VERSION = 1
export type ModelIdentity = Pick<Pin, 'name' | 'area' | 'category'>
export type ReusableModel = Omit<PinModel, 'createdAt'>
export interface LibraryEntry { version: number; key: string; identity: ModelIdentity; model: ReusableModel }

const normalize = (text: string) => text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ja')

/** Maps由来の値は読まない。同名の場所を別の地域と混同しないよう、地域がないものは共有しない。 */
export function modelKey(identity: ModelIdentity): string | null {
  if (!identity || typeof identity !== 'object') return null
  if (typeof identity.name !== 'string' || typeof identity.area !== 'string' || !isPinCategory(identity.category)) return null
  const name = normalize(identity.name)
  const area = normalize(identity.area)
  if (!name || !area) return null
  return createHash('sha256').update(JSON.stringify([LIBRARY_VERSION, MODEL_VERSION, name, area, identity.category])).digest('hex')
}

export function libraryEntry(identity: ModelIdentity, model: ReusableModel): LibraryEntry | null {
  const key = modelKey(identity)
  if (!key || !model || model.source !== 'argon') return null
  try {
    const json = validateModelJson(model.json)
    const reference = model.reference
    if (reference && (![reference.text, reference.url, reference.license].every((value) => typeof value === 'string')
      || !/^https:\/\//u.test(reference.url) || !reference.license)) return null
    return { version: LIBRARY_VERSION, key, identity: { name: identity.name, area: identity.area, category: identity.category },
      model: { json, source: 'argon', ...(reference ? { reference: { text: reference.text, url: reference.url, license: reference.license } } : {}) } }
  } catch { return null }
}

export function readLibraryEntry(value: unknown, identity: ModelIdentity): ReusableModel | null {
  const entry = value as LibraryEntry | null
  const key = modelKey(identity)
  if (!key || !entry || entry.version !== LIBRARY_VERSION || entry.key !== key || !entry.identity || !entry.model) return null
  if (modelKey(entry.identity) !== key) return null
  return libraryEntry(entry.identity, entry.model)?.model ?? null
}
