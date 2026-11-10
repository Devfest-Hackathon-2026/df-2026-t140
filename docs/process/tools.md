# AI ツールごとの設定

同じハーネスを、Claude Code、Codex（ChatGPT）、Antigravity、Gemini CLI から使えるようにしています。判断の本体は `scripts/harness/lib/` の 1 つだけで、ツールごとの違いは入出力の形をそろえるアダプター（`scripts/harness/hook.mjs <ツール> <イベント>`）と、各ツールの設定ファイルだけです。ルールを直すときは lib/ だけを直します。

## 何が効くか

| | Claude Code | Codex | Antigravity | Gemini CLI |
| --- | --- | --- | --- | --- |
| 指示の読み込み | CLAUDE.md（自動） | AGENTS.md（自動）＋セッションの始めのフックが CLAUDE.md を渡す | AGENTS.md（自動）が `@[CLAUDE.md](CLAUDE.md)` で CLAUDE.md を取り込む | GEMINI.md（自動）が `@./CLAUDE.md` で取り込む |
| セッションの始めの立ち位置 | ✓ | ✓ | ✓ | ✓ |
| 命令のガード | ✓（Bash、PowerShell） | ✓（Bash） | ✓ | ✓ |
| 編集のガード | ✓ | ✓（apply_patch） | ✓ | ✓ |
| 秘密情報のファイルを読む道具のガード | ✓（Read、Grep） | — | ✓（read_file、view_file、grep_search） | — |
| 編集の直後の層のチェック | ✓ | — | — | — |
| 終わる前の commit・push の確認 | ✓ | — | — | — |
| 画面の文言を足したら yomiyasu を思い出させる（止めない。`docs/ui/README.md`） | ✓ | — | — | — |
| 手順（skill） | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` |
| レビュー役 | `.claude/agents/reviewer.md` | `.codex/agents/reviewer.toml` | `.agents/agents/reviewer.md` | 別のセッションで `docs/process/reviewer.md` |
| git hooks と CI | ✓ | ✓ | ✓ | ✓ |

確かめた範囲：Claude Code は、このリポジトリで実際にフックが止めることを確かめました。Codex、Antigravity、Gemini CLI は、各ツールの公式の文書（2026-11-07 に確認）にある入力の形でアダプターをテストしていますが、ツールそのものでは動かしていません。初めて使う人は、下の「最初に 1 回」で動くことを確かめてください。

共通の skill は `.agents/skills/`（Codex、Gemini CLI、Antigravity が読む場所）が原本で、Claude Code 用に `.claude/skills/` へ同じものを写しています。片方を直したらもう片方へ写します（CI が中身の一致を確かめます）。Claude Code だけの skill（`.claude/skills/` にしかないもの）はそのままで構いません。

## 最初に 1 回

どのツールでも、まず `npm run setup`（`mise exec -- npm run setup`）で git hooks を有効にします。`npm ci` のときに `core.hooksPath` が `.githooks` になります。

### Claude Code

- `.claude/settings.json` のフックと権限は、ワークスペースを信頼すると有効になります
- 確かめ方：`git push origin main --dry-run` を頼むと、ガードが理由つきで止めます
- ターミナルの pane（Ghostty の split、tmux の window）の名前を、今の作業の名前（作業宣言の title、なければブランチ名）にします。セッションの開始、プロンプトの送信、ツールの実行のたびに `scripts/harness/lib/pane-title.mjs` が書き換えるので、途中でブランチを変えても追いつきます。Claude Code 自身のタイトル更新は `CLAUDE_CODE_DISABLE_TERMINAL_TITLE` で止めています。要らないときは `HARNESS_PANE_TITLE=0`

### Codex

- フックは `.codex/hooks.json`。プロジェクトを信頼し、`/hooks` で各フックを信頼すると有効になります（フックの中身が変わると信頼し直しが要ります）
- レビュー役は `.codex/agents/reviewer.toml`
- Windows では、フックは Codex を起動したフォルダ（リポジトリの直下）で動く前提です

### Antigravity

- フックは `.agents/hooks.json`（有効にしてあります）。Antigravity は `hooks.json` のあるフォルダ（`.agents/`）で命令を動かすため、`git rev-parse --show-toplevel` でリポジトリの直下を引いています
- 命令の許可（allow、ask、deny）はユーザーごとの設定（`~/.gemini/antigravity-cli/settings.json`）にもあります。各自が次を入れておくと、二重に事故を防げます

  ```json
  { "permissions": { "deny": ["command(git push --force)", "command(git push origin main)", "command(firebase deploy)", "write_file(.env)"] } }
  ```

### Gemini CLI

- 個人の Google アカウントでの利用は 2026-06 に終わり、API キーか企業向けのライセンスが要ります。Google は Antigravity への移行を勧めています
- フックは `.gemini/settings.json`。新しいフックや変わったフックは、動く前に警告が出ます

## アダプターの入出力

| ツール | フックの設定 | 命令の入力 | 編集の入力 | 止めるときの出力 |
| --- | --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | `tool_input.command`（Bash、PowerShell） | `tool_input.file_path` | `hookSpecificOutput.permissionDecision: deny` |
| Codex | `.codex/hooks.json` | `tool_input.command`（Bash） | apply_patch の本文の `*** Update File:` など | Claude Code と同じ |
| Antigravity | `.agents/hooks.json` | `toolCall.args.CommandLine`（run_command） | `toolCall.args.TargetFile` | `decision: deny`（通すときも必ず `decision: allow` を返す） |
| Gemini CLI | `.gemini/settings.json` | `tool_input.command`（run_shell_command） | `tool_input.file_path`（write_file、replace） | `decision: deny` |

新しいツールを足すときは、`scripts/harness/hook.mjs` の normalize と respond に 1 つずつ足し、`scripts/harness/tests/adapters.test.mjs` に入力の例を足します。
