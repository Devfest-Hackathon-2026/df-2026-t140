# konbu-devfest

DevFest GDGoC Japan Hackathon 2026 の開発用リポジトリ。友人グループが 3D 地図の上で旅行を一緒に計画する、スマホ優先の PWA（カテゴリ：観光）を作る。提出とコードフリーズは 2026-11-10 19:00 JST。

このファイルは、どの AI も最初に読む道案内。全員が常に守ることだけをここに書き、詳しいことは目的別の文書に分けた。全部は読まず、下の「目的別の入口」から今の作業に要るものだけを読む。

## 必ず守ること

違反は失格や事故につながる。hooks、git hooks、CI が止めるので、止められたら表示された理由と代わりの手順に従う。迂回しない（`docs/process/work.md`）。

- main では編集も commit もしない。AI は commit、push、PR の作成、レビュー（`/review-pr`）までをしてよい。会話で人と合意した作業の PR は、作業中（ドラフトか「作業中」ラベル）でなく、先頭の commit の手元の確認の記録があり、main とぶつからず、別のコンテキストのレビュー役が APPROVE したら、人の merge 指示を待たずに AI が merge してよい（ガードが条件を確かめる。`todo/humans/2026-11-07-merge-on-chat-agreement.md`）。人が「merge しない」と言った作業と、合意していない作業は merge せず、レビューで止めて人に伝える。作業宣言だけの PR（docs/work/ だけ）は別で、`npm run work -- declare` が指示なしで main に入れる
- 作業を終える前に、手元で CI と同じ確認を必ず通す（`npm run work -- finish` が走らせる。単体は `npm run verify:local`）。merge の条件は CI ではなくこの記録で、`npm run verify` は本番への反映（deploy ブランチ）のときに Deploy がまとめて確かめる（ハーネスのチェックは手元の記録だけ。Lazyturtle0852 の決定、2026-11-22。`docs/process/work.md` の「手元の確認」）
- 本番へ出すのは、人が main を `deploy` ブランチへ反映したときだけ（main への merge では出ない。かめの決定、`todo/humans/2026-11-07-deploy-branch.md`）。AI は deploy に push も commit も merge もしない（ガードが止める）。本番に出したいときは人に頼む。手順は `docs/process/setup.md` の「本番への反映」
- 作業の始めに main の最新を取り込む（セッションの始めのフックが自動で行う。フックのない AI は `npm run work -- sync`）。開発タスクはすべて GitHub Issue に起票し（`npm run work -- issue`）、作業の前に `npm run work -- start <種類>/<内容> [--issue <番号>]` でブランチと作業宣言を作り、`npm run work -- declare` で宣言を main に入れて PR を作る（Issue なしで始めた作業も `declare` が自動で Issue を起票して紐づける）。区切りごとに commit して push する
- 例外：todo/humans/ だけを変えるとき（判断を頼む・記録する）は、PR を作らず main に直接入れる。`npm run human -- done` は記録して main まで入れ、`npm run human -- publish` は今のブランチのまま todo/humans/ の変更を main へ入れる（人の git の操作は要らない）。ほかのファイルを混ぜない（`docs/process/work.md`）
- 秘密情報（API キー、.env）をコミットしない、読まない、書かない。Maps の Demo Key は本番利用が禁止
- 実行基盤は App Engine、Compute Engine、GKE、Cloud Run、Firebase App Hosting、Firebase Hosting のどれかを使う（このリポジトリは Firebase Hosting と Cloud Functions）。プロダクトの AI は Gemini にし、他社 AI の SDK をプロダクトに入れない。デモとピッチで他社製品を前面に出さない
- Maps 由来の内容を 3D 生成の入力にしない（Maps Platform 規約 3.2.3(c)）。自作地図と Maps API を一緒に使わない（同 3.2.3(e)）
- 開発開始前の PoC コードを流用しない。デモ動画を偽装しない（動いていない機能を動いているように見せない）
- 提出用リポジトリへ開発用の履歴を push しない。内部資料が公開される（`docs/process/submission.md`）
- 使った素材・ライブラリ・データの出典とライセンスを `docs/records/credits.md` に残す

## 人にしかできないこと

次のことは AI が決めず、実行もしない。`npm run human -- add` で `todo/humans/` に書き、判断を待つあいだはほかの作業を進める。

- 費用に関わる決定、料金がかかる API の利用（Cloud の Gemini、Maps Platform）、上限の変更
- プロジェクトの方針に大きく関わる判断（何を作るか、技術の選定）
- .env と秘密情報の扱い、Google Cloud・Firebase・GitHub の設定と権限
- 本番への反映（main から deploy ブランチへ）、手元からのデプロイ、PR の承認（GitHub の approve）、ガードの条件を満たさない merge

人が決めたら、その項目を done にし、決めた人と理由を書く（`npm run human -- done`）。会話で人が AI とすり合わせて決めたら、それで決定とし、AI がその場で記録して main まで入れる。人に git の操作や別の承認を求めない（かめの決定、`todo/humans/2026-11-08-decide-in-chat.md`）。人が決めていないことを AI が決めて done にはしない。

## 自動で進めてよい期間

`harness.config.json` の autonomousUntil（今は 2026-11-08 10:00 JST まで。決めた記録は `todo/humans/2026-11-08-overnight-autonomy-2.md`）までは、人の許可を待たずに進める。気を付けるべきところ（この文書の「必ず守ること」、正本、設計方針）は期間中も同じで、見逃してよいわけではない。

- 案で迷ったら、企画書の目的（全員が主人公、幹事に集中させない）に照らして最適と思われる案で実装し、PR の説明に「仮に選んだこと」として書く。人が決めるべきことは `todo/humans/` にも書く
- ハーネスが人に確認を求める操作（artifact のコピー、ガードレールの変更）も止めずに進む（トレースに残る）。変えたことは PR に書く
- 期間中も人に残すもの：費用、有料 API、.env、権限、本番への反映（deploy ブランチ）と手元からのデプロイ。merge はガードの条件（手元の確認の記録、レビューの承認）を満たし、会話で人と合意した作業だけ（`todo/humans/2026-11-07-merge-on-chat-agreement.md`）。ガードは期間中も止める

## 費用を出さない

- Cloud の Gemini（Vertex AI）は、チームが許可するまで呼ばない。本物の Gemini はローカルの agy で試す（`docs/process/dev-plan.md`）
- Google Maps は API ごとに 1 日の上限をかけてある（`docs/process/setup.md`）。上限を上げない。0 回にした API を使う実装をしない

## 画面を変えたらスクリーンショットか動画

`web/` の見た目や操作が変わる作業では、見た目を確かめられるものを報告と PR に添える。基本はどちらか 1 つにする（かめの決定、2026-11-16）。

- 1 つの画面の見た目が変わるときは、スクリーンショット。変わった幅（スマホの 390px、PC の幅など）ごとに撮る。ターミナルには画像を埋め込めないので、報告の最後に画像の絶対パスを並べる。PR には `gh pr comment <番号> --body-file <説明> --attach <画像>` で画像そのものを添付する（パスを書くだけでは PR で見えない）。この添付は確認なしでしてよい
- 画面をまたぐ流れや、動き・操作が変わるときは、`demo-video` スキルで動画を撮って PR に添付する。撮る前にユーザーに確認しなくてよい。PR へのコメント投稿だけは、スキルの手順どおり投稿の直前に確認する。夜間など確認できる人がいないときは、動画を作って添付コマンドを PR の説明に書いておく。撮影の条件は `.claude/demo-video.md`
- 確かめるために撮ったものも捨てずに渡す。撮ったのに渡さない、を避ける
- バックエンドだけ・文書だけ・見た目が変わらないリファクタの PR では、どちらも撮らない

## 正本（グラウンドルール）

- 何を作るか・なぜ作るかは、企画書 `docs/product/proposal.md` が正本。変更や決定は最初に企画書を直し、ほかの文書とコードを合わせる。合意前の案は企画書の「議論済み」の目印より下に置く
- どう作るかの原本は技術構成の artifact（コピーは `docs/architecture/sources/`）。技術の決定は `docs/architecture/decisions.md` に、比べた案と人が選んだ理由を残す
- 仕様に合わない実装が要るときは、コードより先に正本を直す
- 打ち合わせで決まったことは、議事録に残すだけで終えず企画書に反映する

## 設計の要点

詳しくは `docs/architecture/design-principles.md`。機械で確かめるルールは、編集のたびと commit、push、CI で検査される。

- フロントエンド（web/src）は Feature-Sliced Design。app > pages > widgets > features > entities > shared の順にだけ依存する。ui は描画だけ、状態と判断は model、読み書きは api
- バックエンド（functions/src）は機能ごとの縦のスライス。features/<機能>/ の handler → usecase → logic。外部の SDK は adapters に置き、機能どうしは Firestore の状態でつなぐ
- 方針から外れるときは、理由を `@harness-exception <ルール>` でファイル内に書く。レビューで妥当性を見る
- 画面に出る日本語（ボタン、見出し、案内、エラー）を AI が書く・書き換えるときは、yomiyasu スキル（Codex では `yomiyasu:yomiyasu`）で推敲してから入れる。人が手で書いた文言は直さない。通していなくても push と merge は止めない。やり方と点検（`npm run copy:check`）は `docs/ui/README.md` の「画面の文言」

## 目的別の入口

| やること | 最初に読む | 必要なら |
| --- | --- | --- |
| 作業を始める・進める・終える | `docs/process/work.md` | `docs/process/README.md`（ハーネスの全体像） |
| 今夜の実装（段ごとの順番と完了の条件） | `docs/process/dev-plan.md` | |
| 画面を作る・直す | `docs/ui/README.md`、`docs/architecture/design-principles.md` | `docs/product/proposal.md` の「ユーザー体験」 |
| バックエンド、データ、AI の呼び出し | `docs/architecture/README.md`、`docs/architecture/design-principles.md` | `docs/architecture/sources/architecture.html` |
| 企画・仕様を変える | `docs/product/proposal.md` | `docs/contexts/`（打ち合わせの記録）、`docs/product/competitors.md` |
| PR をレビューする | `docs/process/reviewer.md`、`docs/process/review-rubric.md` | |
| 環境を作る・ローカルで動かす | `docs/process/setup.md` | |
| ピッチ・提出物を作る | `docs/contexts/hackathon.md` | `docs/product/pitch-script.md`、`docs/process/submission.md` |
| 人の判断を頼む・記録する | `todo/humans/README.md` | |
| ハーネスを直す（hooks、CI、ガード） | `docs/process/README.md`、`docs/process/ops-checklist.md` | `docs/process/tools.md`（AI ごとの設定） |

文書の全体の地図は `docs/README.md`。

## 記録すること

- 技術選定：`docs/architecture/decisions.md`。決めるのは人。AI の提案をそのまま採用した決定として書かない
- AI の使いどころ：`docs/records/ai-usage.md`。提出ドキュメントの必須項目になる
- ライブラリ・素材の出典とライセンス：`docs/records/credits.md`。著作物利用シートの元になる
