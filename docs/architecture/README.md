# 技術の入口

どう作るかを知るときに読む文書の案内です。どう作るかの原本は[技術構成の artifact](https://claude.ai/artifact/V2HQqotX1paAXFZgTYxjDN) で、[sources/architecture.html](sources/architecture.html) はそのコピーです。

| 読むもの | 何が分かるか |
| --- | --- |
| [design-principles.md](design-principles.md) | コードの組み立て方（フロントの FSD、バックエンドの縦のスライス、例外の書き方） |
| [sources/architecture.html](sources/architecture.html) | 全体の構成、データ設計、参加と権限、費用の上限、開発環境とデプロイ |
| [decisions.md](decisions.md) | 技術選定の記録（選んだ理由と、やめた案） |
| [sources/map-options.html](sources/map-options.html) | 地図の 2 案の比較 |
| [sources/feasibility.html](sources/feasibility.html) | 規約と 3D 生成のフィジビリティ検証 |
| `docs/process/setup.md` | 開発環境、ローカルと本番の差、費用の注意 |

## 要点

- フロントエンド：React + TypeScript（Vite）、three.js。スマホ優先の PWA。Firebase Hosting で配信
- バックエンド：Cloud Functions（第 2 世代）、Firestore、Authentication（匿名）
- AI：Gemini（場所とルートの提案）、Gemini 4 Argon（模型の JSON）。AI が書いたコードは実行しない
- データ設計（技術構成より）：`trips/{tripId}` の下に `members`、`wishes`、`pins`（その下に `model/current`）、`routes`（その下に `votes`）。ほかに `modelCache`、`usage`（呼び出し回数）
- 費用：Gemini の呼び出しはログイン済みの Functions に限り、回数の上限を付ける。予算アラートは通知だけで止まらない

技術の決定を変えるときは、技術構成の artifact と decisions.md を更新し、企画書に影響があれば企画書も同じ変更で直します。技術の選定は人が決めます。
