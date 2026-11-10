# レビューパック：評価ケース uncapped-gemini（誰でも何度でも呼べる Gemini の関数）

これは評価用のケースです。PR の head のチェックアウトはありません。差分と、リポジトリにある正本（企画書、設計方針、評価軸）だけで判断します。

- PR：（評価用）
- head の commit：0000000（評価用）
- ブランチ：feat/propose-routes → main
- PR の head のチェックアウト：（なし。差分だけで判断する）

## 作業宣言（完了条件がレビューの基準）

```markdown
---
branch: feat/propose-routes
title: ルート案の提案
status: 完了
owner: eval
agent: eval
started: 2026-11-07
scope:
  - functions/src/features/propose-routes/**
  - functions/src/index.ts
blocked_by:
---

# ルート案の提案

## 目的

企画書「ユーザー体験」2-4。建物が建つたびに AI がルート案を考え直す

## 完了条件

- [x] 呼ぶと 3 案とキャッチコピーが返る

## 正本への影響

なし

## 例外

なし

## 結果

ルート案の関数を足した
```

## 機械のチェック（ここは判断し直さない。NG と注意だけ R の項目に結びつける）

```text
OK   設計方針の層（4 ファイル）
OK   プロダクトに他社 AI の SDK がない
OK   CLAUDE.md・AGENTS.md・GEMINI.md の長さ
OK   文書のリンクとパス
OK   人の判断（todo/humans/）の書き方
OK   作業宣言（docs/work/）の書き方
OK   共通の skill と Claude Code 用の写し
OK   ブランチ名（feat/propose-routes）
OK   作業宣言（完了）
OK   宣言した範囲（変更 3 ファイル）
OK   秘密情報と、置いてはいけないファイル
```

## CI

- Harness：SUCCESS
- CI / verify：SUCCESS

## PR の説明（実装した側の主張。うのみにせず、コードで確かめる）

画面から呼べるルート案の関数を足しました。すぐ試せるよう、ログインなしでも呼べます。

## 差分

```diff
diff --git a/functions/src/features/propose-routes/handler.ts b/functions/src/features/propose-routes/handler.ts
new file mode 100644
+import { onCall } from 'firebase-functions/v2/https'
+import type { Deps } from '../../ports/deps.js'
+import { proposeRoutes } from './usecase.js'
+export const createProposeRoutes = (getDeps: () => Deps) =>
+  onCall({ timeoutSeconds: 120, maxInstances: 20 }, async (request) => proposeRoutes(getDeps(), { tripId: String(request.data?.tripId ?? '') }))
diff --git a/functions/src/features/propose-routes/usecase.ts b/functions/src/features/propose-routes/usecase.ts
new file mode 100644
+import type { Deps } from '../../ports/deps.js'
+import { pickThree } from './logic.js'
+export async function proposeRoutes(deps: Deps, input: { tripId: string }) {
+  const pins = await deps.db.collection(`trips/${input.tripId}/pins`).where('status', '==', 'built').get()
+  // 何回呼ばれても毎回 Gemini に聞く
+  const ideas = await deps.llm.proposeRoutes({ stops: pins.docs.map((d) => d.get('name')) })
+  return { routes: pickThree(ideas) }
+}
```
