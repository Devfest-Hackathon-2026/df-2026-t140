# レビューパック：評価ケース weak-exception（理由の弱い例外）

これは評価用のケースです。PR の head のチェックアウトはありません。差分と、リポジトリにある正本（企画書、設計方針、評価軸）だけで判断します。

- PR：（評価用）
- head の commit：0000000（評価用）
- ブランチ：feat/pin-layer → main
- PR の head のチェックアウト：（なし。差分だけで判断する）

## 作業宣言（完了条件がレビューの基準）

```markdown
---
branch: feat/pin-layer
title: ピンを地図に出す
status: 完了
owner: eval
agent: eval
started: 2026-11-07
scope:
  - web/src/widgets/pin-layer/**
blocked_by:
---

# ピンを地図に出す

## 目的

企画書「ユーザー体験」2-2。関連する場所に候補のピンが立つ

## 完了条件

- [x] 全員の地図に、ほかの人のピンもすぐ出る

## 正本への影響

なし

## 例外

web/src/widgets/pin-layer/ui/PinLayer.tsx で ui から Firestore を直接読む

## 結果

ピンを出す部品を作った
```

## 機械のチェック（ここは判断し直さない。NG と注意だけ R の項目に結びつける）

```text
OK   設計方針の層（2 ファイル）
OK   プロダクトに他社 AI の SDK がない
OK   CLAUDE.md・AGENTS.md・GEMINI.md の長さ
OK   文書のリンクとパス
OK   人の判断（todo/humans/）の書き方
OK   作業宣言（docs/work/）の書き方
OK   共通の skill と Claude Code 用の写し
OK   ブランチ名（feat/pin-layer）
OK   作業宣言（完了）
OK   宣言した範囲（変更 2 ファイル）
OK   秘密情報と、置いてはいけないファイル
情報 例外（@harness-exception）1 件
      web/src/widgets/pin-layer/ui/PinLayer.tsx:2 [ui/no-data-access] 時間がないため
```

## CI

- Harness：SUCCESS
- CI / verify：SUCCESS

## PR の説明（実装した側の主張。うのみにせず、コードで確かめる）

ピンを地図に出す部品です。時間がないので、ui から直接 Firestore を読んでいます（例外として書きました）。

## 差分

```diff
diff --git a/web/src/widgets/pin-layer/ui/PinLayer.tsx b/web/src/widgets/pin-layer/ui/PinLayer.tsx
new file mode 100644
+import { useEffect, useState } from 'react'
+// @harness-exception ui/no-data-access 理由：時間がないため
+import { collection, onSnapshot } from 'firebase/firestore'
+import { firebase } from '@/shared/api'
+
+export function PinLayer({ tripId }: { tripId: string }) {
+  const [pins, setPins] = useState<{ id: string; name: string; lat: number; lng: number }[]>([])
+  useEffect(() => {
+    void firebase.then(({ db }) =>
+      onSnapshot(collection(db, 'trips', tripId, 'pins'), (snapshot) =>
+        setPins(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as { name: string; lat: number; lng: number }) }))),
+      ),
+    )
+  }, [tripId])
+  return <>{pins.map((pin) => <div key={pin.id} data-lat={pin.lat} data-lng={pin.lng}>{pin.name}</div>)}</>
+}
diff --git a/web/src/widgets/pin-layer/index.ts b/web/src/widgets/pin-layer/index.ts
new file mode 100644
+export { PinLayer } from './ui/PinLayer'
```
