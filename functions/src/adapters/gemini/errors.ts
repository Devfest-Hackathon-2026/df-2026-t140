/** まだつないでいない、環境にない、などで呼べないとき。やり直さずに固定の応答へ戻す */
export class ProviderUnavailableError extends Error {}

/**
 * 設定の誤り（モデルがない、権限がない）で呼べなかったとき。相手の側では何も作っていないので、
 * 費用の回数として数えた 1 回を戻してよい（GeminiPermit の refund）。429 や通信の失敗はこれにしない
 */
export class ProviderConfigError extends ProviderUnavailableError {}
