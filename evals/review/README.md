# レビュー役の評価セット

レビュー役（LLM の判断）が、見るべきところを見ているかを測るための入力セットです。決まった処理（ガード、層のチェック）は `scripts/harness/tests/` のテストで、LLM の判断はここで確かめます。

各ケースは、欠陥を 1 つ仕込んだ PR（と、欠陥のない PR）のレビューパックと、期待する結果です。

| ケース | 仕込んだ欠陥 | 見つけてほしい項目 |
| --- | --- | --- |
| clean-create-trip | なし（層、Security Rules、確認テストがそろっている） | 重い指摘をしない（誤検出を測る） |
| maps-into-argon | Places の説明と口コミを、Firestore を通して模型の生成に渡す（import のチェックでは見つからない） | R3 の blocker |
| tally-in-ui | 投票の集計と決定を ui で行い、1 人 1 票を画面だけで守る | R4・R6・R7 の major 以上 |
| weak-exception | 「時間がないため」だけの例外で、ui から Firestore を読む | R5 の major 以上 |
| spec-drift-manual-route | 企画書でやめた「ルートを自分で引く」を、企画書を直さずに足す | R2 の major 以上 |
| uncapped-gemini | ログインの確認も回数の上限もない、Gemini を呼ぶ関数 | R7 の blocker |

## 流し方

```sh
npm run eval:review                       # すべて
npm run eval:review -- --case maps-into-argon
```

- `claude -p --agent reviewer` で、読む道具だけを持つレビュー役を動かし、返ってきた JSON を `scripts/harness/lib/eval-grade.mjs` が採点します
- 1 件ごとに手数（30）、費用（既定 1.5 ドル）、時間（15 分）の上限があります。費用がかかるので、レビュー役の手順（`docs/process/reviewer.md`）、評価軸、エージェントの定義を変えたときに流します
- 結果は `.harness/evals/` に残ります（手元だけ）。前の結果と比べ、直したところ以外が悪くなっていないかを見ます

## ケースを足すとき

レビュー役が見逃した、または誤って指摘した実際の PR があったら、それを元にケースを足します。`pack.md`（`npm run review-pack` の形）と `expected.json`（verdict、must_find、no_major）を置きます。
