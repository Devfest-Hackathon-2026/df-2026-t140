# ハーネスの全体像

4 人がそれぞれ AI で並行して開発するための仕組みです。目的は、**人に聞かなくても、各 AI が自分の立ち位置（誰の端末で、どの作業をしていて、ほかに誰が何をしているか、何をしてよいか）を分かり、ぶつからず、壊さず、失格につながることをしないこと**です。

プロンプトや文書に「〜しないで」と書いても、守られる保証はありません。絶対に守らせたいことは、フック、git hooks、CI、権限で止めます。AI を賢くするより、危険なことをさせない形にします。

## 4 つの層

1 つの層が漏れても、次の層で止まるように重ねています。

| 層 | 効く相手 | 止めるもの | 迂回できるか |
| --- | --- | --- | --- |
| 1. AI ツールのフックと権限 | Claude Code、Codex、Gemini CLI、Antigravity（設定したもの） | 危険な命令（main と deploy への push、force push、--no-verify、reset --hard、デプロイ、有料 API、.env）、main での編集、ガードレールの書き換え | ツールの外で動かせば迂回できる |
| 2. git hooks（`.githooks/`） | すべての AI と人 | main への commit と push、秘密情報、置いてはいけないファイル、commit の形、ブランチ名、force push（deploy への反映も早送りだけ）、作業宣言のない push、層の違反 | `--no-verify`（AI は層 1 が止める） |
| 3. CI（`.github/workflows/harness.yml`） | すべての PR | 層の違反、作業宣言、ブランチ名、秘密情報、他社 AI の SDK、文書のリンク切れ、人の判断の書き方 | できない（GitHub 上で動く） |
| 4. レビュー | merge の前 | 完了条件を満たしたか、正本と合っているか（別のコンテキストのレビュー役と人）。AI の merge は、会話で人と合意した作業で、CI が通り、レビューで承認された PR（CI と承認はガードが確かめる。合意は確かめられない） | — |

main にはブランチ保護をかけません（Takana の決定、`todo/humans/2026-11-07-main-branch-protection.md`）。層 1〜3 が main を守ります。

本番へのデプロイは、人が main を `deploy` ブランチへ反映したときだけ GitHub Actions が行います（かめの決定、`todo/humans/2026-11-07-deploy-branch.md`）。main への merge では本番は変わりません。AI が deploy へ push・commit・merge するのは層 1 が止めます（`no-push-deploy`）。git hooks は人の反映を通すので、deploy への push を人に限るのは GitHub のブランチ保護で行います（人の作業、`todo/humans/2026-11-07-deploy-branch-setup.md`）。

人の判断（todo/humans/）は、GitHub Projects のカンバン（Project #1「Konbu_DevFest」）の Status「人間待ち」と連動します。`npm run human -- add` が止まっている Issue を「人間待ち」に置き（番号がなければ人の作業を Issue として起票し）、`done` が「In Progress」に戻します。セッションの始めと `npm run work -- status` に「人間待ち」の一覧が出ます。正本は todo/humans/ で、カンバンを動かせない（gh の project スコープがない、オフライン）ときは警告だけ出して記録は続けます（`scripts/harness/lib/kanban.mjs`、[todo/humans/README.md](../../todo/humans/README.md)「カンバンとの連動」）。

例外として、todo/humans/ だけを変える commit は main で作って直接 push してよく、層 1 と層 2 はこれを通します（ほかのファイルが混ざれば止めます）。層 3 は main への push でも、人の判断の書き方を確かめます（[work.md](work.md)「人の判断（todo/humans/）は main に直接入れる」）。

ガードは、止めるときに必ず「代わりにどうするか」を返します。夜中に人がいなくても、AI が止まったまま迷わないようにするためです。止めすぎると AI が迂回を探し始めるので、止めすぎも失敗として評価用の入力セットで測っています（`scripts/harness/tests/cases/guard-cases.mjs` の正常系）。

## AI が自分の立ち位置を知る仕組み

- セッションの始めのフックが、git の利用者、ブランチ、作業宣言、ほかの進行中の作業と重なり、未着手の GitHub Issue（バックログ）、人の判断待ちを AI に渡す（`scripts/harness/lib/session-context.mjs`）
- 同じフックが、main の最新を今のブランチへ取り込む（会話の再開と圧縮のときは取り込まず、遅れだけを伝える）。未 commit の変更があるとき、merge の途中のとき、ぶつかるときは何もせず、どうするかを AI に伝える（`scripts/harness/lib/sync-main.mjs`、`npm run work -- sync`）
- 情報は人が書いた要約ではなく、一次の記録から集める：main の作業宣言、各リモートブランチの宣言と実際に変えたファイル（git diff）、開いている PR と GitHub Issue
- CLAUDE.md は「必ず守ること」と「目的別の入口」だけにし、AI は作業に要る文書だけを読む
- 役割は 2 つ：実装する AI（ふつうのセッション）と、レビューする AI（別のコンテキストで、読み取りだけの道具で動く reviewer）

## 何を AI が決めてよいか

| 事柄 | AI が自分で決める | 進めて PR に書く | 人が決める（todo/humans/） |
| --- | --- | --- | --- |
| 実装の細部（名前、分け方、書き方） | ✓ | | |
| 設計方針からの例外 | | ✓ `@harness-exception` で理由を書く | |
| 企画書の未決のこと | | ✓ 仮の案を「議論済み」より下に書く | 最終の決定 |
| 技術の選定（新しいライブラリ、構成の変更） | | 比べた案を decisions.md に「仮」で書く | ✓ |
| 費用、有料 API、上限の変更 | | | ✓ |
| .env、秘密情報、Cloud・Firebase・GitHub の設定と権限 | | | ✓ |
| commit、push、PR の作成 | ✓ | | |
| merge（会話で人と合意した作業で、ドラフトでなく、CI が通り、ぶつからず、レビューで承認されたもの。人の merge 指示は待たない。合意がない作業と、人が「merge しない」と言った作業はレビューで止めて人に伝える。作業宣言だけの PR は `npm run work -- declare` が指示なしで入れる） | ✓ | | |
| 本番への反映（main から deploy ブランチへ）、手元からのデプロイ、PR の承認（GitHub の approve）、条件を満たさない merge | | | ✓ |
| ガードレール（hooks、CI、権限）を弱める変更 | | | ✓ |

## ファイルの地図

| 場所 | 中身 |
| --- | --- |
| `scripts/harness/lib/` | 判断の本体（ガード、層のチェック、作業宣言、人の判断、秘密情報、トレース）。依存なしの Node |
| `scripts/harness/hook.mjs` | AI ツールのフックの入口。ツールごとに入出力の形をそろえるだけのアダプター |
| `scripts/harness/git-hook.mjs`、`.githooks/` | git hooks |
| `scripts/harness/work.mjs`、`human.mjs` | `npm run work`、`npm run human`（カンバンとの連動は `lib/kanban.mjs`） |
| `scripts/harness/check.mjs`、`review-pack.mjs` | 機械のチェックと、レビュー役に渡すパック |
| `scripts/harness/tests/` | ハーネスの評価用の入力セット（正常系と異常系）とテスト |
| `evals/review/` | レビュー役（LLM の判断）の評価セット |
| `.claude/`、`.codex/`、`.agents/`、`.gemini/` | AI ツールごとの設定（`tools.md`） |
| `docs/work/`、`todo/humans/` | 作業宣言と、人の判断 |

## ハーネスを変えるとき

1. 作業宣言を出す（ハーネスの変更もほかの作業と同じ流れ）
2. ガードやチェックを変えたら、`scripts/harness/tests/cases/` に正常系と異常系を足し、`npm run test:harness` を通す
3. レビュー役の手順や評価軸を変えたら、`npm run eval:review` で評価セットを流し、前より悪くなっていないか確かめる
4. ガードレールの設定（`.claude/settings.json`、`.githooks/`、`scripts/harness/`、CI）を書き換えるときは、Claude Code が人に確認を求める。弱める変更は人が決める

運用の点検表（トレース、停止条件、ガードレール、評価、費用、人の確認）は [ops-checklist.md](ops-checklist.md) にあります。
