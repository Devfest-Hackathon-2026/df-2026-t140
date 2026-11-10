---
name: start-work
description: コードや文書を変える作業を始めるときに使う。ほかの作業や未着手 Issue を確かめ、GitHub Issue の起票・紐づけ、ブランチ、作業宣言（docs/work/）、PR を作る。main で人が作業していた変更を、消さずに新しいブランチへ移すときにも使う。
---

# 作業を始める

詳しい手順と理由は `docs/process/work.md`。ここは短い手順だけ。

1. `npm run work -- sync` で main の最新を今のブランチへ取り込み（セッションの始めのフックが有効なら済んでいる）、`npm run work -- status` で、ほかの人と AI の作業、未着手の GitHub Issue、重なり、人の判断待ちを見る
2. 開発タスクを先にバックログとして登録するときは、`npm run work -- issue --title "<作業の名前>" --kind <種類> --goal "<目的>" --done "<完了条件>" --scope "<触るファイル>"` で GitHub Issue を起票する
3. ブランチ名を決める（`<種類>/<内容>`。種類は feat、fix、docs、chore、refactor、test、perf、ci）
4. `npm run work -- start <種類>/<内容> [--issue <番号>] --title "<作業の名前>"` を実行する。`--issue` を付けると Issue の内容を引き継ぎ、ラベルを `status:in-progress` にする。main に人の変更が残っていても、消さずに新しいブランチへ移る
5. できた作業宣言（docs/work/ の下）に、目的、scope（触るファイル）、完了条件（確かめられる形）、正本への影響、他の作業との調整を書く
6. `npm run work -- declare` で宣言を main に入れ、作業用のドラフト PR を作る（`issue` 欄が空なら自動で GitHub Issue を起票し、PR に `Closes #<番号>` を入れる）
7. 作業する。設計は `docs/architecture/design-principles.md`。区切りごとに commit して push する
8. 費用、有料 API、方針、.env、権限の判断が要ったら、ask-human の skill を使う
9. 終わったら、作業宣言の status と結果を書き、`npm run work -- finish`（Issue ラベルも `status:review` になる）。レビューは review-pr の skill（別のコンテキスト）で行う

ガードに止められたら、表示された代わりの手順に従う（`docs/process/work.md` の「止められたとき」）。迂回しない。
