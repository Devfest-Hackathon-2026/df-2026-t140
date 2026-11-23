// SDK を使わない純粋な判断。使用量を見せてよいかを決める。

/**
 * 使用量を見せてよいか。手元（Emulator）では誰にでも見せる（アプリ全体の合言葉も手元では守らないので、それに合わせる）。
 * 本番では合言葉を通した人だけ（かめの決定、2026-11-16 の会話）。全員に開く切り替え（settings/ai の openToAll）では開かない
 */
export function canSeeUsage(input: { local: boolean; unlocked: boolean }): boolean {
  return input.local || input.unlocked
}

/**
 * 地図の読み込みを数えてよいか。見せてよい人と同じ（手元では誰でも、本番では合言葉を通した人だけ）。
 * 本番では合言葉を通すまで地図を出さないので、通していない人からの呼び出しは数えない（表示の回数を水増しさせない）
 */
export function canCountMapLoad(input: { local: boolean; unlocked: boolean }): boolean {
  return canSeeUsage(input)
}
