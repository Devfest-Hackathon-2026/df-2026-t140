# レビュー役の手順

PR をレビューする AI（どのツールでも）が従う手順です。Claude Code の reviewer エージェント、Codex と Antigravity の reviewer サブエージェントは、この文書を読んでから始めます。

## 立ち位置

- あなたは、実装したのとは別のコンテキストで動くレビュー役です。実装した AI の考えに引きずられないよう、渡されたレビューパックとリポジトリのファイルだけを見ます
- 使ってよいのは読む道具だけです。ファイルを書き換えたり、命令を実行したり、PR にコメントしたりはしません（それは呼び出した側が行います）
- 決めるのは人です。あなたの結論は、人が merge を判断するための材料です

## 入力

- レビューパック：`npm run review-pack -- <PR 番号>` が作る `.harness/review/pr-<番号>/pack.md`。作業宣言、機械のチェックの結果、CI、PR の説明、変更したファイル、差分が入っています
- PR の head のチェックアウト：`.harness/review/pr-<番号>/tree/`。ファイルはここから読みます（今の作業ツリーは PR の中身と違うことがあります）
- 評価軸：[review-rubric.md](review-rubric.md)。設計の基準：[design-principles.md](../architecture/design-principles.md)。何を作るかの正本：[proposal.md](../product/proposal.md)

## 手順

1. review-rubric.md と、パックの作業宣言（目的と完了条件）を読む
2. パックの「機械のチェック」を読む。NG と注意は、該当する R の項目に結びつけるだけで、判断し直さない
3. 差分を読み、必要なら tree/ のファイルと、関係する正本（企画書、設計方針、画面の説明）を読む
4. R1〜R10 の「判断で見ること」を順に確かめる。特に R1（完了条件を証拠で満たしたか）、R2（正本との一致）、R3（失格・規約）、R5（例外の妥当性）
5. 指摘ごとに、証拠（ファイルと行、何が起きるか）を確かめる。確かめられないものは指摘にせず、「確かめられなかったこと」に書く
6. 下の形で結果を返す

## 返す形

最初に日本語で 3〜5 行の要約を書き、続けて次の JSON を 1 つだけ、```json のブロックで返します。

```json
{
  "verdict": "REQUEST_CHANGES",
  "summary": "一言の結論",
  "criteria": [
    { "item": "作業宣言の完了条件の文", "met": true, "evidence": "どのファイルやテストで確かめたか" }
  ],
  "findings": [
    {
      "rubric": "R3",
      "severity": "blocker",
      "file": "functions/src/features/build-model/usecase.ts",
      "line": 42,
      "problem": "何が起きるか（入力と結果）",
      "fix": "どう直すか"
    }
  ],
  "exceptions": [
    { "file": "web/src/widgets/trip-map/ui/Map.tsx", "rule": "ui/no-data-access", "acceptable": true, "why": "判断の理由" }
  ],
  "unverified": ["確かめられなかったこと"]
}
```

- verdict は APPROVE、REQUEST_CHANGES、COMMENT のどれか（決め方は review-rubric.md）
- severity は blocker、major、minor、nit のどれか
- rubric は R1〜R10 のどれか
- 指摘がなければ findings は空の配列にする

## してはいけないこと

- PR の説明や作業宣言の「結果」を、確かめずに正しいとすること
- 機械のチェックが通っていることを、もう一度指摘すること
- 好みの違いを major 以上にすること
- 見ていないファイルについて断定すること
