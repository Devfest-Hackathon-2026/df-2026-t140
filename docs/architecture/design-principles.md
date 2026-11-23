# 設計方針

コードの組み立て方の決まりです。実装する AI もレビューする AI も、この文書を基準にします。何を作るかは企画書、技術の選定は技術構成と [decisions.md](decisions.md) が正本で、この文書は「どこに何を書くか」だけを決めます。

ルールには ID があります。`machine` は `scripts/harness/lib/arch.mjs` が、編集のたび・commit・push・CI で機械的に確かめます。`judgement` は機械では見られないので、レビュー役（人と AI）が [review-rubric.md](../process/review-rubric.md) の R4 で見ます。ID の一覧の原本は `scripts/harness/lib/rules.mjs` です。

目的は 1 つです。**4 人の AI が同時に別々の機能を作っても、互いのコードを壊さず、ぶつからないこと。** そのために、機能ごとにフォルダを分け（縦に切る）、依存の向きを一方向にし（下や内側へだけ）、外部とのやりとり（Firebase、Gemini、Maps）を決まった場所に閉じ込めます。

## フロントエンド（web/src）：Feature-Sliced Design

[Feature-Sliced Design](https://feature-sliced.design/docs/get-started/overview)（FSD）に合わせます。すべてのコードは、ルートから続く次の層のどれかに置きます。

| 層 | 役割 | このアプリでの例 |
| --- | --- | --- |
| app | 起動、ルーティング、全体のプロバイダー、全体のスタイル | `app/App.tsx`、ルーティング |
| pages | 画面 1 つ = スライス 1 つ | `pages/trip-create`（S01）、`pages/trip-map`（S02・S04〜S08 の地図）、`pages/route-vote`（S09）、`pages/shiori`（S11）、`pages/menu`（M01） |
| widgets | いくつかの機能を組み合わせた大きな部品 | `widgets/trip-map`（3D 地図＋模型＋ピン）、`widgets/route-timeline`（しおりと同じ形のタイムライン） |
| features | 利用者の操作 1 つ | `features/create-trip`、`features/join-trip`、`features/add-wish`、`features/build-model`（建築する）、`features/vote-route` |
| entities | データの単位 | `entities/trip`、`member`、`wish`、`pin`、`place`、`model3d`、`route`、`vote` |
| shared | どこにも依存しない共通の部品 | `shared/api`（Firebase の接続）、`shared/ui`（ボタンなど）、`shared/lib`、`shared/config` |

スライス（`pages/trip-create` のようなフォルダ）の中は、役割ごとのセグメントに分けます。

| セグメント | 置くもの |
| --- | --- |
| ui | 描画する部品（.tsx） |
| model | 状態、操作、判断（React のフック、型、純粋な関数） |
| api | Firestore と Functions の読み書き |
| lib | そのスライスだけの小さな道具 |
| config | 定数 |

見本は `web/src/features/create-trip/`（旅の作成を api・model・ui に分けたもの）と、`scripts/harness/tests/cases/arch-cases.mjs` の VALID です。

### ルール

| ID | 種類 | 決まり | なぜ |
| --- | --- | --- | --- |
| `layer/placement` | machine | web/src のコードは上の層のどれかに置く。直下に置けるのは main.tsx だけ。pages・widgets・features・entities の直下にはファイルを置かず、スライスのフォルダを作る | 置き場所が決まっていると、AI が迷わず、人も探せる |
| `layer/direction` | machine | 上の層は下の層だけを使う（app > pages > widgets > features > entities > shared） | 下の層を直しても上だけが影響を受ける。逆向きの依存があると、どこを直しても全体が壊れる |
| `layer/no-cross-slice` | machine | 同じ層のほかのスライスを直接使わない（features/a から features/b は不可） | スライスを担当ごとに分けられる。2 つの機能を組み合わせるのは上の層（widgets、pages）の仕事 |
| `layer/public-api` | machine | ほかのスライスは、その index.ts（公開の入口）からだけ使う。`@/entities/trip` は可、`@/entities/trip/model/store` は不可 | 中を作り直しても、入口が同じならほかを壊さない |
| `segment/no-jsx-outside-ui` | machine | .tsx（JSX）は ui セグメントと app 層だけに置く | 描画とロジックが同じファイルに混ざらない |
| `data/firebase-in-api` | machine | `firebase/*` は api セグメント（と app の初期化）だけで使う | データの読み書きの場所が 1 つなら、Security Rules やデータ設計の変更に追いやすい |
| `ui/no-data-access` | machine | ui の部品は Firebase、Gemini、api セグメント、fetch を直接使わない（`import type` は可）。ほかのスライスの公開の入口（`@/entities/trip` など）が api の関数を出していると、ui からそれを呼んでも機械では見分けられないので、レビュー（`ui/render-only`）で見る | 下の「UI は描画だけ」を機械で守れるところ |
| `ui/render-only` | judgement | ui の部品は描画と、表示だけの状態に限る。計算や判断は model に置く | 下の通り |

層をまたぐ import は `@/<層>/<スライス>` と書きます（`web/vite.config.ts` と `web/tsconfig.app.json` に設定済み）。スライスの中は相対パスで書きます。

### UI は描画だけ（ui/render-only）

ui の部品は「何をどう見せるか」だけを決めます。迷ったら「このコードは、画面がなくても意味があるか」を考え、意味があるなら model に置きます。

| ui に置いてよい | ui に置かない（model か api へ） |
| --- | --- |
| props と model のフックから受け取った値の表示 | Firestore の購読、書き込み、Functions の呼び出し |
| 開閉、タブ、入力中の文字など、表示だけの状態 | 投票の集計、ルートの並べ替え、締切の判定などの判断 |
| クリックなどを model の関数につなぐこと | 「1 人 1 票」など、守らないと壊れる決まり（これは Security Rules か Functions でも守る） |
| three.js や地図の描画そのもの | 描画のための JSON の検証や変換（`entities/model3d/lib` などへ） |

### データの流れ

- 読む：Firestore →（`entities/<データ>/api` で購読）→（`model` のフックで状態にする）→ ui が描く
- 書く：ui の操作 →（`features/<操作>/model`）→（`entities/<データ>/api` か `features/<操作>/api`）→ Firestore
- onSnapshot は、返り値の関数で必ず購読をやめる。開発時の StrictMode では効果が 2 回走るので、止めた後の購読を残さない。`entities/<データ>/api` は購読をやめる関数を返し、model のフックは `shared/lib` の `useSubscription` に渡す（見本は `web/src/entities/trip/`）
- 一覧（コレクションや問い合わせ）は、onSnapshot ではなく `shared/api` の `subscribeQuery` で読む。最初に「手元にある分だけ」が届いて、前からあるものを「いま増えた」と見まちがえるのを防ぐ

### 置き場所に迷ったら

1. 画面 1 つにしか出てこない → その画面の `pages/<画面>`
2. 利用者の操作 1 つ（ボタンを押すと何かが起きる）→ `features/<操作>`
3. データの形と読み書き → `entities/<データ>`
4. 2 つ以上の機能を並べた大きな部品 → `widgets/<部品>`
5. このアプリの言葉（旅、ピン）を知らない道具 → `shared`

## バックエンド（functions/src）：縦のスライス＋ポートとアダプター

FSD はフロントエンド用なので、バックエンドには同じ考え方（機能ごとに縦に切る、依存を一方向にする）を、サーバーに向いた形で当てはめます。

- 機能ごとの縦のスライス（[Vertical Slice Architecture](https://www.jimmybogard.com/vertical-slice-architecture/)）：「スライスの間の結びつきを小さく、スライスの中を強く」。担当ごとにフォルダが分かれ、並行して作ってもぶつからない
- ポートとアダプター（[Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture/)）：外部の技術は差し替えられるアダプターでつなぐ。Gemini を固定の応答（stub）・手元の agy・Cloud（vertex）で切り替えても、機能のコードを変えずに済む
- 純粋な中心と、I/O の殻（[Functional Core, Imperative Shell](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell)、[impureim sandwich](https://blog.ploeh.dk/2020/03/02/impureim-sandwich/)）：「読む → 純粋な関数で決める → 書く」。決める部分は Emulator なしでテストできる

やりすぎないことも決めています。ポートを作るのは、本当に差し替えるもの（LLM、Places）だけにし、Firestore を包むリポジトリの層は作りません。小さなサーバーレスで抽象を増やすと、保守の手間とコールドスタートが増えるためです（[AWS の解説](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/hexagonal-architecture.html)）。

### 層

| 層 | 役割 | 例 |
| --- | --- | --- |
| index.ts | Firebase が読む関数の一覧。features と app をつなぐだけ（1 機能 1 行） | `export const suggestPlaces = createSuggestPlaces(getDeps)` |
| app | どの実体を使うかを選ぶ（stub・agy・vertex など）。features は知らない | `app/deps.ts` |
| features | 機能 1 つ = スライス 1 つ。トリガーか呼び出し 1 つに対応する | `features/suggest-places`（希望 → ピン）、`features/build-model`（建築 → 模型）、`features/propose-routes`、`features/tally-votes` |
| ports | 差し替えるものの型（インターフェース）だけ | `ports/gemini.ts`、`ports/places.ts` |
| adapters | 外部の SDK を使う実体 | `adapters/gemini/`（`index.ts` が stub・agy・vertex を選ぶ）、`adapters/places.ts` |
| domain | このアプリの決まり（純粋。I/O なし） | ピンの状態の移り変わり、回数の上限の判定、データの型 |
| shared | このアプリの言葉を知らない道具と定数 | 上限の数、日付の道具、エラーの形 |

domain と shared の分け方：「旅」「ピン」「投票」などのアプリの言葉が出てくるなら domain、出てこないなら shared です。

feature の中は、役割ごとのファイル（かフォルダ）に分けます。

| ファイル | 役割 | 使ってよい SDK |
| --- | --- | --- |
| handler.ts | 入口。トリガーや onCall を定義し、入力（ログインなど）を確かめ、adapters の実体を usecase・logic に渡す | firebase-functions、adapters |
| usecase.ts | 殻。読む → logic で決める → 書く。冪等にする（下記） | firebase-admin/firestore |
| logic.ts | 純粋な判断。同じ入力なら同じ出力 | なし |
| prompt.ts | Gemini に渡す文の組み立て（純粋） | なし |
| ports.ts | この機能が外に頼むものの型（logic が受け取る形） | なし |
| types.ts | このスライスだけの型 | なし |
| index.ts | 公開の入口 | なし |

依存の向きは、外から内へだけです。

```text
index.ts ──→ features/<機能>/handler ──→ usecase → logic ──→ ports・domain・shared（型と純粋な決まり）
                    │                                              ↑ 型だけ
                    └──→ adapters（SDK を使う実体）─────────────────┘
```

実体（adapters）を渡すのは、その機能の handler です。機能ごとに組み立てるので、機能を足しても共有のファイルを取り合いません。複数の機能で同じ選び方をするとき（例：stub・agy・vertex の切り替え）は、選び方を adapters の中（`adapters/gemini/index.ts` など）か `app/deps.ts` にまとめます。

見本は `scripts/harness/tests/cases/arch-cases.mjs` の VALID の functions/src 以下です。`features/suggest-places` は app/deps.ts で実体を選ぶ組み立て、`features/ping` は handler が実体を渡す組み立てです（どちらでもよい）。

### ルール

| ID | 種類 | 決まり | なぜ |
| --- | --- | --- | --- |
| `fn/placement` | machine | functions/src のコードは上の層のどれかに置く。直下は index.ts だけ。機能は features/<機能>/ に置き、中は handler、usecase、logic、prompt、ports、types、index に分ける | 置き場所が決まると、AI が迷わない |
| `fn/layer-direction` | machine | features は ports、domain、shared を使う。adapters の実体を使ってよいのは handler だけ（usecase と logic は ports の型で受け取る）。app は features を知らない。index.ts は app と features をつなぐだけ | 新しい機能を足しても、触るのは自分のフォルダと index.ts の 1 行だけ。logic は実体を知らないので、stub に差し替えて試せる |
| `fn/no-cross-feature` | machine | feature どうしは直接使わない。共通の決まりは domain に置き、機能どうしは Firestore の状態（status など）でつなぐ | トリガーの順番は保証されない。直接呼ぶと、片方を直したときにもう片方が壊れる |
| `fn/public-api` | machine | feature は index.ts（公開の入口）からだけ使う | 中を作り直しても index.ts の 1 行は変わらない |
| `fn/sdk-boundary` | machine | Gemini と Maps の SDK は adapters だけ。firebase-functions は handler と app と index.ts だけ。firebase-admin/firestore は usecase と adapters（と app、index.ts）だけ | 費用のかかる呼び出しの場所が決まり、上限をかけ忘れない。差し替えも 1 か所で済む |
| `fn/pure-core` | machine | domain、ports、それに feature の logic、prompt、ports、types は I/O（fs、child_process、http、fetch）を使わない | Emulator なしで node:test だけで確かめられる |
| `fn/idempotent` | judgement | Firestore のトリガーは、同じイベントが 2 回来ても、順番が入れ替わっても結果が変わらないように書く | 下の通り |
| `fn/lazy-init` | judgement | SDK のクライアントは、モジュールの読み込み時ではなく最初に使うときに作る | 読み込みが重いと、すべての関数のコールドスタートとデプロイ時の読み込みが遅くなる（[Firebase のヒント](https://firebase.google.com/docs/functions/tips)） |

### トリガーの書き方（fn/idempotent）

Firestore のトリガーは「少なくとも 1 回」届き、順番も保証されません（[Firestore のトリガー](https://firebase.google.com/docs/firestore/extend-with-functions-2nd-gen)、[再試行](https://firebase.google.com/docs/functions/retries)）。

- usecase の最初に、トランザクションで状態（`status`）を確かめてから進める。見本の `suggestPlacesForWish`（`functions/src/features/suggest-places/usecase.ts`）は、希望の `status` が `pending` のときだけ `searching` にして先へ進み、終わったら `done` か `failed` にする
- Gemini を呼ぶ前に「自分が担当する」と書き込む。2 回目のイベントは状態を見て何もしない
- onDocumentUpdated は、見たいフィールドが変わったときだけ動く。トリガーを起こした文書に書き戻すと、無限に繰り返すおそれがある
- `retry: true` は、一時的な失敗（ネットワークなど）にだけ使う。Emulator では再試行を試せない
- 失敗したら status を `failed` にし、画面は部品の模型に戻す（企画書「生成の失敗」）

### Gemini の呼び出し口と費用（cost/gemini-guarded）

- 呼び出し口の型は `ports/gemini.ts` の 1 つ（`GeminiPort`、`GeminiTask`）。実体は `adapters/gemini/index.ts` で、環境変数 `GEMINI_PROVIDER` で選ぶ（何も書かなければ固定の応答 `stub`。手元の agy は `adapters/gemini/agy.ts`、Cloud の Gemini は `adapters/gemini/vertex.ts`）。機能の handler が、この実体を logic・usecase に渡す
- agy は Flash と Argon の仕事をつないである。回数の上限（Flash は `AGY_MAX_CALLS`、既定 30。Argon は `AGY_MAX_ARGON_CALLS`、既定 20 で別に数える。判断は `domain/agyBudget.ts`、数えるのは `adapters/gemini/agy.ts`）を超えると固定の応答に戻る
- vertex（Cloud の Gemini、費用がかかる唯一の経路）は、usecase が付けた印（`GeminiPermit`）があるときだけ呼ぶ。印は、頼んだ人が合言葉を通していて（`aiAccess/{uid}`）、回数が上限の中のときだけ作る（関所の型は `ports/aiGate.ts`、実体は `adapters/aiGate.ts`、判断は `domain/geminiBudget.ts`）。印がなければ固定の応答に戻る。上限は Flash（場所の候補としおりのルートで分け合う）が累計 300 回（`usage/flash`）、Argon（模型）が 1 日 20 回・累計 300 回（`usage/argon`、日付は日本時間）。「頼んだ人」は、場所の候補では希望を書いた人、しおりのルートでは建った場所の持ち主の誰か、模型では建てた人か希望を書いた人
- Cloud の Gemini（vertex）を本番で有効にするかどうかは人が決める（`todo/humans/2026-11-07-vertex-gemini-passphrase.md`。ルートと模型も本物にする決定は `todo/humans/2026-11-07-vertex-routes-model.md`）。AI は使う設定にしない（ガードが止める）
- Gemini を呼ぶ経路は、ログインの確認と回数の上限（技術構成の「費用の上限」）を必ず通す。上限の判定は domain に置き、usecase で数える

### テスト

- logic、prompt、domain：`node:test` で、Emulator なしで確かめる
- usecase と handler：Emulator で確かめる（`npm run verify` の確認テスト）。Firestore をまねたモックは作らない
- Security Rules：確認テスト（`scripts/smoke.mjs`）に、他人の旅を読めないことなどを足す

## 両方に共通

| ID | 種類 | 決まり | なぜ |
| --- | --- | --- | --- |
| `security/no-eval` | machine | eval や new Function で文字列をコードとして実行しない | AI が書いたコードは実行しない（技術構成）。Gemini が返すのは JSON で、形を検証してから使う |
| `maps/no-generation-input` | machine | 3D 生成の入力を作るコード（名前に build-model、generate-model、model-generation、argon を含むもの）は、Maps 由来のデータを扱うモジュール（place、places、maps、routes-api、Maps の SDK）を使わない | Maps Platform 規約 3.2.3(c)。import だけでなく、Firestore を通したデータの受け渡しもレビューで見る |
| `cost/gemini-guarded` | judgement | Gemini を呼ぶ経路は、ログイン確認と回数の上限を必ず通る | 予算アラートは通知だけで止まらない（`docs/process/setup.md`） |
| `spec/proposal-first` | judgement | 何を作るかが変わる実装は、先に企画書を直す | グラウンドルール（CLAUDE.md） |

## 例外の書き方

方針から外れるほうがよいときもあります。そのときは、外れる妥当性を検討し、採用するならファイル内にメモを残します。レビュー役は、このメモをもとに妥当性を判断します（[review-rubric.md](../process/review-rubric.md) の R5）。

```ts
/*
 * @harness-exception ui/no-data-access
 * 理由：地図の SDK の初期化が、描画する部品と切り離せない
 * 代替案：model へ移す → 描画のたびに地図を作り直すことになり、スマホで重い
 * 解消条件：地図の部品を widgets/trip-map に移すとき
 */
import { loadMap } from '../api/maps'
```

- `@harness-exception <ルールの ID>` は、コメントの直後の 1 文にだけ効く。ファイル全体なら `@harness-exception-file <ルールの ID>`
- 「理由：」は必須。ないと CI が落ちる。代替案と解消条件も書く
- 知らない ID はエラー、当たる違反がなくなった例外は注意として出る（消し忘れを防ぐ）
- judgement のルール（ui/render-only など）の例外も同じ形で書く。機械は数えないが、レビュー役が読む
- 作業宣言の「## 例外」にも 1 行で書く。例外の一覧は `npm run check:harness` に出る

## 決まっていないこと（仮の決め）

人が決めるまでは、次の仮の形で進めます。決めるときは decisions.md に書きます。

| こと | 仮の形 |
| --- | --- |
| web と functions で共有する Firestore の型 | 技術構成の「データ設計」に合わせ、`web/src/entities/<データ>/model/types.ts` と `functions/src/domain/<データ>.ts` にそれぞれ書く。片方を変えたら同じ PR でもう片方も変える（レビューの R6） |
| ルーティングの層（2026-11-07 決定） | React Router を使う。URL と画面の対応は `app` 層の `router.tsx` に閉じ、リンクと URL の値を読む・画面を移るフックは `pages`・`widgets`・`shared/ui` で使ってよい（`todo/humans/2026-11-07-stage-1-2-choices.md`） |
| 状態の管理 | React の状態と Firestore の購読だけで始める。足りなくなったら比べて選ぶ |
