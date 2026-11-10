# 提出の手順

提出は人が行います。AI が提出用リポジトリへ push しようとすると、ガードと git hooks が止めます。提出作業をするときは、AI も人も最初にこの文書を読みます。

## リポジトリ

| 用途 | リポジトリ | 公開範囲 |
| --- | --- | --- |
| 開発 | Lazyturtle0852/konbu-devfest | 非公開 |
| 提出 | Devfest-Hackathon-2026/df-2026-t140 | 公開 |

- 審査は提出用リポジトリの内容で行われる。提出用では GitHub Actions と Pages を使えない
- 提出用へ履歴ごと push すると、過去のコミットも公開される
- コードフリーズと提出は 2026-11-10 19:00 JST。以後、提出用リポジトリは読み取り専用。デプロイ URL は Regional Day（2026-11-14）まで動かし続ける

## 内部資料を履歴から消す

開発中は、チーム内の会話や確認用のメモ、内部資料のコピーを、エージェントの文脈として残しています。これらを公開の提出用リポジトリに出してはいけません。`git rm` だけでは過去のコミットに残ります。

出さないものの一覧の原本は `scripts/harness/lib/policy.mjs` の INTERNAL_PATHS です。2026-11-07 に docs/ を整理したので、前の場所（transcripts/、docs/sources/、docs/team.md）も過去のコミットに残っています。今の場所と前の場所の両方を消します。

1. `main` をそのまま提出用へ push しない
2. 開発用のリポジトリを、別のフォルダに clone し直して提出用のコピーにする
3. コピーの中で、INTERNAL_PATHS のすべてを `git filter-repo` で履歴から消す。例：

   ```sh
   git filter-repo --invert-paths \
     --path docs/contexts/ --path docs/ui/screen-flow/ --path docs/architecture/sources/ \
     --path docs/work/ --path todo/ \
     --path transcripts/ --path docs/sources/ --path docs/team.md
   ```

4. 企画書 `docs/product/proposal.md` は提出用にも残る。「議論済み」の目印など、内部向けの記述を整える
5. README にデプロイした URL を書く
6. コピーに対してチェックを流す。内部資料、秘密情報、企画書の目印、README の URL を確かめる

   ```sh
   node scripts/harness/submission-check.mjs <提出用コピーのフォルダ>
   ```

7. 通ったら、人が提出用リポジトリへ push する

## 運営の提出ルールの要点（2026-11-09 に確かめた）

原本は運営の「提出物・提出ルール」（https://docs.google.com/document/d/1r2QRvMQbcJqhmYAEKAFTN9Co_zsJzvFhxfuS1wx1FJE/edit ）で、この要点より原本を優先します。

- **締切の 11/10 19:00 から 11/14 の終わりまで実行環境を凍結する。再デプロイ、バグ修正、プロンプトやモデルの変更、機能に関わる設定変更は禁止で、クレジットの補充だけ認められる。** deploy への反映と `settings/ai` の変更は締切より前に済ませる
- 現地会場の提出物は 5 点：GitHub、プロダクト説明ドキュメント（指定テンプレートのコピー）、デモ動画（MP4）、著作物利用シート（指定様式のコピー）、プレゼンスライド（Google Slides）
- MP4 を提出フォルダに入れ、同じ動画をスライドにも埋め込む。両方再生できることを確かめる
- 当日のプレゼンは 4 分で、その中に必ずデモを入れる。質疑は 1 分または 1 分半。運営が提出のスライドからマスタースライドを作るので、締切後は差し替えられない
- 名前：「プロダクト説明ドキュメント_[チーム名]」「プレゼンスライド_[チーム名]」「著作物利用シート_[チーム名]」、フォルダは「[会場名]_[チーム名]」
- GitHub 以外は Drive の 1 つのフォルダにまとめ、「リンクを知っている全員が閲覧可」にする。フォームは締切まで再送信できる

## リハーサルの結果（2026-11-09）

提出用のコピーを作る手順を、push せずに試しました。`git filter-repo` は AI のガードが止めるので実行しておらず、内部資料を除いた HEAD の中身を新しいリポジトリに写して確かめました。

- `submission-check` の指摘は、企画書の「議論済み」の目印と README の URL の 2 件だけでした（README は書き換える PR があります）
- 内部資料を除いた状態で、web と functions を `npm ci` からビルドできました
- 全履歴（740 コミット）に Google の API キーの形の値はありませんでした。`submission-check` は履歴の検査もするので、filter-repo のあとのコピーでも実行します
- `git filter-repo` は手元に入っていません。`brew install git-filter-repo` で入れます

コピーに残るもののうち、人が出すかどうかを決めるもの：

| 残るもの | 気になる点 |
| --- | --- |
| `.claude/`、`.agents/`、`AGENTS.md`、`CLAUDE.md`、`scripts/harness/`、`evals/` | 開発の仕組みで、AI ツールの名前と、INTERNAL_PATHS で消す場所へのリンクが残る。出せば AI との付き合い方の説明になる |
| `sound/candidates/`（60 件） | 試聴の候補で、アプリにつないでいない |
| `docs/process/dev-plan.md` など、`docs/architecture/decisions.md` | メンバーの名前と、消した場所へのリンクが残る |
| `.github/workflows/` | 提出用では Actions が動かない |
| `docs/product/product-description.md`、`docs/product/pitch-script.md` | 【人】の印と内部向けのメモがある。提出用のコピーからは除くか、印を消す |

## 提出物

GitHub リポジトリ、プロダクト説明ドキュメント、デモ動画、著作物利用シート、ピッチ用スライド。GitHub 以外は Google Drive に置き、フォルダを「リンクを知っている全員が閲覧可」にします。詳しくは [hackathon.md](../contexts/hackathon.md)。

- 著作物利用シートの元：[credits.md](../records/credits.md)
- AI の使いどころ（説明ドキュメントの必須項目）：[ai-usage.md](../records/ai-usage.md)
- 技術の選定理由：[decisions.md](../architecture/decisions.md)
