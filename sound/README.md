# SE候補集

2026-11-09、たかなの試聴に合わせて候補そのものを再選定した。ネットからポップ・バブル・バネ系素材を新規取得し、硬いクリック・金属音・連続した機械音を日常操作の候補から外した。採用候補は用途別にA/B/Cから選択済み。各表の「採用」を参照。selected=nullの用途はアプリでは無音。保存成功のぴろりんは同じ原音・音量を保つ。QR表示・非表示は無音。

[index.html](index.html)をブラウザで開くと、起動せずに全候補を比較できる。[操作表](../docs/sound/README.md)、[選定の記録](../docs/sound/reselection.md)、[再生ヘルパー](../docs/sound/implementation.md)も参照。

音源は未加工。アプリの音量は再生ゲインで調整する。配布元の説明とブラウザでのデコード・長さ・音声特性の比較から選定した。聴感の最終判断は実機で行う。

## 出典

全素材はCC0-1.0。原名・取得元・ハッシュは[catalog.json](catalog.json)、表記の確認記録は[licenses/sources.md](licenses/sources.md)にある。

<a id="select"></a>

## 選択（select）

入力例、ピン、建物、一覧の行など。押した操作に1回。

対応: W01 希望の入力例を押して、入力欄へ入れる ／ W06 候補ピンを押し、場所カードを開く ／ B07 完成通知を押し、その場所へ移動する ／ B08 完成した建物を押す ／ M05 できごとの帯を押して、関連地点を見る ／ M07 しおりの地点を押して、場所の情報を開く

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| select-A | [01-pop4.wav](candidates/01-select/01-pop4.wav) | 0.09秒 | 低めの一発ポップ。小さく丸い選択の手触り。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| select-B（採用） | [02-pop2.wav](candidates/01-select/02-pop2.wav) | 0.08秒 | 少し軽い一発ポップ。存在感をさらに抑える別案。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| select-C | [03-p_2.ogg](candidates/01-select/03-p_2.ogg) | 0.07秒 | 短く控えめなバブルポップ。 | [trezegames](https://opengameart.org/content/pop-effect-sounds) |

<a id="open"></a>

## 開く・広げる（open）

画面やシートを開くとき。

対応: T01 ホームから旅の作成画面を開く ／ T05 ホームから既存の旅を開く・切り替える ／ T07 メンバー・招待シートを開く／閉じる ／ T12 自分の名前の編集を開く／保存する ／ M06 しおりを開く／地図へ戻る ／ M09 シートを畳む／広げる

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| open-A | [01-bubbles-single2.wav](candidates/02-open/01-bubbles-single2.wav) | 0.44秒 | 単発バブルの丸い膨らみ。シートが広がる動きに合わせる。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |
| open-B | [02-bung_01.mp3](candidates/02-open/02-bung_01.mp3) | 0.50秒 | 弾みと余韻がある別案。頻繁な開閉には存在感が強め。 | [EZduzziteh](https://opengameart.org/content/boings) |
| open-C（採用） | [03-pop1.ogg](candidates/02-open/03-pop1.ogg) | 0.40秒 | 短い泡のポップ。水の響きを控える別案。 | [wubitog](https://opengameart.org/content/3-pop-sounds) |

<a id="close"></a>

## 閉じる・戻る（close）

シートを閉じる、戻る、取消、退出。

対応: T07 メンバー・招待シートを開く／閉じる ／ T14 旅から抜ける確認を開く／取り消す ／ T15 旅から抜ける処理が成功する ／ T16 ホームへ戻る ／ W09 カードを閉じる／地図へ戻る ／ M06 しおりを開く／地図へ戻る ／ M09 シートを畳む／広げる ／ M16 戻る操作や地図への接触で再生を中断する ／ S04 メンバーの参加・退出

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| close-A | [01-pop3.wav](candidates/03-close/01-pop3.wav) | 0.13秒 | 少し下がる一発ポップ。短く収まる閉じる音。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| close-B | [02-bubbles-single1.wav](candidates/03-close/02-bubbles-single1.wav) | 0.32秒 | 水泡の小さな余韻で閉じる別案。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |
| close-C（採用） | [03-pop1.wav](candidates/03-close/03-pop1.wav) | 0.06秒 | ごく短いポップで静かに閉じる別案。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |

<a id="switch"></a>

## カード・表示の切替（switch）

スワイプが成立して場所が変わった瞬間。

対応: W07 カードを左右へスワイプして候補を切り替える ／ W08 左右にのぞくカードを押して切り替える ／ M08 場所の情報を左右に切り替える

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| switch-A | [01-pop2.wav](candidates/04-switch/01-pop2.wav) | 0.08秒 | 連続する機械音をやめ、一回の軽いポップで切替を伝える。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| switch-B（採用） | [02-pop4.wav](candidates/04-switch/02-pop4.wav) | 0.09秒 | 低めで丸い切替の別案。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| switch-C | [03-p_4.ogg](candidates/04-switch/03-p_4.ogg) | 0.03秒 | さらに短いバブルで切替を伝える別案。 | [trezegames](https://opengameart.org/content/pop-effect-sounds) |

<a id="confirm"></a>

## 小さな成功・参加（confirm）

コピー、保存、参加の成功。

対応: T06 招待リンクから参加を確定する ／ T08 招待リンクのコピーに成功する ／ T12 自分の名前の編集を開く／保存する ／ S04 メンバーの参加・退出

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| confirm-A（採用） | [01-confirmation_001.ogg](candidates/05-confirm/01-confirmation_001.ogg) | 0.29秒 | 保存時に好評だったぴろりん。音声データも音量も維持する。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| confirm-B | [02-confirmation_002.ogg](candidates/05-confirm/02-confirmation_002.ogg) | 0.54秒 | 同系列の別案。頻繁な成功通知用に比較。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| confirm-C | [03-bong_001.ogg](candidates/05-confirm/03-bong_001.ogg) | 0.12秒 | 低い丸音で短く確定する別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |

<a id="send"></a>

## 希望を送る（send）

検索ボタンの受付。検索結果の通知と分ける。

対応: W02 希望を送信する

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| send-A（採用） | [01-pop1.wav](candidates/06-send/01-pop1.wav) | 0.06秒 | 短い一発ポップ。送れた瞬間だけを軽く伝える。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| send-B | [02-bubbles-single1.wav](candidates/06-send/02-bubbles-single1.wav) | 0.32秒 | 少し余韻のあるバブルで送り出す別案。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |
| send-C | [03-bing_02.mp3](candidates/06-send/03-bing_02.mp3) | 0.34秒 | 小さく弾む響きを付ける別案。 | [EZduzziteh](https://opengameart.org/content/boings) |

<a id="discover"></a>

## 候補の発見（discover）

候補ピン一式が現れたときに1回。

対応: W04 自分の検索結果として候補ピンが現れる

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| discover-A | [01-bubbles-single2.wav](candidates/07-discover/01-bubbles-single2.wav) | 0.44秒 | 候補が膨らんで現れる単発バブル。金属的な通知を避ける。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |
| discover-B（採用） | [02-pop3.wav](candidates/07-discover/02-pop3.wav) | 0.13秒 | 短いポップで結果を控えめに知らせる別案。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| discover-C | [03-pop3.ogg](candidates/07-discover/03-pop3.ogg) | 0.32秒 | 別の泡のポップで発見を知らせる別案。 | [wubitog](https://opengameart.org/content/3-pop-sounds) |

<a id="build-press"></a>

## 建築を確定する（build-press）

「建築する！」を押した受付。着工音と近接する場合はどちらか1つ。

対応: B01 「建築する！」を押す

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| build-press-A | [01-pop8.wav](candidates/08-build-press/01-pop8.wav) | 0.10秒 | 丸く厚みのある一発ポップ。建築ボタンを押した手応え。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| build-press-B | [02-bong_001.ogg](candidates/08-build-press/02-bong_001.ogg) | 0.12秒 | 低い丸音。短い手応えの別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| build-press-C（採用） | [03-pop9.wav](candidates/08-build-press/03-pop9.wav) | 0.09秒 | 少し軽い一発ポップで押下を伝える別案。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |

<a id="build-start"></a>

## 着工・再試行（build-start）

アプリでは無音。候補は比較用に残す。

建築依頼の受理。仲間の着工には同音を小さく使う案。

対応: 現在の採用操作なし

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| build-start-A | [01-bung_01.mp3](candidates/09-build-start/01-bung_01.mp3) | 0.50秒 | バネのように弾む着工音。連続する打撃音を使わない。 | [EZduzziteh](https://opengameart.org/content/boings) |
| build-start-B | [02-bubbles-single2.wav](candidates/09-build-start/02-bubbles-single2.wav) | 0.44秒 | 水泡が膨らむ音で着工を知らせる別案。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |
| build-start-C | [03-bing_02.mp3](candidates/09-build-start/03-bing_02.mp3) | 0.34秒 | 短く小さな弾みを付ける別案。 | [EZduzziteh](https://opengameart.org/content/boings) |

<a id="build-complete"></a>

## 建物の完成（build-complete）

建物が出現する瞬間。完成通知・しおり追加とは1つにまとめる。

対応: B05 建物が完成し、地図に現れる ／ B06 ほかのメンバーの建物が完成する

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| build-complete-A | [01-jingles_PIZZI10.ogg](candidates/10-build-complete/01-jingles_PIZZI10.ogg) | 0.80秒 | ピチカートの短いジングル。完成演出の楽器案。 | [Kenney](https://kenney.nl/assets/music-jingles) |
| build-complete-B | [02-bing_01.mp3](candidates/10-build-complete/02-bing_01.mp3) | 0.32秒 | 弾む余韻で完成を知らせる別案。 | [EZduzziteh](https://opengameart.org/content/boings) |
| build-complete-C（採用） | [03-confirmation_004.ogg](candidates/10-build-complete/03-confirmation_004.ogg) | 0.49秒 | 成功通知素材。ジングルより控えめな完成演出の案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |

<a id="attention"></a>

## 穏やかな注意・候補なし（attention）

入力不足、確認、候補ゼロ。通信故障と区別する。

対応: T14 旅から抜ける確認を開く／取り消す ／ W05 検索が完了したが候補がない ／ S01 必須入力の不足・入力内容の誤り

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| attention-A（採用） | [01-question_004.ogg](candidates/11-attention/01-question_004.ogg) | 0.33秒 | 低めの丸い問いかけ。強く警告せず入力確認を促す。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| attention-B | [02-bong_001.ogg](candidates/11-attention/02-bong_001.ogg) | 0.12秒 | ごく短い低音で控えめに知らせる別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| attention-C | [03-bubbles-single3.wav](candidates/11-attention/03-bubbles-single3.wav) | 0.41秒 | 小さな泡の余韻で穏やかに知らせる別案。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |

<a id="error"></a>

## 処理の失敗（error）

送信・保存・建築などの失敗。1イベント1回。

対応: B09 建築に失敗する ／ S02 保存・送信・コピーなどの失敗 ／ S03 地図・旅の読み込み失敗

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| error-A（採用） | [01-error_005.ogg](candidates/12-error/01-error_005.ogg) | 0.50秒 | 低域中心の短い下降音。鋭いブザーを避け、再試行を促す。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| error-B | [02-error_006.ogg](candidates/12-error/02-error_006.ogg) | 0.50秒 | 同じ低域系列の別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| error-C | [03-back_002.ogg](candidates/12-error/03-back_002.ogg) | 0.07秒 | 短い低い戻り音で失敗を控えめに知らせる別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |

<a id="tour-start"></a>

## 旅の作成・再生開始（tour-start）

アプリでは無音。候補は比較用に残す。

旅の始まりや鑑賞への切替。

対応: 現在の採用操作なし

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| tour-start-A | [01-jingles_PIZZI01.ogg](candidates/13-tour-start/01-jingles_PIZZI01.ogg) | 1.00秒 | ピチカートの開始演出候補。 | [Kenney](https://kenney.nl/assets/music-jingles) |
| tour-start-B | [02-bubbles-single2.wav](candidates/13-tour-start/02-bubbles-single2.wav) | 0.44秒 | 丸いバブルで旅の始まりを軽く伝える別案。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |
| tour-start-C | [03-bung_01.mp3](candidates/13-tour-start/03-bung_01.mp3) | 0.50秒 | 弾む響きで再生開始を伝える別案。 | [EZduzziteh](https://opengameart.org/content/boings) |

<a id="tour-end"></a>

## 旅の再生完了（tour-end）

アプリでは無音。候補は比較用に残す。

最後まで再生したとき。手動中断には使わない。

対応: 現在の採用操作なし

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| tour-end-A | [01-jingles_PIZZI11.ogg](candidates/14-tour-end/01-jingles_PIZZI11.ogg) | 0.79秒 | ピチカートの締め演出候補。 | [Kenney](https://kenney.nl/assets/music-jingles) |
| tour-end-B | [02-confirmation_001.ogg](candidates/14-tour-end/02-confirmation_001.ogg) | 0.29秒 | 保存成功と同じ柔らかいぴろりんで終える別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| tour-end-C | [03-bong_001.ogg](candidates/14-tour-end/03-bong_001.ogg) | 0.12秒 | 低い丸音で静かに終える別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |

<a id="shutter"></a>

## 写真のシャッター（shutter）

旅の再生の到着時。既存Web Audio音との入れ替え比較用。

対応: M13 到着時に写真を撮る演出

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| shutter-A（採用） | [01-camera-shutter-1-shot.wav](candidates/15-shutter/01-camera-shutter-1-shot.wav) | 0.28秒 | 単写シャッター。到着写真の候補。 | [Woven SFX](https://www.woven.video/sfx) |
| shutter-B | [02-camera-analog.wav](candidates/15-shutter/02-camera-analog.wav) | 0.86秒 | アナログカメラの素材。写真の演出の別案。 | [Woven SFX](https://www.woven.video/sfx) |
| shutter-C | [03-camera-shutter-release.wav](candidates/15-shutter/03-camera-shutter-release.wav) | 0.58秒 | シャッターレリーズの素材。短い写真演出の別案。 | [Woven SFX](https://www.woven.video/sfx) |

<a id="drive"></a>

## 車の走行（drive）

任意の演出候補。走行中だけ小さくループし、停止時にフェードする。

対応: M11 車が走る

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| drive-A | [01-loop_0.wav](candidates/16-drive/01-loop_0.wav) | 0.86秒 | 走行エンジンのループ。基準になるピッチ。 | [domasx2](https://opengameart.org/content/racing-car-engine-sound-loops) |
| drive-B | [02-loop_1.wav](candidates/16-drive/02-loop_1.wav) | 0.67秒 | 同じ録音のピッチ違い候補1。 | [domasx2](https://opengameart.org/content/racing-car-engine-sound-loops) |
| drive-C | [03-loop_2.wav](candidates/16-drive/03-loop_2.wav) | 0.68秒 | 同じ録音のピッチ違い候補2。 | [domasx2](https://opengameart.org/content/racing-car-engine-sound-loops) |

<a id="depart"></a>

## 車の出発（depart）

区間の出発時。毎回必要かは試聴で判断。

対応: M14 次の地点へ出発する

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| depart-A | [01-generic_car_startengine.wav](candidates/17-depart/01-generic_car_startengine.wav) | 1.65秒 | 車のエンジン始動素材。出発の候補。 | [looneybits](https://opengameart.org/content/car-engine-start-01) |
| depart-B | [02-generic_car_startengine_1.wav](candidates/17-depart/02-generic_car_startengine_1.wav) | 1.01秒 | 同パックのもう1つの始動素材。 | [looneybits](https://opengameart.org/content/car-engine-start-01) |
| depart-C | [03-engine_start_up_01.wav](candidates/17-depart/03-engine_start_up_01.wav) | 1.80秒 | 別の始動素材。車の出発を明示する候補。 | [looneybits](https://opengameart.org/content/car-engine-start-up-02) |

<a id="arrive"></a>

## 到着（arrive）

任意の演出候補。シャッターを鳴らす場合は重ねない。

対応: M12 地点に到着する

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| arrive-A（採用） | [01-airplane-ding.wav](candidates/18-arrive/01-airplane-ding.wav) | 1.18秒 | 乗り物のding素材。旅の到着を伝える候補。 | [Woven SFX](https://www.woven.video/sfx) |
| arrive-B | [02-bubbles-single1.wav](candidates/18-arrive/02-bubbles-single1.wav) | 0.32秒 | 丸いバブルで到着を知らせる別案。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |
| arrive-C | [03-bong_001.ogg](candidates/18-arrive/03-bong_001.ogg) | 0.12秒 | 低い丸音で静かに到着を知らせる別案。 | [Kenney](https://kenney.nl/assets/interface-sounds) |

<a id="move"></a>

## 地図の移動・拡大縮小（move）

自動カメラ移動、拡大縮小のボタン。連続ドラッグには使わない。

対応: M02 地図の拡大／縮小ボタンを押す ／ M03 検索結果や選択地点へ地図が自動移動する

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| move-A（採用） | [01-pop1.wav](candidates/19-move/01-pop1.wav) | 0.06秒 | 短いポップを小さく鳴らし、地図の移動に軽い手触りを付ける。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| move-B | [02-pop2.wav](candidates/19-move/02-pop2.wav) | 0.08秒 | 少し低音量のポップで移動を知らせる別案。 | [EZduzziteh](https://opengameart.org/content/pop-sounds-0) |
| move-C | [03-bubbles-single1.wav](candidates/19-move/03-bubbles-single1.wav) | 0.32秒 | 水泡の余韻で移動を知らせる別案。 | [BMacZero / Brian MacIntosh](https://opengameart.org/content/bubble-sound-effects) |

<a id="unlock"></a>

## AI利用の解放（unlock）

合言葉が受理された成功時。

対応: T13 合言葉を送信し、AI利用が解放される

| 候補 | 原音 | 長さ | 選定理由 | 配布元 |
| --- | --- | --- | --- | --- |
| unlock-A（採用） | [01-confirmation_001.ogg](candidates/20-unlock/01-confirmation_001.ogg) | 0.29秒 | 保存成功と同じ、好評だったぴろりんで解放を知らせる。 | [Kenney](https://kenney.nl/assets/interface-sounds) |
| unlock-B | [02-bing_02.mp3](candidates/20-unlock/02-bing_02.mp3) | 0.34秒 | 小さく弾む音で受理を知らせる別案。 | [EZduzziteh](https://opengameart.org/content/boings) |
| unlock-C | [03-jingles_PIZZI02.ogg](candidates/20-unlock/03-jingles_PIZZI02.ogg) | 0.96秒 | ピチカートのジングルで特別感を出す案。 | [Kenney](https://kenney.nl/assets/music-jingles) |

## 無音の操作

- T02 日付・出発地・名前などを入力する：キーボードやOSの音と重複させない
- T03 「旅を計画する」を押す：たかなの試聴指定により無音。
- T04 旅の作成が成功し、地図へ進む：たかなの試聴指定により無音。
- T09 QRコードを表示／非表示にする：たかなの試聴により無音。切替音を付けない
- T10 OSの共有シートを開く：OS側の体験を優先
- T11 共有をキャンセルする：エラー扱いにしない
- W03 場所を検索している：長時間続くループ音は避ける
- W10 カードの端で、それ以上切り替えられない：毎回警告音を鳴らす必要はない
- W11 候補が期限切れ・次の検索で消える：操作の失敗と誤解させない
- W12 写真・口コミ・説明が読み込まれる：閲覧中の細かな読み込みは無音
- B02 建築依頼が受理され、工事中になる：たかなの試聴指定により無音。
- B03 建築中の状態が続く：工事音の常時ループは疲れやすい
- B04 ほかのメンバーが建築を始める：たかなの試聴指定により無音。
- B10 失敗した建築を再試行する：たかなの試聴指定により無音。
- B11 建築上限に達してボタンが無効になる：押せないボタンへ繰り返し警告を付けない
- M01 地図をドラッグ・回転・傾斜・ピンチする：指の動きに常時音を付けない
- M04 地図の建物がまとまる／分かれる：地図操作のたびに鳴らさない
- M10 旅の再生を始める：たかなの試聴指定により無音。
- M15 最後まで再生し、しおりへ戻る：たかなの試聴指定により無音。
- S05 名前など共有情報の更新：基本は無音でよい
- S06 過去データの初回読み込み・再接続：過去の完成や参加を新着として鳴らさない
