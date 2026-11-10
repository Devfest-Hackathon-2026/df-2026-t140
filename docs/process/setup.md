# 開発環境

目標は、**ローカルで動いたものをマージすれば、本番でもそのまま動く**ことです。そのため、版、コマンド、確認テストをローカルと CI で揃えています。

> Antigravity（agy）に環境構築をそのまま任せる場合は、[Antigravity（agy）でローカル開発環境を作る指示書](agy-local-setup.md) のプロンプトを貼ってください（macOS / Windows 両対応）。

## 最初に 1 回

```sh
brew install mise
mise trust && mise install   # .tool-versions の Node と Java を入れる
mise exec -- npm run setup
npx firebase login           # Emulator が Web の設定を取得するのに必要
gh auth refresh -h github.com -s project   # カンバン（GitHub Projects）の「人間待ち」を動かすのに必要
```

最後の行は、`npm run human` が人の判断待ちをカンバンに載せるための権限です。付けなくても todo/humans/ への記録はできますが、カンバンは動かず警告が出ます（[todo/humans/README.md](../../todo/humans/README.md)「カンバンとの連動」）。

`mise exec --` を毎回付けたくない場合は、[mise activate](https://mise.jdx.dev/getting-started.html) をシェルに設定します。

## 普段の開発

```sh
mise exec -- npm run dev
```

- ログに `All emulators ready` が出てから使い始めます。読み込み前に Gemini を呼ぶと失敗します
- 画面：http://localhost:5173（保存するとすぐ反映）
- Emulator の管理画面：http://localhost:4000
- スマホ：同じ Wi-Fi なら `http://<Mac の IP アドレス>:5173`、Wi-Fi が違うなら Tailscale で `http://<Mac の Tailscale の IP>:5173` を開く（下の「スマホから開く」）
- Functions のコードは保存すると自動でビルドされます
- 開発用の初期データが自動で入ります（Emulator を止めると消えます）。見本の旅が 1 つあり、http://localhost:5173/t/demo-shinshu を開いて名前を入れると、2 人が参加済みの旅に入れます
- 匿名ログインはブラウザごとに別の人になります。2 人目を試すときは、別のブラウザか、シークレットウィンドウで招待リンクを開きます
- 見た目の案は `?theme=a` のように URL で切り替えられます（いまは A だけ。変数は `web/src/app/styles/tokens.css`）

### スマホから開く

画面は、開いたアドレスのホスト名で Emulator につなぎます（`web/src/shared/api/connect.ts`）。ローカルとみなすのは、localhost、同じ Wi-Fi のアドレス（192.168.*、10.*、172.16〜31.*）、Tailscale のアドレス（100.64〜100.127.*）です。それ以外のアドレスで開くと本番の Firebase につなぐので、公開のトンネル（trycloudflare など）では開きません。

- 同じ Wi-Fi：Mac の IP（`ipconfig getifaddr en0`）で `http://<IP>:5173/t/demo-shinshu` を開きます
- Wi-Fi が違う（モバイル回線、別の場所）：Mac とスマホに Tailscale のアプリを入れ、同じアカウントでログインします。Mac の Tailscale の IP（メニューバーのアイコン、または `tailscale ip -4`、100. で始まる）で `http://<IP>:5173/t/demo-shinshu` を開きます。開けるのは、同じ Tailscale アカウントにつないだ端末と、Tailscale で Mac を共有した相手の端末だけです
- モバイル回線など遅い回線では、5173（開発用。圧縮しない小さなファイルを何百も配る）は読み込みきれず「アクセスできません」になります。そのときは 5002（Hosting Emulator。本番と同じビルドで、圧縮した 1 ファイル）で `http://<IP>:5002/t/demo-shinshu` を開きます。つながる Emulator は同じです。5002 の画面は `npm run dev` を起動したときのビルドで、保存しても反映されません
- 名前（MagicDNS の `xxx.ts.net`）ではなく、IP で開きます。名前だと Vite が知らないホストとして断り、ローカルの判定にも入りません
- 開けないとき：Mac のファイアウォールで node への接続を許可します。同じ Wi-Fi でも、大学や公共の Wi-Fi は端末どうしの通信を止めていることがあるので、そのときは Tailscale を使います
- 地図が出るのは、キーの許可に入っている IP から開いたときだけです（下の「Google Maps」）。入っていなければ地図なしの表示になります。地図の読み込みは 1 日 300 回で、開いた全員の分を数えます
- HTTP なので、ホーム画面に追加する PWA の確認はできません（本番 URL で行う）

## プルリクエストを出す前に

```sh
mise exec -- npm run verify
```

lint、本番と同じビルド、Functions の単体テスト、Emulator での確認テストを行います。CI も同じコマンドを実行します。

確認テスト（`scripts/smoke.mjs`）は、Firestore のルールも確かめます。メンバーは自分の旅を読み書きできること、メンバーではない人は他人の旅を読めないこと、ピンとルート案は端末から書けないこと、投票が 1 人 1 票であること、です。データの形（画面は `web/src/entities/<データ>/model/types.ts`、Functions は `functions/src/domain/<データ>.ts`）、ルール（`firestore.rules`）、確認テストは、そろえて変えます。

## 本番への反映

`main` は開発用です。プルリクエストを `main` にマージしても本番は変わらず、CI（`.github/workflows/ci.yml`）が `npm run verify` を通すだけです。本番へ出すのは、人が `main` を `deploy` ブランチへ反映したときだけです（かめの決定、`todo/humans/2026-11-07-deploy-branch.md`）。

`deploy` への push で、Deploy（`.github/workflows/deploy.yml`）が次の順に進みます。

1. `npm run verify` を通す
2. 本番へデプロイする
3. 同じ確認テストを本番にも行う（`npm run smoke:prod`）

反映するのは人だけです。AI は deploy に push も merge もせず（ガードの `no-push-deploy`）、Deploy を走らせることもしません。手元から本番へデプロイもしません。

### 反映のしかた（人）

main の今の中身を、早送りでそのまま deploy へ送ります。

```sh
git fetch origin
git push origin origin/main:deploy
```

反映はこの早送りの push だけで行います。GitHub の画面で main → deploy のプルリクエストを merge すると、deploy に main にない merge の commit ができ、次の早送りが git と git hooks に止められるためです。

- 反映の前に、main の最新の CI（Actions の CI）が通っているかを見ます
- 出し直すだけなら、Actions の Deploy を開き、Run workflow で `deploy` を選びます（ほかのブランチを選ぶと何もしません）
- deploy への force push（履歴の書き換え）は git hooks が止めます。前の版に戻したいときは、main で戻す変更（`git revert`）を merge してから反映し直します

### 初回だけ（人）

1. deploy ブランチを作ります。上の `git push origin origin/main:deploy` がそのまま初回の作成になり、Deploy も走ります
2. Workload Identity の条件を deploy に合わせます。今の条件は main からの実行だけを受け付けるので、変えるまで Deploy は認証で失敗します（`scripts/setup-cicd.sh` は変更後の条件になっています）

   ```sh
   gcloud iam workload-identity-pools providers update-oidc konbu-devfest \
     --project konbu-devfest-hackathon-2026 --location global --workload-identity-pool github \
     --attribute-condition "assertion.repository == 'Lazyturtle0852/konbu-devfest' && assertion.ref == 'refs/heads/deploy'"
   ```

3. GitHub のブランチ保護（Settings → Branches、または Rulesets）で、deploy への push と削除を人だけに限ります

残りの作業は `todo/humans/2026-11-07-deploy-branch-setup.md` にあります。

## ローカルと本番の対照表

2026-11-07 時点。人の判断待ちのものは `todo/humans/` にある。

| 項目 | ローカル（手元の Mac、Emulator） | 本番（デプロイ版） |
| --- | --- | --- |
| 開く場所 | 自分：http://localhost:5173（開発用。保存ですぐ反映）。ほかの人：Tailscale で Mac を共有して `http://<Mac の Tailscale の IP>:5002`（本番と同じビルド） | https://konbu-devfest-hackathon-2026.web.app 。**今はデプロイが失敗していて段 1〜2 のまま**（IAM の役割の付与待ち。`todo/humans/2026-11-07-deploy-iam-eventarc.md`） |
| データ | Emulator の中だけ。止めると消える。見本の旅 `demo-shinshu` が自動で入る | Cloud Firestore |
| 場所の候補（Flash） | 既定は見本の場所の一覧（約 150 か所）。`GEMINI_PROVIDER=agy` で本物の Gemini（1 日 30 回、1 回 20〜40 秒） | 見本の場所の一覧。vertex を有効にすると、合言葉を通した人の分は Cloud の Gemini（下の「本番で本物の Gemini を使う」） |
| 模型（Argon） | 既定は部品の模型（9 種）。`GEMINI_PROVIDER=agy` で本物の Gemini（1 日 20 回、1 回 40 秒前後） | 部品の模型。vertex を有効にすると、合言葉を通した人の分は Cloud の Gemini（1 日 20 回・累計 80 回） |
| ルートの線 | 場所どうしをまっすぐ結ぶ | 今はまっすぐ結ぶ。**道路沿い（Routes API、車）は本番だけで入れる予定**（Routes の利用と、道の線を保存してよいかの規約の確認は人の判断待ち）。公共交通はやめた |
| しおりの移動時間 | 直線距離からの目安（Routes API は呼ばない） | 保存するのは目安。`ROUTES_API_KEY` を入れると、合言葉を通した人がしおりを開いたときだけ、Routes API（車）の時間を画面に出す（下の「しおりの移動時間（Routes API）」） |
| 地図 | 本物の地図が出るのは、キーが許可した localhost:5173 と、Mac の Tailscale の IP の 5002・5173 だけ。それ以外は地図なしの表示 | 本番の 2 つのドメインで出る |
| 地図の上限 | 地図の読み込み 1 日 300 回を、本番と同じキーで分け合う | 同じ |
| 地図のスタイル | 同じマップ ID なので「おもちゃの街・道路なし」 | 同じ |
| 変更の反映 | 5173 は保存した時点。5002 は `npm run build` し直したとき（`vite build --watch` を動かせば自動） | 人が main を deploy ブランチへ反映すると GitHub Actions がデプロイ（main への merge だけでは変わらない） |
| スマホ | 同じ Wi-Fi か Tailscale。HTTP なので、ホーム画面に追加する PWA は確かめられない | HTTPS。PWA も確かめられる |
| 費用 | 0 円（agy は開発者のアカウントの枠を使う） | Maps は上限の中なら無料枠。Vertex を使うと Cloud Credit（20 ドル）から（試算：Argon 1 回 約 $0.04〜0.05、Flash 1 回 約 $0.006〜0.011） |

## ローカルと本番で残っている差（開発で気をつけること）

| 差 | 理由 | 確認する場所 |
| --- | --- | --- |
| Gemini は既定では固定の応答 | 本番は Cloud の Gemini を呼ばない（費用の確認が済むまで）。ローカルは agy で本物の Flash を試せる（後述） | 本番の確認テスト。ローカルで試すときは後述 |
| 複合インデックスの不足を Emulator では検出しにくい | Emulator の仕様 | 本番。`firestore.indexes.json` に必ず定義する |
| 権限（ローカルは個人、本番はサービスアカウント） | IAM は Emulator にない | 本番の確認テスト |
| 実行時間や同時実行の制限 | Emulator の仕様 | 本番 |
| HTTP と HTTPS | ローカルに証明書がないため | スマホの PWA は本番 URL で確認する |

Cloud の Gemini（Vertex AI）は、回数の上限と費用の確認が済むまで、ローカルでも本番でも呼びません。既定では固定の応答を返します。切り替え方は次の節にあります。

## Gemini の切り替え

Gemini を呼ぶ入口は `functions/src/adapters/gemini/` の 1 か所です。環境変数 `GEMINI_PROVIDER` で切り替えます（以前の `USE_REAL_GEMINI` はなくしました）。

| 値 | 中身 | 今の状態 |
| --- | --- | --- |
| `stub`（何も書かないとき） | 固定の応答。普段の開発、CI、本番 | 動く |
| `agy` | ローカルの Functions Emulator から agy（Antigravity CLI）を子プロセスで呼び、本物の Gemini（Flash と Argon）を試す | 動く（下の「本物の Gemini で動かす」）。agy が入っていない環境（CI、本番）でも固定の応答に戻る |
| `vertex` | Cloud の Gemini（Vertex AI）。費用がかかる唯一の経路。Flash（場所の候補、しおりのルート）と Argon（模型） | 本番で人が有効にする（下の「本番で本物の Gemini を使う」）。合言葉を通した人の分だけ。Flash は累計 300 回、Argon は 1 日 20 回・累計 80 回まで |

- 応答には、実際に応答を作ったもの（`provider`）と、固定の応答に戻したか（`fellBack`）が付きます。本物の応答でないものを、本物のように見せないためです
- 本物の応答は JSON として確かめ、形が違えば 1 回だけやり直し、だめなら固定の応答に戻します。`agy` でもこの処理がそのまま使われます
- Gemini に頼む仕事を足すときは、機能のフォルダ（`functions/src/features/<機能>/`）の `logic.ts` か `prompt.ts` に `GeminiTask`（送る文、応答の確かめ方、固定の応答）を書きます。型は `functions/src/ports/gemini.ts`、見本は `functions/src/features/ping/logic.ts`
- 切り替えと戻し方は `node --test scripts/functions.test.mjs` で確かめています（`npm run verify` に含まれます）
- いまある仕事：`ping`（接続確認）、`suggest-places`（希望から場所の候補。固定の応答は、`functions/src/features/suggest-places/logic/catalogue.ts` の見本の場所の一覧から、言葉と範囲で選ぶ）、`propose-routes`（建った場所から、しおりの旅の順を作る。固定の応答は自分たちの計算）、`build-model`（場所の名前と説明から模型の JSON。Argon 用。固定の応答は、`functions/src/features/build-model/logic/prefabs.ts` の部品の模型から、場所の種類で選ぶ）
- 部品の模型のときは、「工事中」が見えるよう、完成まで 4 秒待ちます。Functions の環境変数 `BUILD_STUB_DELAY_MS` で変えられます（0 にすると待ちません）

### 本番で本物の Gemini を使う（vertex、合言葉）

かめ（Lazyturtle0852）の決定（`todo/humans/2026-11-07-vertex-gemini-passphrase.md`、2026-11-07）。本番で Cloud の Gemini を呼べるのは、合言葉を通した人の分だけで、Flash は累計 300 回、Argon は 1 日 20 回・累計 80 回で止まります。しおりのルートと模型も本物にすることは、かめが費用を含めて決めました（`todo/humans/2026-11-07-vertex-routes-model.md`）。有効にするのは、かめの許可をとってから。AI は有効にしません。

- 合言葉：本番では、どの画面を開いても最初に合言葉の画面が出るので、そこに入れます（下の「本番のアプリ全体を合言葉で守る」）。手元ではホーム（M01）の下の「合言葉を知っている人へ」に入れます。Functions の `unlockAi` が環境変数 `AI_PASSPHRASE` と比べ、合えば `aiAccess/{uid}` に記録します。端末は合言葉を覚えません。値はかめが決め、リポジトリには書きません
- 関所：合言葉の記録があり、回数が上限の中のときだけ、呼び出し口に印（`GeminiPermit`）を付けて vertex を呼びます。どちらかが欠ければ固定の応答に戻ります（関所は `functions/src/adapters/aiGate.ts`、判断は `functions/src/domain/geminiBudget.ts`）
  - 場所の候補（`suggest-places`、Flash）：希望を書いた人に記録があり、`usage/flash` の累計が 300 回より下
  - しおりのルート（`propose-routes`、Flash）：建った場所の持ち主の誰かに記録があり、`usage/flash`（場所の候補と同じ数）が 300 回より下
  - 模型（`build-model`、Argon）：建てた人か希望を書いた人に記録があり、`usage/argon` が 1 日 20 回（日本時間の日付）・累計 80 回より下。Argon 1 回の待ち時間は 255 秒までで、やり直しを含めて建築のトリガーの 540 秒に収まります。上限に達したら部品の模型になります
  - 回数の記録（`usage/flash`、`usage/argon`）は端末から読めず、書けません（`firestore.rules`、確認テスト）
- 全員に開く切り替え（フル AI）：かめの決定（`todo/humans/2026-11-08-judges-real-gemini.md`、2026-11-08）。普段は合言葉を通した人だけが本物です。審査の前などに人が決めたら、Firebase のコンソールで Firestore に `settings/ai` を作り、`openToAll` を真偽値の `true` にします。次の呼び出しから、合言葉を通していない人（審査員を含む）の場所の候補、しおりのルート、模型も本物になります。デプロイは要りません。戻すときは `false` にするか、ドキュメントを消します
  - 回数の上限（Flash 累計 300 回、Argon 1 日 20 回・累計 80 回）は開いても同じで、使い切ると見本の一覧と部品の模型に戻ります。上限はチームのデモと審査員で分け合います
  - しおりの移動時間（Routes API）は対象外で、今までどおり合言葉が要ります
  - `true` 以外の値（文字列の `"true"` など）では開きません。`settings` は端末から読めず、書けません（`firestore.rules` の既定の拒否）。切り替えるのは人で、AI はしません
- クレジット切れのとき：Vertex が支払いの停止（403）や割り当ての不足（429）を返したら、その呼び出しは見本の一覧と部品の模型に戻り、画面は止まりません（`functions/src/adapters/gemini/index.ts`）。ただし請求先のアカウントにカードが付いていると、Cloud Credit を使い切っても Vertex は失敗せず、カードに請求されます。そのときに止めるのは上の回数の上限だけです
- 本番の設定（人の作業）：GitHub の variable `GEMINI_PROVIDER` を `vertex`、secret `AI_PASSPHRASE` を合言葉にします。Deploy ワークフローが `scripts/write-functions-env.mjs` で関数の環境に渡します。どちらも空なら、固定の応答のままで合言葉は使えません。Vertex のモデル名は variable `VERTEX_FLASH_MODEL`（Flash）と `VERTEX_ARGON_MODEL`（Argon）で変えられます。どちらも任意で、空なら `functions/src/adapters/gemini/vertex.ts` の既定（`gemini-3.8-flash`、`gemini-4-argon`）を使います。Argon の既定の名前は Vertex で確かめていません（agy では `gemini-4-argon-medium`）。名前が違うと 404 になり、数えた 1 回を戻して部品の模型になるので、ログに 404 が出たら `VERTEX_ARGON_MODEL` を正しい名前にします
- 手元：`AI_PASSPHRASE=何か GEMINI_PROVIDER=agy mise exec -- npm run dev` で合言葉の画面を試せます。agy は関所を通らないので、合言葉なしでも本物が呼ばれます（開発者のアカウントの枠。費用は出ません）。`npm run verify` は確認テスト用の合言葉を自動で付けます
- 手元から vertex を呼ぶことはしません（`no-paid-api`）。Emulator で `GEMINI_PROVIDER=vertex` にしても、プロジェクトの認証がないので固定の応答に戻ります

### 本番のアプリ全体を合言葉で守る

かめ（Lazyturtle0852）の決定（`todo/humans/2026-11-10-app-passphrase-gate.md` の c、2026-11-10）。第三者の利用で回数の上限に達し、審査のときに動かなくなるのを防ぎます。運営は、この形でルール上問題ないと答えました。

- 本番の URL では、合言葉の記録（`aiAccess/{uid}`）がない端末には、どの URL を開いても合言葉の画面だけを出します（`web/src/pages/app-lock`）。地図（Maps JavaScript API）も、合言葉を通すまで読み込みません。合言葉を通すと、開こうとしていた画面にそのまま進みます
- 合言葉は上の `AI_PASSPHRASE` と同じで、1 つだけです。通した人は、本物の Gemini、写真、口コミもそのまま使えます。何度も間違えるとしばらく断られます（`unlockAi`）
- `AI_PASSPHRASE` が本番に入っていないと、誰も入れません。本番へ反映する前に、GitHub の secret `AI_PASSPHRASE` が入っていることを確かめます（人の作業）
- 守っているのは画面です。Firestore のルールは変えていないので、画面を通らずに旅のデータを読み書きすること自体は、今までどおりのルールで決まります。費用がかかる呼び出し（Gemini、Places、Routes）は、Functions が今までどおり合言葉の記録か `settings/ai` を確かめます
- 手元（Emulator）では合言葉の画面を出しません。確かめたいときは、`AI_PASSPHRASE=何か mise exec -- npm run dev` で起動し、URL に `?lock` を付けて開きます（例：`http://localhost:5173/?lock`）。そのタブを閉じるまで、合言葉の画面が有効になります
- 合言葉と URL は、公開の提出用リポジトリに書きません。プロダクト説明ドキュメントの 5 つ目の項目「デプロイした URL」に、URL と合わせて書きます（運営の回答）。使い方は簡潔に書きます

### 本物の Gemini で動かす（agy）

手元に agy（Antigravity CLI。`~/.local/bin/agy`）が入っていて、ログインしているときだけ使えます。agy は開発者の Antigravity アカウントのクォータで動くので、Cloud の費用は出ません。

```sh
GEMINI_PROVIDER=agy mise exec -- npm run dev
```

環境変数は、`npm run dev` が起こす Functions Emulator にそのまま届きます（`functions/.env` は使いません）。`npm run verify` は `GEMINI_PROVIDER` を付けずに動かしてください（確認テストは固定の応答を前提にしています）。

| 環境変数 | 既定 | 意味 |
| --- | --- | --- |
| `GEMINI_PROVIDER` | `stub` | `agy` にすると本物を呼ぶ |
| `AGY_MAX_CALLS` | `30` | 1 日に agy を呼ぶ回数の上限。超えた呼び出しは agy を起動せず、固定の応答に戻る（`fellBack: true`） |
| `AGY_FLASH_MODEL` | `gemini-3.8-flash-high` | Flash の仕事に使うモデル（`agy models` で一覧） |
| `AGY_MAX_ARGON_CALLS` | `20` | 1 日に Argon（模型）で agy を呼ぶ回数の上限。Flash とは別に数える。超えたら部品の模型に戻る |
| `AGY_ARGON_MODEL` | `gemini-4-argon-medium` | Argon の仕事（模型）に使うモデル |
| `AGY_BIN` | （PATH と `~/.local/bin/agy` から探す） | agy の実行ファイル |

- 本物を呼ぶのは、Flash の仕事（`suggest-places`、`propose-routes`）と Argon の仕事（`build-model`、模型）です。Cloud の Gemini（vertex）は呼びません
- 模型（Argon）は 1 回に 40 秒前後かかります（2026-11-07 に 1 回試して 40 秒、部品 62 個）。返ってきた JSON が決めた形でなければ、1 回やり直し、だめなら部品の模型に戻ります。保存した模型の `source` が `argon` なら本物、`parts` なら部品の模型です
- 1 回に 20〜40 秒かかります。希望を書いてからピンが立つまで、建ったあとしおりの順が決まるまで、それぞれそのくらい待ちます。画面の「さがし中…」は、関数の打ち切り時間と同じ 330 秒まで続きます（agy の 1 回の上限 150 秒と、形が違って 1 回やり直すぶんを含む）
- 回数は、Emulator のプロセスの中と、OS の一時フォルダの日付ごとの記録（`konbu-agy-calls-<日付>.json`、Argon は `konbu-agy-argon-calls-<日付>.json`）の両方で数えます。Emulator を立て直しても、同じ日のうちは数が戻りません（OS を再起動すると一時フォルダが消え、0 回に戻ります）。Functions のログに、1 回ごとの所要時間と「今日 n 回目（上限 30）」（Argon は上限 20）が出ます
- Gemini が出した場所は、Places で実在を確かめません（Places の上限を使わないため。`docs/process/dev-plan.md`）。位置が日本の範囲（北緯 20〜46、東経 122〜154）の外の候補は捨てます。画面には「Gemini（Flash）の提案です（実在の確認はしていません）」と出ます
- agy の `--dangerously-skip-permissions` と `--json-schema` は使いません。JSON の形は文で頼み、Functions 側で確かめます

## Google Maps

地図は Google Maps（案 A）です。ブラウザ用のキーを、Git の管理外の `web/.env.local` に置きます。

```sh
# web/.env.local（コミットしない）
VITE_GOOGLE_MAPS_API_KEY=<キー>
VITE_GOOGLE_MAPS_MAP_ID=<マップ ID>
```

- キーはチームの GCP プロジェクトの「Maps browser key (konbu)」です。値はメンバーから直接受け取ります。Demo Key は本番利用が禁止なので使いません
- キーは、localhost:5173、127.0.0.1:5173、本番の 2 つのドメイン、Lazyturtle0852 の Mac の Tailscale の IP（`http://100.85.172.76:5002/*` と `:5173/*`。2026-11-07 に持ち主が足した）からだけ使えます。それ以外の IP（同じ Wi-Fi のアドレス、ほかの人の Mac の Tailscale の IP）で開くと地図は出ません。足すときは、今の一覧を全部含めて置き換えます（`gcloud services api-keys update` の `--allowed-referrers` は置き換え。Google Cloud の設定なので人が行う）
- 使える API は、地図の表示、Places、Routes だけです
- CI と本番では、GitHub の secret `GOOGLE_MAPS_API_KEY` と variable `GOOGLE_MAPS_MAP_ID` から渡します
- 地図の色と表示（店や道路を出すか）は、マップ ID に関連付けた Cloud ベースのマップスタイルで決まります。コードの `styles` はマップ ID があると効きません。決めたスタイルは `docs/ui/map-style.json`（案 4「おもちゃの街・道路なし」）で、Cloud Console の Map Styles に「Import JSON」で取り込み、マップ ID に関連付けます（人の作業。`todo/humans/2026-11-07-map-style-toy-no-roads.md`）。変えると数分で全員の地図に反映されます

### 地図なしの表示（普段の確認はこちらで）

地図の読み込みは 1 日 300 回までです。地図を出したページを開く（読み込み直す）たびに 1 回と数えられるので、開発中の確認は、地図なしの表示で行います。

- URL に `?map=off` を付けて開くと、地図を読み込まずに、目盛りの線と地方の名前だけの面にピンを出します。この端末のこのブラウザに覚えるので、次に開いたときも地図なしのままです。地図を出すときは `?map=on` を付けて開きます
- キーかマップ ID がないとき（`web/.env.local` がない環境、CI）と、地図を読み込めなかったとき（キーの制限、上限）は、自動で地図なしになります。画面の左下に、地図なしで表示していることと理由が出ます
- 地図なしの表示が出るのは開発のときだけです（Vite の開発サーバー、localhost、`*.localhost`、Hosting Emulator。`web/src/widgets/trip-map/lib/mapMode.ts` の `isDevelopmentHost`）。本番のドメインでは出ず、地図を読み込めないときは「地図を読み込めませんでした」とだけ出ます（規約 3.2.3(e) への配慮。かめの決定）
- 地図なしの表示でも、引っぱって動かす、右の ＋ − とホイールで拡大・縮小、ピンを押す、映っている範囲から探す、はすべて動きます

### 複数人シミュレーション（3 人の画面を並べて、台本で通す）

`npm run dev` のあと、http://localhost:5173/dev/sim を開きます（1280×900 で 3 画面が収まります）。「開始」で、3 人（ゆう、みお、けん）が旅の作成から、決まったあとの組み直しまでを、それぞれの画面の本物の UI を操作して進めます。「一時停止」「1 つ進める」「最初から」と「速く」があり、上の字幕にいま何をしているかが出ます。各段は本当の状態が出るのを待ち、時間切れなら止まって、どの段で止まったかを出します。

- 3 つの画面は、Firebase のアプリ名と、端末に覚える値の置き場と、Emulator のホスト名（`sim-a.localhost` など）が画面ごとに分かれているので、別々の匿名ユーザーになります。開くのは localhost からにしてください（別の端末からは、ホスト名が通りません）
- 既定は 3 画面とも地図なしです。`/dev/sim?map=on` で、左の 1 画面（ゆう）だけ本物の地図になります（1 回の通しで、地図の読み込みは 1 回。「最初から」で読み込み直すと、もう 1 回）
- 同じ台本を画面なしで流すのが `scripts/sim-headless.mjs` で、`npm run verify` が Emulator に対して流します
- 本番のビルドには、この画面は入りません
- 本物の地図は、ページを開いてから閉じるまでに 1 つだけ作って使い回します（旅を切り替えても、コードを保存しても、作り直しません）
- 使っているのは地図の表示（maps）とマーカー（marker）だけです。Places、Routes、3D 地図、オートコンプリート、写真は読み込みません（`web/src/widgets/trip-map/lib/loadGoogleMaps.ts`）
- Hosting Emulator（:5002）は、キーのリファラの制限で地図が出ません。自動で地図なしになります
- ベクター地図かラスター地図かは、マップ ID の設定（Google Cloud）で決まります。地図を作るときに `renderingType` を自分で指定すると、いまのマップ ID ではラスター地図に落ちました（「Attempted to load a Vector Map, but failed」）。指定しないでください。マップ ID を付けずに作ると、Maps がエラーを出します
- Maps が地図の上にエラーの文を出したとき（1 日の上限に達した、など）も、地図なしの表示に切り替わります
- マップ ID がベクター地図なら、建物の模型を WebGL（WebGLOverlayView）で地図に重ねます。ラスター地図と、地図なしの表示では、同じ模型を絵にして置きます

### 課金を避ける上限

Maps は無料枠を超えると課金されます。超えないよう、API ごとに 1 日の上限をかけています（2026-11-07 設定）。上限に達すると、その日はエラーになります。

| API | 1 日の上限 |
| --- | --- |
| 地図の読み込み | 300 回 |
| Places のテキスト検索、詳細取得 | 各 30 回（候補の口コミのための、場所の ID だけを受け取る検索は料金は無料の区分だが、1 日の回数はテキスト検索の 30 回を、建てる場所の確かめと分け合う。#203） |
| Routes（経路） | 30 回 |
| 口コミ（Place Details の Enterprise + Atmosphere） | 30 回（かめの決定、2026-11-08。人が 0 回から上げる） |
| 写真（Place Photo） | 0 回。場所の情報に写真を出すときは、人が 30 回に上げてから、GitHub の変数 `PLACES_PHOTOS` を `on` にする（かめの決定 2026-11-07、#200） |
| 3D 地図、オートコンプリート、周辺検索、距離行列 | 0 回（使わない） |

上限を変えるときは、無料枠と料金を料金表で確かめてからにします。

### 場所の写真と口コミ（手元では見本）

本番では、合言葉を通した人に、場所の情報（S12）の写真と口コミ、候補の場所カード（S05）の口コミを Places から出します（保存しない）。手元（Emulator）では Places を呼ばず、Functions が開発用の見本（投稿者は「見本（開発用）」、写真は `web/public/dev/sample-place-photo.svg`）を返します。合言葉は要りません。見た目を確かめるためだけのもので、本番には出ません（#215）。

### しおりの移動時間（Routes API）

かめの決定（`todo/humans/2026-11-07-shiori-routes-api.md`、2026-11-07）と、チームの決定（2026-11-08、案 B）。しおりの移動時間は、本番だけ、しおりを開いた人が合言葉を通しているか、全員に開く切り替え（`settings/ai` の `openToAll`）が入っているときだけ、Google の Routes API（車、渋滞は考えない）で聞きます（切り替えで開くのはヨウキンの決定、#165）。開発環境（Emulator、CI）では呼びません。

- 規約で、Routes の時間は保存できません（Service Specific Terms 19.3：保存してよいのは緯度経度を 30 日まで。Terms of Service 3.2.3(a)(b)）。そのため、Firestore に保存するしおりは、いつも直線距離の目安です
- しおりを開くと、画面が callable `shioriTravel`（`functions/src/features/shiori-travel`）を 1 回呼びます。Functions は Routes に 1 回だけ聞き（出発地と場所を経由地として 1 回で渡す）、時刻を計算し直したスケジュールを返します。どこにも書きません。画面はそれをメモリーにだけ持ち、しおりの中身が変わったら聞き直します
- 時間と一緒に道の形（交通情報なしの encodedPolyline）も受け取り、しおりを開いているあいだ、地図の線を道に沿わせます（保存しない。料金の区分は Compute Routes Essentials のまま。#218）。手元（Emulator）では Routes を呼ばず、見本の曲がった線を返します（時刻は目安のまま）
- 返ってきた時間に乗り降りの 10 分を足し、5 分きざみに切り上げます。取れない区間は目安です。聞けないとき・合言葉を通しておらず切り替えも入っていないときは、保存してある目安がそのまま出ます
- 1 日の回数は、上の表の Routes の上限（30 回）で止まります。しおりを開くたびに 1 回数えるので、デモの前は開きすぎないようにします
- キーは Routes API だけを使える API キーを別に作り、GitHub の secret `ROUTES_API_KEY` に入れます。Deploy が関数の環境に渡します（`scripts/write-functions-env.mjs`）。入っていなければ、本番も目安のままです。キーの作成と secret の設定は人が行います

### 建てる場所の確かめ（Places API）

かめの決定（`todo/humans/2026-11-08-places-verify-suggestions.md` の C、2026-11-08）。「建築する！」を押した場所だけ、本番で、建てた人が合言葉を通しているか全員に開く切り替え（`settings/ai`）が入っているときに、Places API（New）のテキスト検索で 1 回だけ探し、ピンの位置を直します。開発環境（Emulator、CI）では呼びません。

- ピンが「工事中」になった瞬間に、トリガー `verifyPlace`（`functions/src/features/verify-place`）が動きます。聞く文は「場所の名前 地域」で、Gemini が推測した位置のまわり 50 km を優先します。受け取るのは place_id と位置だけです（`X-Goog-FieldMask: places.id,places.location`）
- 推測の位置から 80 km 以内で見つかれば、ピンの `location` と `placeId` だけを書き換えます。名前と説明は Gemini（か見本の一覧）が書いたままです。見つからない・遠すぎる・呼べないときは、位置はそのままで建築は続きます
- 模型（`build-model`）は位置も `placeId` も読みません（規約 3.2.3(c)。ハーネスの `maps/no-generation-input` とテストで確かめる）。ルート（`propose-routes`）は「完成」のあとに作るので、たいていは直した位置で組まれます。部品の模型（約 4 秒で完成）では、確かめが遅れて推測の位置で組まれることがあります。そのときも、しおりの移動時間（Routes）は開いたときのピンの位置で聞き直すので、ずれるのは保存した並び順と目安だけです
  - 見つからない・遠すぎた場所は place_id が空のままなので、模型の失敗から建て直すと、もう一度 Places を呼びます（1 日 30 回の上限の中）
- 保存の決まり：place_id は保存してよく（General Terms の Google ID Caching）、Places の位置（緯度経度）は 30 日までです（Maps Service Specific Terms 14.3）。審査の終わり（2026-11-14）のあと 30 日以内に、旅を消すか位置を戻します
- 1 日の回数は、上の表の Places（テキスト検索）の上限（30 回）で止まります。1 か所建てるたびに 1 回です
- 料金：`places.location` を受け取るので Text Search Pro の区分です（月 5,000 回まで無料、その先 1,000 回あたり $32。https://developers.google.com/maps/billing-and-pricing/pricing 、2026-11-08 に確認）。1 日 30 回の上限なら月 900 回までなので、無料の枠に収まります
- 名前（displayName）は受け取らず、保存もしません（規約 3.2.3(a)(iii) は店名と住所の保存を禁じています）。Places の内容を出すのは Google の地図の上だけです
- キーは Places API（New）だけを使える API キーを別に作り、GitHub の secret `PLACES_API_KEY` に入れます。Deploy が関数の環境に渡します（`scripts/write-functions-env.mjs`）。入っていなければ、本番も推測の位置のままです。キーの作成と secret の設定は人が行います

### 場所の口コミ（Places API の Place Details）

かめの決定（`todo/humans/2026-11-08-places-reviews.md` の B、2026-11-08）。本番だけ、合言葉を通した人だけに出し、Place Details（口コミ）の上限は 1 日 30 回にします。全員に開く切り替え（`settings/ai` の `openToAll`）では出しません。GitHub の variable `PLACES_REVIEWS` を `on` にし、上限を 0 回から 30 回に上げるのは人が行います。それまでは、Functions は口コミを聞かず、画面にも何も出ません。開発環境（Emulator、CI）では呼びません。

- 場所の情報（S12）を広げたときに、callable `placeReviews`（`functions/src/features/place-reviews`）を 1 回呼びます。Functions は、開いた人が旅のメンバーで、合言葉を通していて、場所を Places で確かめてある（placeId がある）ときだけ、Place Details を 1 回呼びます（`X-Goog-FieldMask: reviews,googleMapsUri`、日本語）
- 料金：`reviews` は Place Details Enterprise + Atmosphere の区分です（月 1,000 回まで無料、その先 1,000 回あたり $25。https://developers.google.com/maps/billing-and-pricing/pricing 、2026-11-08 に確認）。1 日 30 回の上限なら月 900 回までなので、無料の枠に収まります
- 保存の決まり：口コミは保存できません（Maps Platform 規約 3.2.3(a)(iii)）。Functions は返すだけで、画面はページのメモリーにだけ（最大 20 か所）持ち、再読み込みで消えます。同じ場所を開き直しても聞き直しません。口コミは模型や Gemini に渡しません（3.2.3(c)）
- 表示の決まり（https://developers.google.com/maps/documentation/places/web-service/policies ）：投稿者の名前・アバター・プロフィールへのリンク、口コミを Google マップで開くリンク、報告のリンク、並び順（関連度の順）、Google マップの帰属を出しています

### 模型の見た目の参考（Knowledge Graph Search API）

かめの決定（`todo/humans/2026-11-08-model-kg-description.md` の A、2026-11-08）。Knowledge Graph Search API は Google の API で、詳しい説明（detailedDescription）の文は Wikipedia（CC BY-SA）から来ます。キー（`KG_API_KEY`）を入れるまでは呼ばず、今までどおり名前・説明・希望の文だけで模型を作ります。

- 本物の Gemini で模型を作るとき（固定の応答でないとき。vertex なら関所を通ったときだけ）、場所の名前で Knowledge Graph Search API を 1 回呼びます（`functions/src/adapters/knowledge-graph.ts`）。名前は Gemini が Maps を使わずに出したもので、Maps 由来の内容は渡しません（規約 3.2.3(c)）
- 使うのは、ライセンスが Creative Commons（BY-SA）と示された詳しい説明（detailedDescription。Wikipedia の記事の冒頭）だけで、400 字までにします。短い description と name は、ライセンスが示されていないので使いません
- その説明を使って Gemini が作った模型には、説明の文と出典（記事の URL とライセンス）を `model/current` の `reference` に残します。場所の情報（S12）には、その説明を引用として出し、記事とライセンスへのリンクを添えます（CC BY-SA は出典を示せば保存と表示を許す。かめ、2026-11-08）
- 費用：Cloud の課金はありません（1 日 10 万回まで無料、https://developers.google.com/knowledge-graph/reference/rest/v1/usage-limits 、2026-11-08 に確認）
- キーは Knowledge Graph Search API だけを使える API キーを作り、GitHub の secret `KG_API_KEY` に入れます。Deploy が関数の環境に渡します。キーの作成と secret の設定は人が行います

## 費用の注意

Blaze プランの従量課金です。予算アラートは通知だけで、自動では止まりません。Gemini を呼ぶ機能には、ログイン確認と回数の上限を必ず付けます。本番の確認テストは、デプロイのたびに Gemini の呼び出し口を 1 回通りますが、既定は固定の応答なので費用はかかりません。
