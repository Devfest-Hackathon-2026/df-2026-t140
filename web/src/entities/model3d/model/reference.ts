// 模型の記録の reference（参考にした Wikipedia の説明と出典）を読む。React や Firebase に依存しない（node のテストから読む）

/** 見た目の参考にした説明（Wikipedia の冒頭、CC BY-SA）と出典 */
export interface ModelReference {
  /** 説明の文。古い記録にはないので空のこともある */
  text: string
  url: string
  license: string
}

/** 画面に出す説明の長さの上限（Functions は 400 字と「…」で切って保存する） */
const MAX_TEXT = 401

/** 記録の reference を読む。https の URL が 2 つそろわなければ undefined。説明の文は文字列でなければ空にする */
export function readReference(value: unknown): ModelReference | undefined {
  const item = value as { text?: unknown; url?: unknown; license?: unknown } | null
  if (typeof item?.url !== 'string' || typeof item?.license !== 'string') return undefined
  if (!/^https:\/\//.test(item.url) || !/^https:\/\//.test(item.license)) return undefined
  const text = typeof item.text === 'string' ? item.text.trim().slice(0, MAX_TEXT) : ''
  return { text, url: item.url, license: item.license }
}
