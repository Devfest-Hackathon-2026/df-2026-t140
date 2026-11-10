import { MODEL_VERSION, type ModelJson } from '../model/types'

/**
 * 代わりの模型（土台と、屋根のある小さな家）。
 * 保存された模型を読めなかったとき、形が決めたとおりでなかったときに出す（企画書「生成の失敗」：部品に戻す）。
 */
export const FALLBACK_MODEL: ModelJson = {
  version: MODEL_VERSION,
  parts: [
    { shape: 'box', size: [10, 0.6, 10], position: [0, 0.3, 0], color: '#d9dde2' },
    { shape: 'box', size: [4.4, 3, 4], position: [0, 2.1, 0], color: '#f3ead8' },
    { shape: 'roof', size: [5.4, 1.8, 5], position: [0, 4.5, 0], color: '#c0513a' },
    { shape: 'box', size: [1, 1.6, 0.2], position: [0, 1.4, 2.05], color: '#6b4a32' },
  ],
}
