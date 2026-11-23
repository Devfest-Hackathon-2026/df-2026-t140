import type { KnowledgeGraphPort, PlaceReference } from '../ports/knowledge-graph'
import { countApiCall } from './apiUsage'

// Google の Knowledge Graph Search API（https://developers.google.com/knowledge-graph ）で、場所の名前の説明を引く。
// かめの判断を待っている（todo/humans/2026-11-08-model-kg-description.md）。キーを入れるまでは呼ばない。
//
// - 費用：Cloud の課金はない（1 日 10 万回まで無料）
// - 使うのは detailedDescription（Wikipedia の記事の冒頭。出典の url と license が付く）だけ。license が
//   Creative Commons のものだけを使う。短い description と name は、ライセンスが示されていないので使わない
//   （Google APIs Terms of Service 5(e) により、ほかの内容と同じ扱いで保存しない）
// - キーは環境変数 KG_API_KEY（本番は人が GitHub の secret に入れる。リポジトリには書かない）
// - Emulator（FUNCTIONS_EMULATOR=true）では、キーがあっても呼ばない

const ENDPOINT = 'https://kgsearch.googleapis.com/v1/entities:search'
const TIMEOUT_MS = 8_000
/** 模型の入力に足す長さの上限（字）。プロンプトを長くしすぎない */
export const MAX_REFERENCE_CHARS = 400

/** 呼ぶ URL（テストのために export する。キーは含めない） */
export function kgSearchParams(name: string): URLSearchParams {
  return new URLSearchParams({ query: name, languages: 'ja', limit: '1', indent: 'false' })
}

/**
 * CC BY-SA を示すライセンスの URL か。Knowledge Graph は、creativecommons.org の URL のほか、
 * Wikipedia のライセンスの説明のページ（…/wiki/Wikipedia:Text_of_Creative_Commons_Attribution-ShareAlike_3.0_Unported_License）を返す
 */
export function isCcBySa(license: string): boolean {
  if (!/^https:\/\//.test(license)) return false
  return /creativecommons\.org\/licenses\/by-sa\//.test(license) || /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\/Wikipedia:Text_of_Creative_Commons_Attribution-ShareAlike/.test(license)
}

/** 応答から、ライセンスの付いた詳しい説明を取り出す（テストのために export する） */
export function parseReference(json: unknown): PlaceReference | null {
  const items = (json as { itemListElement?: unknown })?.itemListElement
  if (!Array.isArray(items) || items.length === 0) return null
  const detailed = (items[0] as { result?: { detailedDescription?: Record<string, unknown> } })?.result?.detailedDescription
  const text = typeof detailed?.articleBody === 'string' ? detailed.articleBody.trim() : ''
  const url = typeof detailed?.url === 'string' ? detailed.url : ''
  const license = typeof detailed?.license === 'string' ? detailed.license : ''
  if (!text || !/^https:\/\//.test(url)) return null
  if (!isCcBySa(license)) {
    // 説明はあるのにライセンスで外したときは、あとで形を確かめられるように残す（URL だけ。本文は出さない）
    console.warn(`Knowledge Graph の説明を、ライセンスが CC BY-SA と読めないので使いませんでした：${license || '（なし）'}`)
    return null
  }
  return { text: text.length > MAX_REFERENCE_CHARS ? `${text.slice(0, MAX_REFERENCE_CHARS)}…` : text, url, license }
}

/** Emulator ではなく、キーがあるか */
export function knowledgeGraphEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR !== 'true' && (env.KG_API_KEY ?? '').trim().length > 0
}

export const knowledgeGraph: KnowledgeGraphPort = {
  enabled: () => knowledgeGraphEnabled(),
  async describe(name) {
    const key = process.env.KG_API_KEY?.trim()
    if (!knowledgeGraphEnabled() || !key || name.trim().length === 0) return null
    try {
      const params = kgSearchParams(name)
      params.set('key', key)
      await countApiCall('knowledgeGraph')
      const response = await fetch(`${ENDPOINT}?${params.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) {
        console.warn(`Knowledge Graph Search API が ${response.status} を返しました。参考の文なしで作ります`)
        return null
      }
      return parseReference(await response.json())
    } catch (cause) {
      console.warn('Knowledge Graph Search API を呼べませんでした。参考の文なしで作ります', cause)
      return null
    }
  },
}
