# 文書の地図

文書は目的ごとのフォルダに分けています。AI は全部を読まず、CLAUDE.md の「目的別の入口」から、今の作業に要るものだけを読みます。文書どうしが矛盾したら、何を作るかとなぜ作るかは企画書に、どう作るかは技術構成に従います。

| フォルダ | 何があるか | 提出用に出すか |
| --- | --- | --- |
| [product/](product/) | 企画書（何を・なぜの正本）、競合調査、ピッチ原稿 | 企画書は出す（内部向けの目印を整えてから） |
| [ui/](ui/) | 画面の作業の入口、画面イメージ・遷移図のコピー | コピー（screen-flow/）は出さない |
| [architecture/](architecture/) | 技術の入口、設計方針、技術選定の記録、技術構成のコピー | コピー（sources/）は出さない |
| [process/](process/) | 進め方（ハーネス、作業の流れ、レビュー、環境、提出、AI ごとの設定） | 出してよい |
| [contexts/](contexts/) | 背景（ハッカソンのルールの要約、チームのメモ、打ち合わせの記録） | 出さない |
| [records/](records/) | 提出物の元になる記録（AI の利用、出典とライセンス） | 出す |
| [work/](work/) | 作業宣言（いま誰が何をしているか） | 出さない |

リポジトリの直下の [todo/humans/](../todo/humans/) は、人にしかできない判断の一覧です（提出用には出さない）。提出用に出さないものの一覧の原本は `scripts/harness/lib/policy.mjs` の INTERNAL_PATHS です。

```text
企画書 product/proposal.md（何を、なぜ）
 ├─ 画面イメージ・遷移図 ui/（ユーザー体験を画面にしたもの）
 └─ 技術構成 architecture/（どう作るか）
     ├─ 根拠：地図の 2 案、フィジビリティ検証（sources/）
     ├─ 選定の記録：decisions.md
     ├─ 設計方針：design-principles.md（コードの組み立て方）
     └─ 実装：コード、process/setup.md
```

## 実装の計画

今夜の実装の順番と完了の条件は [process/dev-plan.md](process/dev-plan.md) にあります。

## 企画書

企画書の原本はリポジトリの [product/proposal.md](product/proposal.md) です。変更はプルリクエストで行い、差分をチームで確かめてから merge します。

Claude Doc の[旧企画書](https://claude.ai/artifact/6nkLaJUK9FcKudDM59EUms)は rev 707 で更新を止めました。冒頭の画像とコメントの履歴を見るときだけ使います。

企画の差別化を考えるときは、競合調査 [product/competitors.md](product/competitors.md) も読みます。

## artifact のコピー

この 4 つは Claude の artifact が原本です。リポジトリのものは、エージェントが読むためと、変更の差分を残すためのコピーです。コピーは直接編集しません（ハーネスが編集の前に確かめます）。

| 文書 | 役割 | 原本 | コピー | コピーした版 |
| --- | --- | --- | --- | --- |
| 画面イメージ・遷移図 | ユーザー体験の画面と遷移 | [Claude Design](https://claude.ai/artifact/43SzUgCqyFxMaFenBRPp5v) | [ui/screen-flow/](ui/screen-flow/)（A＋C の全画面の画像は [screenshots/](ui/screen-flow/screenshots/)、見た目の案は [design-options/](ui/screen-flow/design-options/README.md)） | 1794022003-3406 |
| 技術構成 | どう作るか | [artifact](https://claude.ai/artifact/V2HQqotX1paAXFZgTYxjDN) | [architecture/sources/architecture.html](architecture/sources/architecture.html) | 1793979474-24e5 |
| 地図の 2 案 | 案 A と案 B の比較 | [artifact](https://claude.ai/artifact/Jxoj9j5gBc69hSTeRNLFuv) | [architecture/sources/map-options.html](architecture/sources/map-options.html) | 1793899372-b6c5 |
| フィジビリティ検証 | 規約と 3D 生成の検証結果 | [artifact](https://claude.ai/artifact/EjnCk4NQgfkDtQ9XjUHXSi) | [architecture/sources/feasibility.html](architecture/sources/feasibility.html) | 1793899373-8415 |

コピーで欠けるものは次のとおりです。

- `feasibility.html`：HTML だけをコピーしたので、画像と動画は表示されません。原本で見てください
- `ui/screen-flow/`：画面の `.dc.html` は Claude Design の形式で、ブラウザで直接開いても表示されません。遷移図と各画面の説明は [ui/screen-flow/README.md](ui/screen-flow/README.md) に文字で起こしてあります

## 更新の手順

1. 企画書は `docs/product/proposal.md` を直接編集する
2. 技術構成と根拠は原本の artifact を更新し、コピーと上の表を同じコミットで更新する
3. 企画書の変更で技術構成に影響が出たら、技術構成も更新する
4. 新しい文書は、目的に合うフォルダに置き、CLAUDE.md の「目的別の入口」と上の表から辿れるようにする。リンクとパスが実在するかは CI が確かめる

実装で判断が必要になったら、先に正本を更新してからコードを書きます。

## 移した文書（2026-11-07）

古い PR や計画に前の場所が書いてあったら、次の表で読み替えます。

<!-- links:ignore-start -->
| 前の場所 | 今の場所 |
| --- | --- |
| `docs/proposal.md` | `docs/product/proposal.md` |
| `docs/competitors.md` | `docs/product/competitors.md` |
| `docs/pitch-script.md` | `docs/product/pitch-script.md` |
| `docs/sources/screen-flow/` | `docs/ui/screen-flow/` |
| `docs/sources/*.html` | `docs/architecture/sources/*.html` |
| `docs/decisions.md` | `docs/architecture/decisions.md` |
| `docs/setup.md` | `docs/process/setup.md` |
| `docs/dev-plan.md` | `docs/process/dev-plan.md` |
| `docs/team.md` | `docs/contexts/team.md` |
| `transcripts/` | `docs/contexts/meetings/` |
| `docs/ai-usage.md` | `docs/records/ai-usage.md` |
<!-- links:ignore-end -->
