# Antigravity（agy）でローカル開発環境を作る指示書

チームメンバーが自分の PC（macOS / Windows）にローカル開発環境を作るときの **Antigravity（agy）用指令書** です。詳しい背景や仕様は [setup.md](setup.md) と [tools.md](tools.md) にあります。

---

## 使い方（人間がすること）

1. リポジトリを clone して、そのフォルダで Antigravity（IDE または `agy` CLI）を開きます。
2. 次の枠の中をコピーして、そのまま agy に送ります。

```text
docs/process/agy-local-setup.md を読んで、私の端末のローカル開発環境を順番にセットアップしてください。人の操作が必要なところ（ログインや API キー）だけ私に案内し、それ以外は自動で進めて最後に動作確認（npm run verify）まで通してください。
```

---

## agy への指令（ここから下は agy が実行する手順）

この文書を読んだ Antigravity（agy）は、利用者の端末で次の **Step 1 〜 Step 8** を順番に進めてください。

### 守ること（ハーネスの規則）

- `main` ブランチでリポジトリのファイルを編集・commit・push しない（環境構築ではリポジトリ内のファイルは書き換えない）
- 秘密情報のファイル（`web/.env.local` など）は **絶対に読まない・書かない・中身を表示しない**（ガード `no-secret-read` / `no-secret-files` が止める。存在確認だけ行う）
- 本番へのデプロイ（`firebase deploy`）や有料 API（`GEMINI_PROVIDER=vertex`）は実行しない

---

### Step 1：OS と現在の環境を確かめる

まず OS（macOS / Windows）と、必要な道具が入っているかを確かめます。

```sh
# macOS / Linux
uname -s
which mise node java gh agy || true
node -v || true
java -version || true
```

Windows（PowerShell）の場合：

```powershell
$PSVersionTable.OS
Get-Command mise, node, java, gh, agy -ErrorAction SilentlyContinue
node -v
java -version
```

このリポジトリが求める版は `.tool-versions` に定義されています（`scripts/check-env.mjs` が検査します）：

- **Node.js**：メジャーバージョン `24`
- **Java（OpenJDK / Temurin）**：メジャーバージョン `21`（Firestore / Storage などの Firebase Emulator の実行に必須）

---

### Step 2：Node 24 と Java 21 を揃える

`node scripts/check-env.mjs`（または `mise exec -- node scripts/check-env.mjs`）を実行し、エラーが出る場合は OS に合わせて導入します。

#### macOS の場合

1. `mise` がなければ Homebrew で入れます：
   ```sh
   brew install mise
   ```
2. `.tool-versions` を信頼して Node 24 と Java 21 を入れます：
   ```sh
   mise trust && mise install
   ```
3. 次回から `mise exec --` を省略できるよう、シェルの設定（`~/.zshrc`）に `eval "$(mise activate zsh)"` がなければ案内または追加します。

#### Windows の場合

1. `mise` を使う場合：
   ```powershell
   winget install jdx.mise
   mise trust
   mise install
   ```
2. `mise` を使わず直接入れる場合：
   ```powershell
   winget install OpenJS.NodeJS.24
   winget install EclipseAdoptium.Temurin.21.JDK
   ```

導入後、必ず環境チェックが通ることを確かめます：

```sh
mise exec -- node scripts/check-env.mjs
```

---

### Step 3：依存パッケージのインストールと git hooks の有効化

ルート、`web/`、`functions/` の依存パッケージを一括で入れ、`.githooks` を有効にします。

```sh
mise exec -- npm run setup
```

終わったあと、git hooks のパスが `.githooks` になっていることを確かめます：

```sh
git config --get core.hooksPath
# → .githooks と出れば OK
```

---

### Step 4：Antigravity の安全ガード（個人設定）の確認

リポジトリ側のフック（`.agents/hooks.json`）は自動で有効になっています。加えて、ユーザー設定ファイルに危険コマンドの拒否設定が入っているかを確認します（[tools.md](tools.md)「Antigravity」）。

- macOS：`~/.gemini/antigravity-cli/settings.json`
- Windows：`%USERPROFILE%\.gemini\antigravity-cli\settings.json`

既存の設定を壊さないよう注意して、次の `permissions.deny` が含まれる状態にします（設定ファイルはリポジトリ外なので編集して構いません）：

```json
{
  "permissions": {
    "deny": [
      "command(git push --force)",
      "command(git push origin main)",
      "command(firebase deploy)",
      "write_file(.env)"
    ]
  }
}
```

---

### Step 5：GitHub CLI と Firebase CLI のログイン確認

自動ではログインできないため、状態だけを確かめて未ログインなら利用者に案内します。

1. **GitHub CLI（PR 作成・作業宣言で使う）**
   ```sh
   gh auth status
   ```
   未ログインなら、利用者に `gh auth login` の実行を頼みます。

2. **Firebase CLI（Emulator の起動に使う）**
   ```sh
   mise exec -- npx firebase login:list
   ```
   ログイン済みのアカウントが出なければ、利用者に別ターミナルで次を実行するよう案内します：
   ```sh
   mise exec -- npx firebase login
   ```

---

### Step 6：Google Maps API キー（`web/.env.local`）の存在確認と案内

> **重要**：`web/.env.local` を `read_file` や `cat` で読んだり、`write_file` で作ったりしてはいけません（ガードが止めます）。

ファイルが存在するかどうかだけをコマンドで確かめます：

```sh
# macOS / Linux（中身は絶対に読まない）
test -f web/.env.local && echo "exists" || echo "missing"
```

- **存在しない場合**：利用者に次を案内します（作業は止めずに Step 7 へ進みます）。
  - 「`web/.env.local` がなくても、開発用の『地図なし表示（目盛りと地方名）』でアプリもテストもすべて動きます」
  - 「本物の Google マップを表示したいときは、チームから値を受け取り、ご自身の手で `web/.env.local` に次の 2 行を置いてください（[setup.md](setup.md)『Google Maps』）」
    ```sh
    VITE_GOOGLE_MAPS_API_KEY=<チームの Maps browser key (konbu)>
    VITE_GOOGLE_MAPS_MAP_ID=<マップ ID>
    ```

---

### Step 7：全体テスト（`npm run verify`）で動作確認

ここまでの設定で、ローカル環境が本番・CI と同じように動くかを確かめます（`GEMINI_PROVIDER` は付けずに実行します）。

```sh
mise exec -- npm run verify
```

このコマンドで次がすべて通れば、環境構築は完了です：

1. Node 24 / Java 21 の版チェック（`scripts/check-env.mjs`）
2. フロントエンドの lint と、ハーネスの設計方針チェック（`npm run lint`）
3. `web` と `functions` の本番同等ビルド（`npm run build`）
4. 単体テスト（`scripts/functions.test.mjs`、`scripts/web.test.mjs`、`scripts/map-declutter.test.mjs`）
5. Firebase Emulator を立ち上げた通しテスト（`scripts/smoke.mjs`）と 3 人シミュレーション（`scripts/sim-headless.mjs`）

---

### Step 8：完了報告と、開発サーバーの起動方法の案内

`npm run verify` が通ったら、利用者にセットアップ完了を報告し、普段使うコマンドと URL を案内します（利用者が「起動して」と言った場合はそのまま起動します）。

#### 1. 普段の開発（高速・固定の応答）

```sh
mise exec -- npm run dev
```

#### 2. 本物の Gemini（Flash・Argon）をローカルで試すとき

手元に `agy`（Antigravity CLI）が入っていてログイン済みなら、Cloud の費用を出さずに自分の Antigravity アカウント枠で本物の Gemini（場所の提案 Flash 1 日 30 回、3D 模型 Argon 1 日 20 回）を動かせます：

```sh
GEMINI_PROVIDER=agy mise exec -- npm run dev
```

#### 3. ブラウザで開くアドレス（`All emulators ready` が出てから）

| 用途 | URL | メモ |
| --- | --- | --- |
| アプリ画面（トップ） | http://localhost:5173 | 保存すると即座に反映 |
| 見本の旅（初期データ入り） | http://localhost:5173/t/demo-shinshu | 名前を入れるとすぐ 2 人参加済みの旅に入れる |
| 地図なし表示への切り替え | http://localhost:5173/t/demo-shinshu?map=off | Maps の 1 日 300 回の上限を節約するとき（`?map=on` で本物の地図に戻る） |
| 3 人同時シミュレーション | http://localhost:5173/dev/sim | ゆう・みお・けんの 3 画面を並べて台本再生 |
| Firebase Emulator 管理画面 | http://localhost:4000 | Firestore の中身や Functions のログを見るとき |

#### 4. コードや文書を変える作業を始めるとき

このリポジトリでは `main` で直接編集せず、必ず作業宣言を出してから進めます（[work.md](work.md)）。agy に作業を頼むときは、そのままやりたいことを伝えれば `start-work` スキルでブランチ作成から PR・レビュー・マージまで進みます。

---

## よくある詰まりどころ（トラブルシューティング）

- **`Node 24 が必要です` / `Java 21 が必要です` と出る**
  - コマンドの先頭に `mise exec --` を付けるか、シェルで `eval "$(mise activate zsh)"` を有効にしてターミナルを開き直します。
- **Emulator の起動でポート競合（Port already in use）が出る**
  - 前に動かした Emulator が残っています。`lsof -i :5173 -i :5002 -i :8080 -i :9099 -i :5001 -i :4000`（Windows は `Get-NetTCPConnection`）で残っているプロセスを止めてから再実行します。
- **スマホ実機からローカルの画面を開きたい**
  - 同じ Wi-Fi なら `http://<PC の IP>:5173/t/demo-shinshu`、別回線なら Tailscale を入れて `http://<PC の Tailscale IP>:5002/t/demo-shinshu` を開きます（詳しくは [setup.md](setup.md)「スマホから開く」）。
