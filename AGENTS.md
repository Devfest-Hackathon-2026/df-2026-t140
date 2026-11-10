# AGENTS.md

このリポジトリのルールの原本は CLAUDE.md です。ここには書き写さず、道案内だけを置きます。Claude Code 以外の AI（Codex、Antigravity など）も、作業の前に必ず CLAUDE.md を読みます。

@[CLAUDE.md](CLAUDE.md)

## Claude Code 以外の AI が気をつけること

- セッションの始めに `npm run work -- sync` で main の最新を取り込み、`npm run work -- status` でほかの人と AI の作業、未着手の GitHub Issue、重なり、人の判断待ちを確かめる（フックが有効なら、どちらも自動で行われる）
- 危険な命令を止めるガードは、ツールのフックが有効なときだけ効く。commit と push の前の git hooks と、PR の CI は、どの AI にも効く
- 手順は `.agents/skills/` の skill（start-work、review-pr、ask-human）と `docs/process/` にある
- レビューを頼まれたら、実装とは別のセッション（Codex と Antigravity は reviewer サブエージェント）で `docs/process/reviewer.md` に従う
- ツールごとの設定と、最初に 1 回だけ要る操作（フックの信頼など）は `docs/process/tools.md`

## 最初に確かめること

- main では編集・commit・push しない。`npm run work -- start <種類>/<内容>` で作業ブランチを作る
- 企画書 `docs/product/proposal.md` を正本とし、変更や決定は最初に企画書を直す
- 費用、有料 API、方針、.env、権限が関わる判断は `todo/humans/` に書いて人に任せる
- 提出用リポジトリへ開発用の履歴を push しない
