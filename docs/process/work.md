# 作業の流れ

人も AI も、すべての変更をこの流れで行います。Claude Code では `start-work` の skill が同じ手順を案内します。

## 1. 始める前に、ほかの作業と未着手の Issue を見る

```sh
npm run work -- status
```

ほかの人と AI の進行中の作業（紐づく Issue 番号と PR）、未着手の Open Issue 一覧（バックログ）、触る範囲、実際に変えたファイル、自分の作業との重なり、人の判断待ちが出ます。Claude Code、Codex、Antigravity（フックが有効なとき）は、セッションの始めに同じ内容が自動で出ます。

### 開発タスクを GitHub Issue に起票する（カンバン連動）

開発タスクはすべて GitHub Issue に起票し、エージェントに作成・着手を任せます。先にタスクを洗い出してバックログとして登録するときは：

```sh
npm run work -- issue --title "旅の作成画面（S01）" --kind feat --goal "S01 で旅を作れるようにする" --done "2 つ目のブラウザで同じ旅に入れる" --scope "web/src/features/create-trip/**"
```

- Issue には自動でカンバン用の状態ラベル（起票時は `status:todo`、着手時は `status:in-progress`、レビュー待ち時は `status:review`）と種類のラベル（`feat` など）が付きます
- 人の判断を待っている Issue は、カンバンの「人間待ち」の列に置かれます（`npm run human`。下の「カンバンの「人間待ち」」）
- GitHub Projects（Board ビュー）や Issue 一覧で、誰のどのエージェントがどのタスクを進めているかをひと目で追えます
- 事前に Issue を作らずに `npm run work -- start` で始めた場合も、`npm run work -- declare` が作業宣言の内容から自動で GitHub Issue を起票して紐づけます

### main の最新を取り込む

AI は作業の始めに、main の最新を今のブランチへ取り込みます。古い main の上で作業して、あとでぶつかったり、もう直った不具合を直し直したりしないためです。

```sh
npm run work -- sync
```

- フックが有効な AI（Claude Code、Codex、Antigravity）は、セッションの始めに自動で行います。結果はセッションの始めの「立ち位置」に出ます。Claude Code で会話を再開したとき（resume）と、会話を圧縮したとき（compact）は、作業の途中で気づかないうちに main が入らないよう、取り込まずに遅れだけを知らせます
- main は fast-forward だけ、作業ブランチは `git merge origin/main` です（rebase と force push はしません）。merge の commit は次の push で送ります
- merge が時間内に終わらなかったときは、途中の merge を `git merge --abort` で戻し、そう知らせます
- 未 commit の変更があるとき、merge や rebase の途中のときは、何もしません。人が作業中かもしれないためです。commit してから `git merge origin/main` で取り込みます
- ぶつかるときは `git merge --abort` で元に戻し、ぶつかったファイルを伝えます。作業の前に `git merge origin/main` でぶつかりを直します

## 2. ブランチと作業宣言を作る

既存の Issue に着手するときは `--issue <番号>` を付けます（Issue のタイトル・目的・やること・完了条件・scope を作業宣言の下書きへ自動で引き継ぎ、Issue のラベルを `status:in-progress` にします）：

```sh
npm run work -- start feat/trip-create --issue 12
```

まだ Issue がない作業を始めるときは `--title` を指定します（次の `declare` で Issue が自動起票されます）：

```sh
npm run work -- start feat/trip-create --title "旅の作成画面（S01）"
```

- 作業ブランチを origin/main から作り、作業宣言の下書き（この例なら docs/work/feat-trip-create.md）を置きます
- main で人が作業していた（未 commit の変更や、push していない commit がある）ときは、消さずにそのまま新しいブランチへ移します。main は origin/main に戻します
- ほかのブランチに未 commit の変更があるときは止まります。そのブランチの作業なら commit して push し、新しい作業に持っていくなら `--carry` を付けます

### ブランチ名

`<種類>/<内容>` の形にします。これまでの `chore/local-prod-parity`、`docs/screen-flow` と同じ形です。

| 種類 | 使うとき |
| --- | --- |
| feat | 機能を足す |
| fix | 不具合を直す |
| docs | 文書だけを変える |
| chore | 設定や道具を変える |
| refactor | 動きを変えずに書き直す |
| test | テストだけを足す |
| perf | 速くする |
| ci | CI を変える |

内容は英小文字・数字・ハイフンで、60 文字以内です（例：`feat/trip-create`、`fix/pin-sync`）。

## 3. 作業宣言を書いて、main に入れる

下書きの次の欄を書きます。書き方の詳細は [docs/work/README.md](../work/README.md) にあります。

- 目的：何のためか。企画書や画面のどこに当たるか
- scope：触るファイル（グロブ可）。ほかの AI は、ここを見て作業を分けます
- 完了条件：「動いた」ではなく、確かめられる条件。レビューはこれで測ります
- 正本への影響：企画書や技術構成を直す必要があるか
- 他の作業との調整：`status` で重なった作業と、どう分けたか

```sh
npm run work -- declare
```

- `issue` 欄がまだ空なら、作業宣言の内容から自動で GitHub Issue を起票して番号を書き込み、`status:in-progress` ラベルを付けます
- 宣言を commit・push し、宣言だけの PR を作って main に入れます（docs/work/ だけを変える PR は、CI やレビューを待たずに merge します。デプロイと CI の重い確認は走りません）
- 続けて、`Closes #<Issue番号>` つきの作業用のドラフト PR を作ります。作業の前に Issue と PR がある状態になります
- 重なる作業があるのに「他の作業との調整」が空だと止まります

## 4. 作業する

- 設計は [design-principles.md](../architecture/design-principles.md) に従います。ファイルを書き換えるたびに層のチェックが走り、違反はその場で知らされます
- 方針から外れるときは、ファイル内に `@harness-exception` で理由を書きます
- 区切りごとに commit して push します。ほかの AI が進み具合を見られるようにするためです。Claude Code は、変更を残したまま終わろうとすると一度止まって知らせます
- main の変更は `git merge origin/main` で取り込みます（rebase と force push はしません）
- 費用、有料 API、方針、.env、権限の判断が要ったら、`npm run human -- add` で人に頼み、ほかの作業を続けます

### commit メッセージ

1 行目は `<種類>: <日本語の説明>` です（例：`feat: 旅の作成画面を追加する`）。種類はブランチ名と同じものに、build、style、revert を足したものです。

### 共有ファイル

次のファイルは複数の作業がよく同時に触ります。重なったら、小さな PR で先に merge してもらうか、担当を分けます。

`firestore.rules`、`storage.rules`、`firestore.indexes.json`、各 `package.json` と `package-lock.json`、`web/src/app/**`、`functions/src/index.ts`、`functions/src/app/**`、`docs/product/proposal.md`、`CLAUDE.md`

package-lock.json がぶつかったら、手で直さず、main を取り込んだあと `npm install` で作り直します。

## 5. 終える

作業宣言の status を `完了`（やめたなら `中止`）にし、完了条件に印を付け、「## 結果」にやったこと・確かめたこと・残したことを書いてから：

```sh
npm run work -- finish
```

完了条件、機械のチェック、push を確かめ、PR をレビュー待ちにし、紐づく GitHub Issue のラベルを `status:review` にします（PR が `main` に merge されると `Closes #<番号>` で Issue も自動で Close されます）。満たせなかった完了条件は「（未達：理由）」と書きます。

レビューは、実装したのとは別のコンテキストで行います（Claude Code なら `/review-pr <番号>`、ほかの AI は [reviewer.md](reviewer.md)）。blocker と major を直し、レビューの結論が APPROVE になり、CI がすべて通ったら、会話で人と合意した作業なら、人の merge 指示を待たずに merge します（`gh pr merge <番号> --merge`。`todo/humans/2026-11-07-merge-on-chat-agreement.md`。それまでの「指示がなければ merge しない」は `todo/humans/2026-11-07-merge-case-by-case.md`）。合意がない作業と、人が「merge しない」と言った作業は、ここで止めて人に伝えます。条件を満たさない merge はガードが止めます。

main に merge しても本番は変わりません。本番へ出すのは、人が main を `deploy` ブランチへ反映したときだけです（かめの決定、`todo/humans/2026-11-07-deploy-branch.md`）。AI は deploy に push も merge もしません。本番で確かめたい変更があるときは、PR か会話で人に反映を頼みます（手順は [setup.md](setup.md)「本番への反映」）。

## 人の判断（todo/humans/）は main に直接入れる

`todo/humans/` だけを変えるとき（判断を頼む、決まった判断を done にする）は、ブランチも作業宣言も PR も作らず、main に直接入れます。判断をすぐ全員の AI に届けるためです（Takana の決定、`todo/humans/2026-11-07-humans-direct-main.md`）。デプロイは走らず、CI（Harness）が形を確かめます。

会話で人が AI とすり合わせて決めたら、それで決定です。AI がその場で記録し、main まで入れます。人に git の命令を打ってもらったり、別に承認をもらったりはしません（ハッカソンでは待ち時間のほうが高くつくため。かめの決定、`todo/humans/2026-11-08-decide-in-chat.md`）。

```sh
# 決まった判断を記録する。記録したあと、今のブランチのまま main まで入れる
npm run human -- done <名前> --decision "…" --by <決めた人> --reason "…"
# 新しく頼む・書き足すとき：ファイルを書いてから、今のブランチのまま main へ入れる
npm run human -- add <名前> --title "…" --kind …
npm run human -- publish <名前>
```

- `publish`（と `done`）は、origin/main の上に一時的な作業ツリーを作り、todo/humans/ のファイルだけを commit して `git push origin HEAD:main` します（`scripts/harness/lib/publish-humans.mjs`）。git の pre-push フックが「todo/humans/ だけの早送り」かを確かめます。ほかの人が先に main を進めていたら、取り直して 3 回までやり直します
- 入れたあと、手元のファイルは元に戻し、ほかに未 commit の変更がなければ origin/main を取り込みます。未 commit の変更があれば、あとで `npm run work -- sync` で取り込みます
- todo/humans/ の下の .md 以外は入れません。手で入れるときは、main の上で todo/humans/ のファイルだけを stage して commit し、`git push origin main` します（add、commit、push は && でつながない）
- 判断に合わせてほかの文書（decisions.md、企画書など）も直すときは、そちらはいつもどおり作業ブランチと PR で行います
- 作業ブランチの上で todo/humans/ を変えた場合は、そのまま PR に含めて構いません

### カンバンの「人間待ち」

`npm run human -- add` と `done` は、GitHub Projects のカンバンの Status も動かします。

- `add --blocks "#12 …"`：Issue #12 を「人間待ち」に置きます。`#番号` がなければ、人の作業そのものを Issue（ラベル `人間待ち`）として起票して「人間待ち」に置き、番号をファイルの `issue:` に書き戻します。書き戻した `issue:` も一緒に commit します
- `done`：待っていた Issue を「In Progress」に戻し（ほかの open な判断がまだ止めていれば戻しません）、人の作業の Issue は閉じます
- カンバンを動かせなかったとき（gh の project スコープがない、オフライン）は警告だけ出ます。直したら `npm run human -- sync` で載せ直します。スコープは各自 1 回 `gh auth refresh -h github.com -s project` で付けます
- 「人間待ち」の一覧は、セッションの始めと `npm run work -- status` に出ます

## 作業宣言のないブランチ

前からあるブランチや、人が作ったブランチには宣言がないことがあります。push と CI で止まるので、今の変更から宣言を作ります。

```sh
npm run work -- adopt
```

## 止められたとき

ガードが止めたら、表示された理由と代わりの手順に従います。迂回はしません。止めたことはトレース（`.harness/trace/`）に残ります。

| ルール | 止めること | 代わりにすること |
| --- | --- | --- |
| `no-push-main` | main への push（todo/humans/ だけを変えた commit は除く） | 作業ブランチに push して PR を出す |
| `no-push-deploy` | deploy ブランチへの push（`main:deploy` などの refspec も）、deploy の上での commit と merge、deploy への PR の merge | main に入れるところまで行い、本番への反映は人に頼む（[setup.md](setup.md)「本番への反映」） |
| `no-commit-on-main` | main での commit と merge（todo/humans/ だけを stage した commit は除く） | `npm run work -- start` で作業ブランチを作る |
| `no-edit-on-main` | main でのファイルの編集（todo/humans/ は除く） | 同上（未 commit の変更はそのまま移る） |
| `no-force-push` | force push | `git merge origin/main` で取り込んでから push |
| `no-verify-bypass` | `--no-verify`、core.hooksPath の変更 | hooks に止められた理由のほうを直す |
| `no-destructive-git` | reset --hard、clean -f、checkout .、branch -D、リモートのブランチの削除 | ファイルを指定して `git restore <ファイル>` か `git stash` |
| `branch-name` | 決まりに合わないブランチ名 | `<種類>/<内容>` にする |
| `no-ai-merge` | 条件を満たさない merge（ドラフト、CI が未通過、main とぶつかる、レビューの承認がない、レビューのあとに commit が増えた、--admin） | `npm run work -- finish` でレビュー待ちにし、`/review-pr` で承認を得て、CI を待つ。merge は会話で人と合意した作業の PR だけ（合意がなければ人に伝える） |
| `no-ai-approve` | AI による PR の承認 | レビューの結果はコメントで残す |
| `no-deploy` | 手元からのデプロイ、本番の確認テスト、Deploy のワークフローを走らせる | 人が deploy ブランチへ反映したあとに GitHub Actions が行う |
| `no-paid-api` | 有料 API の直接の呼び出し、Cloud の Gemini を本物にする設定 | `npm run human -- add` で人に頼む |
| `no-cloud-change` | Google Cloud・Firebase の設定、上限、課金、権限、本番データの削除 | 同上 |
| `no-repo-admin` | リポジトリの設定、secret、variable | 同上 |
| `no-submission-push` | 提出用リポジトリへの push | [submission.md](submission.md) の手順で人が行う |
| `no-history-rewrite` | 履歴の書き換え（filter-repo など） | 同上 |
| `no-secret-read` | .env などの中身を読む（命令でも、Read や Grep の道具でも） | 変数の名前は .env.example で確かめ、値は人に頼む |
| `no-secret-files` | .env などを書く | 同上 |
| `no-dangerous-rm` | プロジェクトそのものや外を消す | 消すのはプロジェクトの中の生成物だけ |
| `no-other-ai-sdk` | 他社 AI の SDK をプロダクトに入れる | Gemini を使う |
| `no-inline-git` | node -e などの中から git や gh を動かす | 命令として直接書く |
| `no-local-dir` | `.local/`（運営資料）を書き換える | 読むだけにする |
| `no-git-internals` | `.git/` の中を直接書き換える | git の命令を使う |
| `artifact-copy` | artifact のコピーを直接編集する（人に確認） | 原本の artifact を直してからコピーを取り直す |
| `harness-change` | ガードレールの設定やスクリプトを変える（人に確認） | 弱める変更でないかを人が確かめる |
| `harness-config` | `harness.config.json`（自動で進めてよい期間など）を AI が変える | 人に頼む（`npm run human -- add`） |
