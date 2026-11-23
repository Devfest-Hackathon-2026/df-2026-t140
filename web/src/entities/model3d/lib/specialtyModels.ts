import type { ModelJson } from '../model/types'

/**
 * 地方や県の名物の模型（旅をつくる画面の一覧で、名物のアイコンにする）。
 * 建物と同じ形式で、手元の agy の Gemini（gemini-3.8-flash-high）に 2026-11-20 に作らせ、建物と同じ検査を通したもの。
 * だんご・うめ・火山・わんこそばの 4 つは、agy の上限に達して作れなかったので、Claude Code が同じ形式で書いた（上限が戻ったら Gemini で作り直せる）。
 * ファイル名は名物の名前（entities/trip の SPECIALTY_NAMES のキー）。Maps の内容は使っていない
 */
const MODELS = import.meta.glob<ModelJson>('../assets/specialties/*.json', { eager: true, import: 'default' })

/** 名物の模型。ないときは null */
export function specialtyModel(name: string): ModelJson | null {
  return MODELS[`../assets/specialties/${name}.json`] ?? null
}
