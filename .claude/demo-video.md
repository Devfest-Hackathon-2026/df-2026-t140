# konbu-devfest のデモ動画メモ

`demo-video` スキルで撮るときの、このリポジトリの条件です。

## 起動

- `mise exec -- npm run dev` → http://localhost:5173 。ログに `All emulators ready` が出てから撮る
- Gemini は既定で固定の応答。agy で本物の Gemini を使う手順は `docs/process/setup.md` にある。Cloud の Gemini（Vertex AI）は使わない
- 地図は `web/.env.local` の Maps キーで表示する。キーがない環境では地図が出ないので、撮る前に確かめる
- 録画は agent-browser。同梱の Chrome が無ければ `export AGENT_BROWSER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`

## 2 種類の動画

| 動画 | 写すもの | viewport |
| --- | --- | --- |
| 1 人の画面 | PR で変わった画面だけ | 390×844 |
| 3 人の計画 | 3 人が同じ旅を同時に計画する様子。スマホ縦長 3 つを横に並べる | 横長（3 画面が収まる幅、例 1280×900） |

「3 人の計画」は、複数人シミュレーションの画面 http://localhost:5173/dev/sim （viewport 1280×900。本物の地図を 1 画面に出すなら `/dev/sim?map=on`）を開き、「開始」を押して撮る。ふつうの速さで 1 回の通しは 2 分半ほど。画面の上の字幕が、いま何をしているかを出す。1 つのブラウザで 3 人分の別々の匿名ユーザーとして動くので、1 本の録画で済む。3 人の操作はシミュレーションの台本で進め、手で 3 画面を操作しない。

`build.sh` は動画内の解像度がそろっていることを確かめるので、1 人の動画と 3 人の動画は別のファイルにする。横長の動画では `--height` を viewport の高さに合わせる。

## 撮るとき

- 声は `--voice Kyoko`。ナレーションは日本語で、です・ます調
- 「建築」から完成までは時間がかかる。固定の応答や用意した部品で完成させ、待ち時間を写さない。ただし、動いていない機能を動いているように見せない（デモの偽装は失格になり得る）
- 写さないもの: 実在の人の名前、Maps キーや設定画面、Emulator の管理画面

- 新しいブラウザで開くと、最初にチュートリアルが出る。チュートリアルを写さない動画では、開く前に localStorage の `tutorial-seen` を `1` にしておく（または「スキップ」を押してから録画を始める）

## 後片付け

- Emulator を止めると、データは消える
- `npm run dev` を自分で起動したなら止める
