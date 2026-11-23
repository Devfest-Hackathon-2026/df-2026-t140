import type { ModelJson } from '@/entities/model3d'

// しおりの再生で走る乗り物の模型（自作。建物の模型と同じ部品の JSON）。区間の手段で使い分ける（電車・バス、車、徒歩、飛行機）。
// どれも前は +x（絵では右下を向く）。原点は地面の真ん中。建物の箱（幅 12、高さ 16）より小さく作る

/** 車の模型 */
export const CAR_MODEL: ModelJson = {
  version: 1,
  parts: [
    // 車体と屋根
    { shape: 'box', size: [8, 1.8, 4], position: [0, 1.7, 0], color: '#e4572e' },
    { shape: 'box', size: [4.4, 1.6, 3.6], position: [-0.6, 3.4, 0], color: '#f26b43' },
    // 窓（前と横）
    { shape: 'box', size: [0.2, 1.2, 3.2], position: [1.65, 3.4, 0], color: '#bfe3f2' },
    { shape: 'box', size: [3.6, 1.1, 3.7], position: [-0.6, 3.45, 0], color: '#bfe3f2' },
    // 前の灯りと、後ろの灯り
    { shape: 'box', size: [0.2, 0.5, 0.9], position: [4.05, 1.9, 1.3], color: '#fff6c8' },
    { shape: 'box', size: [0.2, 0.5, 0.9], position: [4.05, 1.9, -1.3], color: '#fff6c8' },
    { shape: 'box', size: [0.2, 0.5, 0.9], position: [-4.05, 1.9, 1.3], color: '#b3261e' },
    { shape: 'box', size: [0.2, 0.5, 0.9], position: [-4.05, 1.9, -1.3], color: '#b3261e' },
    // 車輪（円柱を横に倒す）
    { shape: 'cylinder', size: [1.8, 0.7, 1.8], position: [2.6, 0.9, 2.05], rotation: [90, 0, 0], color: '#2f3237' },
    { shape: 'cylinder', size: [1.8, 0.7, 1.8], position: [2.6, 0.9, -2.05], rotation: [90, 0, 0], color: '#2f3237' },
    { shape: 'cylinder', size: [1.8, 0.7, 1.8], position: [-2.6, 0.9, 2.05], rotation: [90, 0, 0], color: '#2f3237' },
    { shape: 'cylinder', size: [1.8, 0.7, 1.8], position: [-2.6, 0.9, -2.05], rotation: [90, 0, 0], color: '#2f3237' },
  ],
}

/** 電車の模型（電車・バスの区間）。白い車体に青い帯の 1 両 */
export const TRAIN_MODEL: ModelJson = {
  version: 1,
  parts: [
    // 車体と屋根
    { shape: 'box', size: [11, 3.4, 3.8], position: [0, 2.5, 0], color: '#f4f6f8' },
    { shape: 'box', size: [10.4, 0.5, 3.4], position: [0, 4.45, 0], color: '#c3c9d1' },
    // 青い帯と、横の窓の並び
    { shape: 'box', size: [11.05, 0.6, 3.85], position: [0, 1.6, 0], color: '#2f7fd1' },
    { shape: 'box', size: [8.4, 1.1, 3.9], position: [-0.6, 3.2, 0], color: '#bfe3f2' },
    // 前の窓、前の灯り、後ろの灯り
    { shape: 'box', size: [0.2, 1.3, 3.0], position: [5.55, 3.2, 0], color: '#bfe3f2' },
    { shape: 'box', size: [0.2, 0.5, 0.8], position: [5.55, 2.2, 1.3], color: '#fff6c8' },
    { shape: 'box', size: [0.2, 0.5, 0.8], position: [5.55, 2.2, -1.3], color: '#fff6c8' },
    { shape: 'box', size: [0.2, 0.5, 0.8], position: [-5.55, 2.2, 1.3], color: '#b3261e' },
    { shape: 'box', size: [0.2, 0.5, 0.8], position: [-5.55, 2.2, -1.3], color: '#b3261e' },
    // 台車
    { shape: 'box', size: [2.6, 0.8, 3.2], position: [3.4, 0.4, 0], color: '#2f3237' },
    { shape: 'box', size: [2.6, 0.8, 3.2], position: [-3.4, 0.4, 0], color: '#2f3237' },
  ],
}

/**
 * 歩く人の模型（徒歩の区間）。リュックを背負う。swing は足と腕を振る角度（度）。
 * 0 は立っている形。歩いているあいだは、+swing と -swing の形を交互に出して足を動かす（ui/MapVehicle）
 */
function walkerModel(swing: number): ModelJson {
  return {
    version: 1,
    parts: [
      // 足（前後に振る）
      { shape: 'box', size: [1.3, 3.6, 1.3], position: [0, 1.8, 0.75], rotation: [0, 0, -swing], color: '#3a4a6b' },
      { shape: 'box', size: [1.3, 3.6, 1.3], position: [0, 1.8, -0.75], rotation: [0, 0, swing], color: '#3a4a6b' },
      // 胴と腕（足と逆に振る）
      { shape: 'box', size: [2.1, 3.6, 3.1], position: [0, 5.3, 0], color: '#e4572e' },
      { shape: 'box', size: [0.85, 3.1, 0.85], position: [0, 5.2, 2.05], rotation: [0, 0, swing], color: '#e4572e' },
      { shape: 'box', size: [0.85, 3.1, 0.85], position: [0, 5.2, -2.05], rotation: [0, 0, -swing], color: '#e4572e' },
      // 頭と髪
      { shape: 'sphere', size: [2.65, 2.65, 2.65], position: [0, 8.4, 0], color: '#f2c9a0' },
      { shape: 'sphere', size: [2.8, 1.55, 2.8], position: [-0.2, 9.15, 0], color: '#3b2a20' },
      // リュック（背中。前の向きが分かるように）
      { shape: 'box', size: [1.25, 2.65, 2.4], position: [-1.6, 5.6, 0], color: '#f2b134' },
    ],
  }
}

/** 立っている人（着いて止まっているとき） */
export const WALKER_MODEL = walkerModel(0)
/** 歩いている人の 2 つの形（足を前後に開く向きが逆） */
export const WALKER_STEPS = [walkerModel(38), walkerModel(-38)] as const

/** 飛行機の模型（飛行機の区間）。白い機体に青い帯と尾翼。区間の途中では、地図の上に浮かせて飛ぶ（ui/MapVehicle） */
export const PLANE_MODEL: ModelJson = {
  version: 1,
  parts: [
    // 機体（円柱を横に倒す）と、前の先の円すい
    { shape: 'cylinder', size: [1.9, 8.6, 1.9], position: [-0.4, 2, 0], rotation: [0, 0, 90], color: '#f4f6f8' },
    { shape: 'cone', size: [1.9, 2.2, 1.9], position: [4.95, 2, 0], rotation: [0, 0, -90], color: '#f4f6f8' },
    // 窓の帯と、操縦席の窓
    { shape: 'box', size: [6.4, 0.35, 1.95], position: [0, 2.35, 0], color: '#2f7fd1' },
    { shape: 'box', size: [0.6, 0.45, 1.5], position: [4.1, 2.6, 0], color: '#bfe3f2' },
    // 主翼とエンジン
    { shape: 'box', size: [2.4, 0.3, 11.4], position: [0.2, 1.7, 0], color: '#e3e8ee' },
    { shape: 'cylinder', size: [0.9, 1.7, 0.9], position: [0.9, 1.15, 2.7], rotation: [0, 0, 90], color: '#9aa6b2' },
    { shape: 'cylinder', size: [0.9, 1.7, 0.9], position: [0.9, 1.15, -2.7], rotation: [0, 0, 90], color: '#9aa6b2' },
    // 尾翼（縦と横）
    { shape: 'box', size: [1.8, 2.6, 0.3], position: [-4.2, 3.6, 0], color: '#2f7fd1' },
    { shape: 'box', size: [1.4, 0.25, 4.2], position: [-4.3, 2.2, 0], color: '#e3e8ee' },
  ],
}
