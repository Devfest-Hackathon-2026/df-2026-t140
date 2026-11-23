---
name: ask-human
description: 費用、料金がかかる API、プロジェクトの方針、.env や秘密情報、Google Cloud・Firebase・GitHub の設定や権限など、AI が決めたり実行したりしてはいけない判断が出てきたときに使う。todo/humans/ に書いて人に頼み、待つあいだはほかの作業を続ける。人が決めたことを記録するときにも使う。
---

# 人に判断を頼む

1. 同じ件がないか `npm run human -- list` で確かめる
2. なければ `npm run human -- add <英小文字の名前> --title "<決めてほしいこと>" --kind <費用|有料API|方針|秘密情報|権限|その他>`
3. できたファイルに、決めてほしいこと（はい・いいえか A・B で答えられる問い）、背景（なぜ AI では決められないか、何が止まっているか）、選択肢（良い点・悪い点・費用）、AI の推奨を書き、`npm run human -- publish <名前>` で main に入れる（今のブランチのままでよい）
4. 作業宣言の blocked_by に、そのファイル名を書く
5. 判断を待つあいだは、仮の形で進められる作業か、ほかの作業を続ける。自動で進めてよい期間（CLAUDE.md）なら、最適と思われる案で実装し、PR に「仮に選んだこと」として書く。ただし費用、有料 API、.env、権限、デプロイは実行しない

人が決めたと聞いたら（会話やチャットで）、決めた人の言葉で記録する。会話で人とすり合わせて決まったなら、それで決定として、その場で記録する。人に git の操作や別の承認を求めない（`todo/humans/2026-11-08-decide-in-chat.md`）。`done` は記録したあと main まで入れる。

`npm run human -- done <名前> --decision "<決めた内容>" --by <決めた人> --reason "<理由>"`

本番に出したあとでしか確かめられない確認（OAuth の戻り先、ホーム画面に置いたアプリでの動き、本物の地図での動き、本番の設定値など）は、done の decision に「deploy のあとで確かめる」と書いて済ませない。`add` で別の項目を作らず、`npm run human -- prod-check --title "<確かめること>" --from "#<Issue>、PR #<番号>"` で、open なまとめの 1 件（`<日付>-prod-check.md`、Issue 1 つ）に足す（Takana の指示、2026-11-22）。足したチェックには、どの画面で何をすれば OK か、うまくいかないとき何を見るかまで書き、`npm run human -- publish <名前>` で main に入れる。`add` で本番での確認を作ろうとするとガードが止め、CI も落ちる。費用の判断を伴う確認（Maps の使用量など）は別の項目にする（`todo/humans/README.md`「本番に出したあとでしか確かめられないこと」）。

AI が代わりに決めて done にしない。技術の選定なら `docs/architecture/decisions.md`、企画の判断なら `docs/product/proposal.md` にも反映する。
