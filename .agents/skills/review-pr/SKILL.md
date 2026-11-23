---
name: review-pr
description: PR を、実装とは別のコンテキストのレビュー役に評価させ、結果を PR にコメントする。「レビューして」「PR を見て」と頼まれたとき、または npm run work -- finish のあとに使う。
---

# PR をレビューする

実装した AI の考えに引きずられないよう、判断は別のコンテキストのレビュー役に任せる。ここで行うのは、決まった処理（材料を集める、結果を投稿する）だけ。

1. `npm run review-pack -- <PR 番号>` を実行し、出力されたレビューパックのパスを控える
2. レビュー役に渡す。渡すのは「パックのパス」と「`docs/process/reviewer.md` の手順でレビューし、決まった形の JSON で返す」という依頼だけ。自分の考えや実装の経緯は書かない
   - Claude Code：Agent ツールで reviewer（`.claude/agents/reviewer.md`）
   - Codex：reviewer サブエージェント（`.codex/agents/reviewer.toml`）
   - Antigravity：reviewer サブエージェント（`.agents/agents/reviewer.md`）
   - どれも使えなければ：新しいセッションを開き、同じ依頼をする
3. 返ってきた JSON を確かめる（verdict、findings の rubric と severity が `docs/process/reviewer.md` の決まった値か）
4. 要約と指摘を Markdown にして、パックと同じフォルダの review.md に書く。最後の行に、結論とレビューした commit の目印 `<!-- harness-review verdict=<結論> sha=<パックの head の commit> -->` を書き（結論は APPROVE、REQUEST_CHANGES、COMMENT のどれか）、`gh pr comment <PR 番号> --body-file <review.md のパス>` で投稿する。GitHub の承認（approve）はしない
5. 結論が APPROVE で、先頭の commit の手元の確認の記録があり（`npm run work -- finish`。CI は merge の条件にしない）、会話で人と合意した作業なら、人の merge 指示を待たずに `gh pr merge <PR 番号> --merge` で merge してよい（ガードが条件を確かめる）。合意がない作業と、人が「merge しない」と言った作業は merge せず、結果を人に伝える。REQUEST_CHANGES なら、指摘を直して push し、もう一度この手順を回す
   - APPROVE でも、直せる指摘（人の判断が要らず、この PR の範囲で直せるもの）が残っていたら、merge の前にこの PR で直して push し、もう一度この手順を回す。あとの作業として別の Issue に切り出さない（Issue が増えるほど、人が追う手間が増える。かめの希望、2026-11-16）。直し直しが続かないよう、追加で直すのは 2 回までにし、それでも残る小さな指摘は PR のコメントに残して merge してよい
   - 別の Issue にするのは、人の判断が要るもの（`npm run human -- add`）と、この PR の目的から外れる大きな作業だけ
6. 終わったら `git worktree remove <パックのフォルダ>/tree` で、レビュー用のチェックアウトを片付ける

目印は、レビューした commit にだけ効く。レビューのあとに commit を足したら、merge の前にもう一度レビューする。
