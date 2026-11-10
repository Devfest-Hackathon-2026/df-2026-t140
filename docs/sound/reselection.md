# SEの再選定（2026-11-09）

以下は一次再選定の記録。現在の採用は[試聴後の指定](selections.md)を参照。

たかなの試聴による「しゃきんしゃきんしすぎ」「ぽよんぽよんしてほしい」を基準に、候補集そのものを更新した。保存成功のconfirmation_001は原音と再生ゲインを維持し、QR切替は無音。

## 新規取得した配布元

- [Pop sounds](https://opengameart.org/content/pop-sounds-0) / EZduzziteh / CC0-1.0
- [Pop effect sounds](https://opengameart.org/content/pop-effect-sounds) / trezegames / CC0-1.0
- [3 Pop Sounds](https://opengameart.org/content/3-pop-sounds) / wubitog / CC0-1.0
- [Bubble Sound Effects](https://opengameart.org/content/bubble-sound-effects) / BMacZero / Brian MacIntosh / CC0-1.0
- [Boings](https://opengameart.org/content/boings) / EZduzziteh / CC0-1.0

## 採用音の変更

| 用途 | 以前の候補A | 再選定した候補A | 理由 |
| --- | --- | --- | --- |
| 選択 | 01-click_001.ogg | 01-pop4.wav | 低めの一発ポップ。小さく丸い選択の手触り。 |
| 開く・広げる | 01-open_001.ogg | 01-bubbles-single2.wav | 単発バブルの丸い膨らみ。シートが広がる動きに合わせる。 |
| 閉じる・戻る | 01-close_001.ogg | 01-pop3.wav | 少し下がる一発ポップ。短く収まる閉じる音。 |
| カード・表示の切替 | 01-scroll_001.ogg | 01-pop2.wav | 連続する機械音をやめ、一回の軽いポップで切替を伝える。 |
| 希望を送る | 01-fast-whoosh.wav | 01-pop1.wav | 短い一発ポップ。送れた瞬間だけを軽く伝える。 |
| 候補の発見 | 01-confirmation_003.ogg | 01-bubbles-single2.wav | 候補が膨らんで現れる単発バブル。金属的な通知を避ける。 |
| 建築を確定する | 01-impactWood_light_001.ogg | 01-pop8.wav | 丸く厚みのある一発ポップ。建築ボタンを押した手応え。 |
| 着工・再試行 | 01-impactWood_medium_000.ogg | 01-bung_01.mp3 | バネのように弾む着工音。連続する打撃音を使わない。 |
| 穏やかな注意・候補なし | 01-question_001.ogg | 01-question_004.ogg | 低めの丸い問いかけ。強く警告せず入力確認を促す。 |
| 処理の失敗 | 01-error_001.ogg | 01-error_005.ogg | 低域中心の短い下降音。鋭いブザーを避け、再試行を促す。 |
| 地図の移動・拡大縮小 | 01-fast-whoosh.wav | 01-pop1.wav | 短いポップを小さく鳴らし、地図の移動に軽い手触りを付ける。 |
| AI利用の解放 | 01-glass_003.ogg | 01-confirmation_001.ogg | 保存成功と同じ、好評だったぴろりんで解放を知らせる。 |

## 比較の範囲

新規取得したポップ・水泡・バネ音と、Kenneyの未収集の低い丸音を比較。長さ・ピーク・RMSと、隣接サンプルの差分エネルギーから高域の強さの目安を計測した。旧open/closeの指標は約1.37、新しいopenは約0.10、closeは約0.13。これは同じ48kHzでデコードした音の比較指標で、聴感評価の代わりではない。全60候補のデコードを確認する。

硬いクリック、スクロール、ガラス、金属打撃、長い機械音は日常操作の候補から外した。完成・旅の開始終了はピチカートの短いジングルを維持し、金属系の別案をバブル・丸音へ更新した。シャッターと車の原音は場面を表す音として残した。旧版の候補はGit履歴で確認できる。

[index.html](../../sound/index.html)でA/B/Cを比較できる。アプリやバックエンドの起動は不要。音源自体は加工せず、候補Aはアプリの配信ファイルとバイト一致する。端末のスピーカーでの聴感と音量の最終判断は、たかなの試聴で行う。
