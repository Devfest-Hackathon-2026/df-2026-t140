// Google の Knowledge Graph Search API で、場所の名前から説明を引く口の型（ポート）。実体は adapters/knowledge-graph.ts。
// 使うのは、ライセンスが示された詳しい説明（detailedDescription。Wikipedia の文で CC BY-SA）だけ。
// 名前は Gemini が Maps を使わずに出したもの。Maps 由来の内容は渡さない（規約 3.2.3(c)）。

/** 模型の入力に足す参考の文と、その出典 */
export interface PlaceReference {
  /** 説明の文（Wikipedia の記事の冒頭） */
  text: string
  /** 出典の記事の URL */
  url: string
  /** ライセンスの URL（CC BY-SA） */
  license: string
}

export interface KnowledgeGraphPort {
  /** 呼べる設定か（キーがあり、Emulator ではない）。false なら describe は呼ばない */
  enabled(): boolean
  /** 名前で探し、ライセンスの付いた詳しい説明があれば返す。なければ、呼べなければ null */
  describe(name: string): Promise<PlaceReference | null>
}
