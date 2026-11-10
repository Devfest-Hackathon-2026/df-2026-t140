import type { ModelJson } from '@/entities/model3d'

/**
 * しおりの再生で走る車の模型（自作。建物の模型と同じ部品の JSON）。前は +x（絵では右下を向く）。
 * 原点は地面の真ん中。建物の箱（幅 12、高さ 16）より小さく作る
 */
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
