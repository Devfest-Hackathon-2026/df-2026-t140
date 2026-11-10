# 出典とライセンス

提出物の「著作物利用シート」の元になる記録です。プロダクトに入るライブラリ、素材、データを足したら、同じ PR でここに足します（CI が、package.json に依存を足したのにこのファイルを変えていない PR に注意を出します）。

ライセンスは、入れた版の package.json か配布元で確かめてから書きます。

## ライブラリ（プロダクトに入るもの）

| 名前 | 使う場所 | ライセンス | 出典 |
| --- | --- | --- | --- |
| react、react-dom | web | MIT | https://react.dev |
| firebase（JavaScript SDK） | web | Apache-2.0 | https://github.com/firebase/firebase-js-sdk |
| firebase-admin | functions | Apache-2.0 | https://github.com/firebase/firebase-admin-node |
| firebase-functions | functions | MIT | https://github.com/firebase/firebase-functions |
| @google/genai | functions（Vertex AI の Gemini（Flash）を呼ぶ。合言葉と回数の上限付き。`functions/src/adapters/gemini/vertex.ts`） | Apache-2.0 | https://github.com/googleapis/js-genai |
| react-router（依存する @remix-run/route-pattern、cookie-es も MIT） | web（画面の切り替え。URL と画面の対応） | MIT | https://github.com/remix-run/react-router |
| qrcode-generator | web（招待リンクの QR コード。「QR コード」は株式会社デンソーウェーブの登録商標） | MIT | https://github.com/kazuhikoarase/qrcode-generator |
| three（three.js） | web（建物の模型の描画。`web/src/entities/model3d/`、`web/src/widgets/trip-map/lib/buildingsOverlay.ts`） | MIT | https://github.com/mrdoob/three.js |

## 開発に使う道具（プロダクトには入らない）

| 名前 | 用途 | ライセンス | 出典 |
| --- | --- | --- | --- |
| vite、@vitejs/plugin-react | web のビルド | MIT | https://vite.dev |
| typescript | 型の確認 | Apache-2.0 | https://www.typescriptlang.org |
| @types/google.maps | Maps JavaScript API の型（型だけ。プロダクトには入らない） | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/three | three.js の型（型だけ。プロダクトには入らない） | MIT | https://github.com/three-types/three-ts-types |
| oxlint | lint | MIT | https://oxc.rs |
| firebase-tools | Emulator、デプロイ | MIT | https://github.com/firebase/firebase-tools |
| concurrently | 開発時の並行実行 | MIT | https://github.com/open-cli-tools/concurrently |
| yomiyasu 2.5.0（AI のスキルと付属の Python スクリプト。`.agents/skills/yomiyasu/`、`.claude/skills/yomiyasu/`。Unicode のデータの部分は同梱の UNICODE-LICENSE.txt） | 画面の日本語の文言の推敲と点検（`npm run copy:check`） | MIT | https://github.com/nanaism/yomiyasu |

## 素材・データ

| 名前 | 使う場所 | ライセンス・利用条件 | 出典 |
| --- | --- | --- | --- |
| M PLUS Rounded 1c（フォント） | web（見た目の案 A の文字。`web/index.html` で Google Fonts から読み込む）、README のロゴの文字（`docs/product/logo.png`） | SIL Open Font License 1.1 | https://fonts.google.com/specimen/M+PLUS+Rounded+1c |
| アイコン、アプリのアイコン（PNG は favicon.svg から作成）、リンクの共有画像、場所の種類の絵、地図の上のピン | web（`web/src/shared/ui/Icon.tsx`、`web/public/favicon.svg`、`web/public/icons/`、`web/public/apple-touch-icon.png`、`web/public/ogp.png`、`web/src/entities/pin/ui/`） | このリポジトリで描いたもの。外のアイコン集や画像は使っていない | - |
| Google Cloud の製品アイコン（Vertex AI、Firestore、Cloud Functions、Google Maps Platform） | 提出資料のアーキテクチャ図（`docs/product/architecture.svg`、`architecture.png`）。アプリには入れていない | Google の公式アイコン集（アーキテクチャ図を作るための素材として配布）。ライセンスの条文は配布ページで確かめられていない | https://cloud.google.com/icons |
| Google Maps（Maps JavaScript API の地図の表示とマーカー） | web（`web/src/widgets/trip-map/`。script を Google から読み込む。パッケージには入れていない） | Google Maps Platform 利用規約。ロゴと著作権表示を隠さない。Maps 由来の内容を 3D 生成の入力にしない | https://developers.google.com/maps/documentation/javascript |
| 見本の場所の一覧（約 150 か所の名前、一言の説明、およその緯度経度） | functions（`functions/src/features/suggest-places/logic/catalogue.ts`。固定の応答のときの候補） | このリポジトリで書いたもの（AI に書かせ、単体テストで形と位置の範囲を確かめた）。地図サービスから取った内容ではない。位置はおよそで、正確さは保証しない | - |
| 出発地の位置の表（主な駅と街、約 75 か所の名前とおよその緯度経度） | functions（`functions/src/domain/originPlaces.ts`。ルート案で、出発地からの移動時間を見積もるのに使う） | このリポジトリで書いたもの（AI に書かせた）。地図サービスから取った内容ではない。位置はおよそで、正確さは保証しない | - |
| 見ているあたりの名前の表（都道府県 47、市町村 約 90、駅と名所 約 45 の名前とおよその緯度経度） | web（`web/src/widgets/trip-map/lib/viewLabel.ts`。地図の左上の「〜のあたりから探します」に出す名前を決める） | このリポジトリで書いたもの（AI に書かせた）。地図サービスから取った内容ではない。位置はおよそで、正確さは保証しない。都道府県の位置は `functions/src/features/suggest-places/logic/areas.ts` と同じ値 | - |
| Wikipedia の記事の冒頭（Knowledge Graph Search API の detailedDescription。キーを入れたときだけ） | functions（`functions/src/adapters/knowledge-graph.ts`。本物の Gemini で模型を作るときに、見た目の参考として入力に足す） | CC BY-SA（記事ごとの license。https://creativecommons.org/licenses/by-sa/ ）。説明の文（400 字まで）と出典（記事の URL とライセンス）を模型の記録に保存し、場所の情報（S12）に説明を引用として、記事とライセンスへのリンクつきで出す。生成した模型が翻案物にあたるかは確かめていない（`todo/humans/2026-11-08-model-kg-description.md`） | 記事ごと |
| 都道府県と地方の名前、およその位置 | functions（`functions/src/features/suggest-places/logic/areas.ts`）、web（`web/src/widgets/trip-map/lib/viewLabel.ts`） | このリポジトリで書いたもの | - |
| 部品の模型（9 つ。場所の種類ごとの模型の JSON）と、代わりの模型 | functions（`functions/src/features/build-model/logic/prefabs.ts`）、web（`web/src/entities/model3d/lib/fallbackModel.ts`） | このリポジトリで書いたもの（形・大きさ・色の数字を AI に書かせ、検査の単体テストと、描いた絵で確かめた）。外の 3D モデルや画像は使っていない | - |

## SE素材（2026-11-09取得、柔らかい候補へ再選定）

リポジトリ直下の `sound/` に、用途別の試聴候補として原音を保存。2026-11-09にたかなの試聴で採用した候補（catalog.jsonのselected）をアプリへ接続した。配信する17音源は `web/public/sounds/` に原音のままコピーし、ファイル名だけ変更した。音量はWeb Audioのゲインで調整する。配信ファイルと原音の対応は [sounds/README.md](../../web/public/sounds/README.md)、個別ファイルの原名・出典・SHA-256は [sound/catalog.json](../../sound/catalog.json)、用途と全アクションの対応は [sound/README.md](../../sound/README.md) を参照。

| 配布パック・作者 | 保存先 | ライセンス・利用条件 | 出典 |
| --- | --- | --- | --- |
| Interface Sounds / Kenney | `sound/candidates/`（操作・通知・演出） | CC0-1.0。同梱の原文を `sound/licenses/kenney-interface-sounds.txt` に保存 | https://kenney.nl/assets/interface-sounds |
| UI Audio / Kenney | `sound/candidates/01-select/` | CC0-1.0。同梱の原文を `sound/licenses/kenney-ui-audio.txt` に保存 | https://kenney.nl/assets/ui-audio |
| Impact Sounds / Kenney | `sound/candidates/`（旧版の木の接触・着工・ベル。現行候補から除外） | CC0-1.0。同梱の原文を `sound/licenses/kenney-impact-sounds.txt` に保存 | https://kenney.nl/assets/impact-sounds |
| Music Jingles / Kenney | `sound/candidates/`（完成・開始・終了・解放） | CC0-1.0。同梱の原文を `sound/licenses/kenney-music-jingles.txt` に保存 | https://kenney.nl/assets/music-jingles |
| RPG Audio / Kenney | `sound/candidates/`（旧版の本の開閉・ページ・配置。現行候補から除外） | CC0-1.0。同梱の原文を `sound/licenses/kenney-rpg-audio.txt` に保存 | https://kenney.nl/assets/rpg-audio |
| Woven SFX / Woven SFX | `sound/candidates/`（シャッター・到着） | 音源はCC0-1.0。ソフトウェアのMITとは区別。配布ページの表記を確認 | https://www.woven.video/sfx 、 https://www.woven.video/sfx/camera-shutter-sound-effect |
| racing car engine sound loops / domasx2 | `sound/candidates/16-drive/` | CC0-1.0。配布元によるとpublic domain録音から作成したループで、候補間の違いはピッチのみ | https://opengameart.org/content/racing-car-engine-sound-loops |
| Car engine start 01 / looneybits | `sound/candidates/17-depart/`（候補A・B） | CC0-1.0。配布ページの表記を確認 | https://opengameart.org/content/car-engine-start-01 |
| Car engine Start Up 02 / looneybits | `sound/candidates/17-depart/`（候補C） | CC0-1.0。配布ページの表記を確認 | https://opengameart.org/content/car-engine-start-up-02 |

2026-11-09のたかなの試聴を受け、日常操作の候補をポップ・バブル系へ再選定した。QRは無音、保存成功のぴろりんは維持。旧候補はGit履歴に残す。詳細は[再選定記録](../sound/reselection.md)。

| 追加の配布パック・作者 | 保存先 | ライセンス | 出典 |
| --- | --- | --- | --- |
| Pop sounds / EZduzziteh | sound/candidates/、採用分はweb/public/sounds/ | CC0-1.0 | https://opengameart.org/content/pop-sounds-0 |
| Pop effect sounds / trezegames | sound/candidates/（今は配信なし） | CC0-1.0 | https://opengameart.org/content/pop-effect-sounds |
| 3 Pop Sounds / wubitog | sound/candidates/、採用分はweb/public/sounds/ | CC0-1.0 | https://opengameart.org/content/3-pop-sounds |
| Bubble Sound Effects / BMacZero / Brian MacIntosh | sound/candidates/（今は配信なし） | CC0-1.0 | https://opengameart.org/content/bubble-sound-effects |
| Boings / EZduzziteh | sound/candidates/（今は配信なし） | CC0-1.0 | https://opengameart.org/content/boings |

試聴後、たかなの[採用指定](../sound/selections.md)を反映。配信は採用17音源で、候補のA/B/Cは固定し、catalogのselectedを使用する。着工・再試行と旅作成・再生開始完了は無音。候補の原音と出典は保持する。
