// Gemini の呼び出し口の型（ポート）。stub、agy、vertex のどれでも、入力と出力の形は同じにする。
// 型だけを書く。SDK を import しないので、各機能の logic から使える。実体は adapters/gemini。

/** GEMINI_PROVIDER に書ける値 */
export type GeminiProvider = 'stub' | 'agy' | 'vertex'

/** flash：場所、ルート、スケジュールの提案。argon：模型の JSON */
export type GeminiModel = 'flash' | 'argon'

/**
 * Gemini に頼む仕事 1 種類。各機能の logic.ts か prompt.ts に書く（例：features/ping/logic.ts の pingTask）。
 * 本物の Gemini には prompt を送り、応答の JSON を parse で確かめる。stub は固定の応答を返す。
 */
export interface GeminiTask<Input, Output> {
  name: string
  model: GeminiModel
  /** 本物の Gemini に送る文。JSON だけを返すよう頼む */
  prompt(input: Input): string
  /** 応答の JSON が決めた形かを確かめる。違えば例外を投げる */
  parse(json: unknown): Output
  /** 固定の応答。本物と同じ形にする */
  stub(input: Input): Output
}

export interface GeminiResult<Output> {
  output: Output
  /** 実際に応答を作ったもの。本物が使えず固定の応答に戻したときは 'stub' */
  provider: GeminiProvider
  /** 本物を頼んだのに固定の応答に戻したとき true。画面で「本物の応答ではない」と分かるようにする */
  fellBack: boolean
}

/**
 * 費用のかかる経路（Cloud の Gemini、vertex）を呼んでよいと、usecase が確かめた印。
 * 「頼んだ人が合言葉を通している」と「回数の上限の中」（ports/aiGate.ts）を確かめたときだけ作る。
 * 印がなければ、vertex でも固定の応答に戻る（費用側に倒さない）。stub と agy（手元）には関係ない
 */
export interface GeminiPermit {
  /** 確かめた人 */
  uid: string
  /**
   * 数えた 1 回を戻す。呼び出し口（adapters/gemini）が、1 回目の呼び出しが設定の誤り（401、403、404）で
   * 失敗したときだけ呼ぶ。429 や通信の失敗では呼ばない
   */
  refund?: () => Promise<void>
}

export interface GeminiRunOptions {
  permit?: GeminiPermit
}

/** 各機能が ports.ts で受け取る、Gemini の呼び出し口。実体は adapters/gemini */
export interface GeminiPort {
  run<Input, Output>(task: GeminiTask<Input, Output>, input: Input, options?: GeminiRunOptions): Promise<GeminiResult<Output>>
}

/** 文を送って、応答の文を受け取る処理。agy と vertex がこの形で実装する */
export type GenerateText = (model: GeminiModel, prompt: string) => Promise<string>
