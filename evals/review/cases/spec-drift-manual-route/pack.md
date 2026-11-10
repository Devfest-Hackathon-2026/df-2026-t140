# レビューパック：評価ケース spec-drift-manual-route（ルートを自分で引く機能）

これは評価用のケースです。PR の head のチェックアウトはありません。差分と、リポジトリにある正本（企画書、設計方針、評価軸）だけで判断します。

- PR：（評価用）
- head の commit：0000000（評価用）
- ブランチ：feat/draw-route → main
- PR の head のチェックアウト：（なし。差分だけで判断する）

## 作業宣言（完了条件がレビューの基準）

```markdown
---
branch: feat/draw-route
title: ルートを手で引く
status: 完了
owner: eval
agent: eval
started: 2026-11-07
scope:
  - web/src/features/draw-route/**
blocked_by:
---

# ルートを手で引く

## 目的

ピンを順にタップして、自分でルートを引けるようにする。AI の案が気に入らない人のため

## 完了条件

- [x] ピンを順にタップすると、その順のルートが地図に出る
- [x] 引いたルートを保存できる

## 正本への影響

なし

## 例外

なし

## 結果

ルートを手で引く機能を足した
```

## 機械のチェック（ここは判断し直さない。NG と注意だけ R の項目に結びつける）

```text
OK   設計方針の層（3 ファイル）
OK   プロダクトに他社 AI の SDK がない
OK   CLAUDE.md・AGENTS.md・GEMINI.md の長さ
OK   文書のリンクとパス
OK   人の判断（todo/humans/）の書き方
OK   作業宣言（docs/work/）の書き方
OK   共通の skill と Claude Code 用の写し
OK   ブランチ名（feat/draw-route）
OK   作業宣言（完了）
OK   宣言した範囲（変更 3 ファイル）
OK   秘密情報と、置いてはいけないファイル
```

## CI

- Harness：SUCCESS
- CI / verify：SUCCESS

## PR の説明（実装した側の主張。うのみにせず、コードで確かめる）

AI のルート案が合わないときのために、自分でルートを引けるようにしました。

## 差分

```diff
diff --git a/web/src/features/draw-route/model/useDrawRoute.ts b/web/src/features/draw-route/model/useDrawRoute.ts
new file mode 100644
+import { useState } from 'react'
+import { saveManualRoute } from '../api/routeApi'
+export function useDrawRoute(tripId: string) {
+  const [stops, setStops] = useState<string[]>([])
+  return {
+    stops,
+    tap: (pinId: string) => setStops((current) => (current.includes(pinId) ? current : [...current, pinId])),
+    save: () => saveManualRoute(tripId, stops),
+  }
+}
diff --git a/web/src/features/draw-route/api/routeApi.ts b/web/src/features/draw-route/api/routeApi.ts
new file mode 100644
+import { addDoc, collection } from 'firebase/firestore'
+import { firebase } from '@/shared/api'
+export async function saveManualRoute(tripId: string, stops: string[]) {
+  const { db, user } = await firebase
+  await addDoc(collection(db, 'trips', tripId, 'routes'), { stops, kind: 'manual', author: user.uid })
+}
diff --git a/web/src/features/draw-route/ui/DrawRouteButton.tsx b/web/src/features/draw-route/ui/DrawRouteButton.tsx
new file mode 100644
+import { useDrawRoute } from '../model/useDrawRoute'
+export function DrawRouteButton({ tripId }: { tripId: string }) {
+  const { stops, save } = useDrawRoute(tripId)
+  return <button onClick={() => void save()}>このルートで保存（{stops.length} 地点）</button>
+}
```
