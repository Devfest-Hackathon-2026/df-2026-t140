# 作業の流れ

人も AI も、すべての変更をこの流れで行います。Claude Code では `start-work` の skill が同じ手順を案内します。

## 1. 始める前に、ほかの作業と未着手の Issue を見る

```sh
npm run work -- status
```

ほかの人と AI の進行中の作業（紐づく Issue 番号と PR）、未着手の Open Issue 一覧（バックログ）、触る範囲、実際に変えたファイル、自分の作業との重なり、人の判断待ちが出ます。Claude Code、Codex、Antigravity（フックが有効なとき）は、セッションの始めに同じ内容が自動で出ます。

未着手の Issue のうち、レビューの残りの小さな直しのように人の判断が要らないものは、人に「着手しますか」と聞かずに AI が着手し、merge まで進めます（会話で人と合意した作業として扱う。かめの希望、2026-11-16）。聞くのは、費用・方針・権限など「人にしかできないこと」に当たるものと、ほかの人が担当しているものだけです。

### 開発タスクを GitHub Issue に起票する

開発タスクはすべて GitHub Issue に起票し、エージェントに作成・着手を任せます。先にタスクを洗い出してバックログとして登録するときは：

```sh
npm run work -- issue --title "旅の作成画面（S01）" --kind feat --goal "S01 で旅を作れるようにする" --done "2 つ目のブラウザで同じ旅に入れる" --scope "web/src/features/create-trip/**"
```

- Issue に付くラベルは種類（`feat` など）だけです。状態はカンバンの列（Todo / In Progress / 人間待ち / Done）だけで表し、GitHub Actions が動かします（下の「カンバン」）
- 人の判断を待っている Issue は、カンバンの「人間待ち」の列に置かれ、Issue に「⏸ 人間待ち」のコメントが付きます
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

既存の Issue に着手するときは `--issue <番号>` を付けます（Issue のタイトル・目的・やること・完了条件・scope を作業宣言の下書きへ自動で引き継ぎます）：

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

- `issue` 欄がまだ空なら、作業宣言の内容から自動で GitHub Issue を起票して番号を書き込みます
- 宣言を commit・push し、宣言だけの PR を作って main に入れます（docs/work/ だけを変える PR は、CI やレビューを待たずに merge します。デプロイと CI の重い確認は走りません）
- 続けて、`Closes #<Issue番号>` つきの作業用の PR を、「作業中」ラベルを付けて作ります（リポジトリは Free の Organization にあり、private では Draft PR が使えないため。`finish` がラベルを外します）。作業の前に Issue と PR がある状態になります
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

完了条件、機械のチェック、push、手元の確認（下の「手元の確認」）を確かめ、PR をレビュー待ちにし、PR の説明に紐づく GitHub Issue を書きます。ふつうは `Closes #<番号>` で、merge すると Issue も閉じます。人間待ちが残る Issue は `Refs #<番号>` にし、merge しても閉じません（人の判断が済むと Actions が閉じます）。満たせなかった完了条件は「（未達：理由）」と書きます。

### 手元の確認（AI は必ず行う）

`finish` は、レビュー待ちにする前に、CI と同じ確認を手元で走らせます（`npm run verify:local`。単体でも実行できます）。通らなければ、レビュー待ちにしません。AI は、CI が動いているときも、必ずこの確認を通してから作業を終えます（Youkin06 の決定、2026-11-21。`todo/humans/2026-11-21-local-verify-policy.md` の A）。

- 走らせるもの：CI の 2 つのジョブと同じ。harness（`npm run test:harness` と、機械のチェック）と、verify（`npm run verify`：lint、build、テスト、Emulator の通し確認）。文書やハーネスの設定だけの変更では、CI と同じく verify は走らせません
- Emulator は、いつもポートを 10000 ずらして走ります。既定のポートは、この Mac のセルフホストランナーの Deploy に空けておくためです（手元の確認が先に既定のポートを取ると、Deploy が「port taken」で落ちる。かめの決定、2026-11-23）。10000 ずらしたポートがふさがっていれば（ほかの手元の確認、`npm run dev:alt`）20000 ずらし、それもふさがっていれば止まるので、ほかの確認が終わるのを待つか `npm run dev:alt` を止めてからやり直します
- 通ると、確かめた commit の番号つきの記録（`harness-verify` の目印）を PR のコメントに残します。commit していない変更があるとき、push していないときは記録しません。commit を足したら、もう一度走らせます
- 記録は、実装した AI が自分で残すものです（レビューの目印と同じく、手順を飛ばさないための確認で、改ざんへの防御ではありません）。merge の条件はこの記録です（下の「merge の条件と CI」）

### merge の条件と CI

merge の条件は、CI ではなく、今の先頭の commit の手元の確認の記録です（Lazyturtle0852 の決定、2026-11-22。`todo/humans/2026-11-22-ci-at-deploy-no-discord.md`）。CI（`ci.yml`、`harness.yml`）は PR と main への push では走らせません。`npm run verify`（lint、build、テスト、Emulator）は、本番への反映（deploy ブランチ）のときに Deploy がまとめて確かめます。ハーネスのチェック（`npm run test:harness`、機械のチェック）は Deploy では走らず、手元の確認の記録だけになります。セルフホストランナーに CI が詰まり、Deploy が後回しになったため。

- ガードは、レビューの承認、先頭の commit の手元の確認の記録、main とぶつからないこと、作業中でないことを確かめます。CI が順番待ち・ない、は止めません
- CI を Actions の画面から手で走らせて落ちた結果があれば、止めます（始まらなかっただけ（支払い・利用上限）のものは除く）
- 記録は、実装した AI が自分で残すものです。別の機械での確認にはならないので、本番に出す前の Deploy の verify が最後の確認になります

レビューは、実装したのとは別のコンテキストで行います（Claude Code なら `/review-pr <番号>`、ほかの AI は [reviewer.md](reviewer.md)）。指摘は、人の判断が要るものと PR の目的から外れる大きな作業を除いて、minor も別の Issue に切り出さず同じ PR で直します（かめの希望、2026-11-16。`.claude/skills/review-pr/SKILL.md` の 5）。レビューの結論が APPROVE になり、先頭の commit の手元の確認の記録があれば、会話で人と合意した作業なら、人の merge 指示を待たずに merge します（`gh pr merge <番号> --merge`。`todo/humans/2026-11-07-merge-on-chat-agreement.md`。それまでの「指示がなければ merge しない」は `todo/humans/2026-11-07-merge-case-by-case.md`）。合意がない作業と、人が「merge しない」と言った作業は、ここで止めて人に伝えます。条件を満たさない merge はガードが止めます。

main に merge しても本番は変わりません。本番へ出すのは、人が main を `deploy` ブランチへ反映したときだけです（かめの決定、`todo/humans/2026-11-07-deploy-branch.md`）。AI は deploy に push も merge もしません。本番で確かめたい変更があるときは、PR か会話で人に反映を頼みます（手順は [setup.md](setup.md)「本番への反映」）。反映のあとでしか確かめられない確認は、`npm run human -- prod-check` で、本番での確認のまとめの 1 件に足して頼みます（確認ごとに別の項目や Issue を作りません。[todo/humans/README.md](../../todo/humans/README.md)「本番に出したあとでしか確かめられないこと」）。

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

### カンバン

作業の状態は、GitHub Projects のカンバン（[Project #1「Konbu_DevFest」](https://github.com/users/Lazyturtle0852/projects/1)）の列だけで表します（かめの決定、2026-11-16。前は `status:*` ラベルと二重に持っていて食い違ったので、ラベルはやめました）。カンバンを動かすのは GitHub Actions（`.github/workflows/kanban.yml`）だけで、各自の gh に project の権限は要りません。

| 列 | 意味 | どう決まるか |
| --- | --- | --- |
| Todo | まだ誰も着手していない | 開いていて、下のどれにも当たらない Issue |
| In Progress | AI が作業中（PR のレビュー中も含む） | 進行中の作業宣言か、開いた PR が紐づいている。または、止めていた人の判断が決まった（すぐ作業に戻るので、Todo に戻さない。判断を頼んだ人が担当に付く。Issue が閉じるまで続く） |
| 人間待ち | 人の判断・作業がないと進まない | todo/humans/ の open な判断の `blocks` に `#番号` がある、または人の作業として起票した Issue |
| Done | 全部終わった | Issue が閉じた |

- 決め方は `scripts/harness/lib/board.mjs` の 1 か所で、Actions とセッションの始めの一覧が同じ関数を使います。正本は一次の記録（todo/humans/、作業宣言、Issue と PR）で、カンバンはそれを映すだけです
- 人間待ちの Issue（と `blocks` に書いた PR）には「## ⏸ 人間待ち：…」のコメントが付き、必要なこと・止まっていること・終わったらどうするかが出ます。決まると同じコメントが「## ✅ 決まりました：…」に変わります
- PR の merge は、Issue を閉じることを意味しません。人間待ちが残る Issue を `Closes` する PR は `Refs` に書き換わり、閉じてしまった Issue は開け直されます。人の判断が済むと、残りの作業がなければ Actions が閉じます
- merge された作業は、作業宣言が「進行中」のままでも完了とみなし、ほかの作業の一覧と重なりの警告から外します
- 担当（assignee）は、前もって割り振らず、着手した人が自動で付きます（かめとの合意、2026-11-16）。進行中の作業宣言が紐づいた Issue に、作業宣言の `owner` の人を GitHub の担当として足します。`owner` は git の名前（例：Takana）なので、名簿 `scripts/harness/members.json` で GitHub のアカウント（Takana-12）を引きます。名簿にない人は、作業の PR の作者で代えます。足すだけで外さないので、人が手で付けた担当は残ります。新しい人が加わったら名簿に足します。同期が動くのは作業宣言が「進行中」のあいだだけなので、宣言から完了までのあいだに同期が一度も動かない短い作業では、担当が付かないまま閉じることがあります（それでよいとしています）
- Actions が動くのは、`docs/work/` か `todo/humans/` か名簿が変わった main への push、Issue の開け閉め、1 日 1 回、`npm run human -- sync` のときです。カンバンの列を動かすには、リポジトリの secret `KANBAN_TOKEN`（project の権限を持つトークン）が要ります。ないときもコメントと Issue の開け閉めは動きます

### Discord への通知

Discord への通知はやめました（Lazyturtle0852 の決定、2026-11-22。`todo/humans/2026-11-22-ci-at-deploy-no-discord.md`）。`notify.yml` を消し、`kanban.yml` は Discord の Webhook を渡さないので、カンバンの同期も Discord に送りません。文面と送る処理（`scripts/harness/lib/discord.mjs`、`notify-discord.mjs`）は、戻すときのために残しています。

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
| `no-ai-merge` | 条件を満たさない merge（作業中＝ドラフトか「作業中」ラベル、CI が未通過（CI のジョブが始まらなかったときは、手元の確認の記録がない）、main とぶつかる、レビューの承認がない、レビューのあとに commit が増えた、--admin） | `npm run work -- finish` でレビュー待ちにし、`/review-pr` で承認を得て、CI を待つ。merge は会話で人と合意した作業の PR だけ（合意がなければ人に伝える） |
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
