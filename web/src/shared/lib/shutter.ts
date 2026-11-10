import { playSound, prepareSounds } from './sound'

/** 既存の呼び出し元向け。共通プレイヤーの音量・ミュートに従う。 */
export const prepareShutter = prepareSounds
export function playShutter(): void {
  playSound('shutter', { channel: 'tour' })
}
