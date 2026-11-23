# 画面の作業の入口

画面を作る・直すときに読む文書の案内です。何を作るかは企画書の「ユーザー体験」が正本で、画面イメージ・遷移図はそれを画面にしたものです。

| 読むもの | 何が分かるか |
| --- | --- |
| [screen-flow/README.md](screen-flow/README.md) | 画面の一覧、遷移図、各画面の説明（artifact のコピーを文字に起こしたもの） |
| `docs/product/proposal.md` の「ユーザー体験」 | 何をなぜ作るか（正本） |
| `docs/architecture/design-principles.md` の「フロントエンド」 | どの層・スライスに置くか、ui は描画だけ |
| `web/src/features/create-trip/` | api・model・ui に分けた見本 |
| `web/src/app/styles/tokens.css` | 見た目の変数（色、角丸、フォント、影）。部品はここの変数だけを使う |

画面の構成と見た目（A＋C に決定）は `screen-flow/screenshots/` の画像と [design-options/README.md](screen-flow/design-options/README.md) で確かめます。原本は [Claude Design](https://claude.ai/artifact/43SzUgCqyFxMaFenBRPp5v) です。コレクション（2026-11-21）の画面の案は、別のキャンバス（https://claude.ai/artifact/CtaMT75scBbLDrf8NTNr9h ）と、もとのホワイトボードの写真（`collection/whiteboard-2026-11-21.jpg`）にあります。`screen-flow/` の `.dc.html` はブラウザで直接開いても表示されず、直接編集もしません。

## 画面とスライスの対応（目安）

画面 1 つを pages のスライス 1 つにします。同じ地図の上で切り替わる画面は、1 つのページにまとめ、地図を widgets に置きます。

| 画面 | スライスの例 |
| --- | --- |
| S01 旅をつくる | `pages/trip-create`、`features/create-trip` |
| 招待 URL を開いた人の参加 | `pages/trip-gate`（旅の中の画面の入口。メンバーでなければ参加の画面）、`features/join-trip` |
| S02 3D マップ・友達招待 | `pages/trip-map`、`widgets/trip-map`、`widgets/invite-sheet`、`features/invite-friends` |
| S04 やりたいことを書く | `pages/trip-map`、`features/add-wish` |
| S05 候補ピン・場所カード | `widgets/place-card`、`features/build-model` |
| S07 建物が建つ | `widgets/trip-map`、`entities/model3d` |
| S11〜S13 しおり、場所の情報、シートを閉じた状態 | `pages/trip-map`（ルートボタンで切り替え）、`widgets/route-timeline`、`widgets/place-sheet` |
| S14 決まったしおり | `pages/final-shiori`（別の画面。中身は `entities/trip` の `shioriBookOf` が今のしおりから作る）、`widgets/shiori-head` の `ShioriExportMenu`（書き出し）、`features/export-shiori-pdf`（PDF）、`features/export-calendar`（Google カレンダー）、`features/confirm-shiori`（確定と取り消し。確定のボタンは S11 のシート） |
| M01・M02 メニュー、旅の基本情報 | `pages/menu`、`pages/trip-info` |
| コレクション（過去の旅の建物を旅ごとに並べる。企画書「ユーザー体験」4-2） | `pages/collection`、`widgets/collection`（過去の旅と建物を読む `useCollection`、建物の詳細 `BuildingFloat`）、`widgets/home-footer`（ホームとコレクションの下のフッター） |
| 日本コレクション（過去の旅の建物を日本全体の地図に並べる。同 4-3） | `pages/collection-map`（地図は `widgets/trip-map` の `TripMap` を使う）、`widgets/collection` |
| チュートリアル（初めて開いたとき。ホームの「使い方を見る」からも開く） | `widgets/tutorial`（中身は `config/slides.ts` と `assets/`。直し方は下の「チュートリアルを直す」） |

画面が変わる作業は、スマホの幅（390×844）で確かめます。

## チュートリアルを直す

初めて開いた端末で最初に出るチュートリアルは、`web/src/widgets/tutorial/` にあります。中身は `config/slides.ts` の一覧（SLIDES）と `assets/` の画像だけで決まり、上の棒の本数や最後の「はじめる！」は一覧の長さから自動で決まります。

| したいこと | 直す所 |
| --- | --- |
| 文言を直す | `config/slides.ts` の、その 1 枚の label（小さな見出し）と text（本文） |
| 画像を差し替える | `assets/` の同じ名前の画像を置き換える（縦長のスマホの画面。今の画像は 390×844 の 2 倍、JPEG） |
| 1 枚足す | 画像を `assets/` に置き、`config/slides.ts` に import を 1 行と、SLIDES に 1 つ足す |
| 1 枚消す・並べ替える | SLIDES からその 1 つ（と import、画像）を消す。順番は SLIDES の並びのとおり |
| 文言の箱の位置 | その 1 枚の caption を top か bottom にする（背景の見せたい所に重ならないほう） |

- 今の画像は、開発環境の地図なしの表示で撮っています（本物の Google マップは写っていません）。開発のときだけ出る注意書きは隠して撮りました
- もう一度出して確かめるには、ブラウザの保存データから `tutorial-seen` を消すか、ホームの「使い方を見る」を押します
- 複数人シミュレーション（/dev/sim）の中の画面には出ません

## 画面の文言

画面に出る日本語（ボタン、見出し、案内、エラー、入力欄の例）は、AI が書くと比喩や回りくどい言い方が混ざりやすくなります。そこで、日本語の推敲スキル yomiyasu（`.agents/skills/yomiyasu/`、Claude Code 用の写しは `.claude/skills/yomiyasu/`）を通します。2026-11-07 に Takana が導入を決めました。

### 決まり

- AI が web/ の画面の日本語を新しく書くとき、または書き換えるときは、yomiyasu で推敲してから入れます
- 人が手で書いた文言は、この決まりの対象外です。AI が勝手に書き換えません
- 通していなくても、push と merge は止めません。CI でも検査しません
- yomiyasu を通した文言がある PR は、説明にそのことを書きます（レビューの手がかりにするためで、必須ではありません）

### AI が文言を書くときの手順

1. 文言を書いて、コードに入れます
2. `npm run copy:check -- --changed --list` で、変えた文言と場所を出します
3. 出た文言を yomiyasu に渡して推敲します。依頼の文には、文書の種類と読み手を書きます。例：「次の文言を yomiyasu で推敲して。スマホの旅行計画アプリの画面の文言で、読み手は専門知識のない一般の人。ボタンや見出しの短い文言は短いまま、敬体と常体は今のまま。〇 は数や名前が入る所」
4. 推敲した文言をコードに戻します。「書き手に確かめたい点」が出たら、仮の文言を入れ、その点を PR の説明に書きます

Claude Code では、web/src に日本語の文言を足す編集をすると、フックが yomiyasu を思い出させます（止めません。`scripts/harness/hook.mjs` の post-edit）。ほかの AI ツールにはこのフックがありません。

### 好きなときに点検する

```sh
npm run copy:check                        # web/src のすべての文言を、yomiyasu の lint で点検する
npm run copy:check -- --changed           # main から変えた・足した文言だけ（commit していない変更も含む）
npm run copy:check -- --changed --list    # lint にかけず、文言と場所を出すだけ
```

- 見直し候補を `ファイル:行` で出します。知らせるだけなので、候補があっても終了コードは 0 です
- 候補は機械の目安です（例：文末のコロン、比喩の動詞、決まり文句）。直すかどうかは画面の文脈で決めます
- lint には Python 3.8 以上が要ります。見つからないときは lint を飛ばして、そう表示します
- 意味まで見て直すなら、AI に「UI の文言を yomiyasu で点検して」と頼みます。AI は上の手順の 2 と 3 で点検し、直す案を出します
- 抜き出すのは、web/src の .ts と .tsx の中の、日本語を含む文字列、テンプレート、JSX のテキストです（コメントとテストは除きます）。`{…}` と `${…}` は `〇` に置き換えます
- 直さない語は `.yomiyasu-words/allow.txt` に、見直したい語は `.yomiyasu-words/flag.txt` に 1 行に 1 語ずつ書きます（yomiyasu の lint が読みます）

yomiyasu の更新は `npx skills update yomiyasu` で行い、`.claude/skills/yomiyasu/` にも写します（CI が 2 つの中身の一致を確かめます）。
