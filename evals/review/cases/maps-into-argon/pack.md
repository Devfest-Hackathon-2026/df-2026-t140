# レビューパック：評価ケース maps-into-argon（建築で Places の説明を Argon に渡す）

これは評価用のケースです。PR の head のチェックアウトはありません。差分と、リポジトリにある正本（企画書、設計方針、評価軸）だけで判断します。

- PR：（評価用）
- head の commit：0000000（評価用）
- ブランチ：feat/build-model → main
- PR の head のチェックアウト：（なし。差分だけで判断する）

## 作業宣言（完了条件がレビューの基準）

```markdown
---
branch: feat/build-model
title: 建築する（模型の生成）
status: 完了
owner: eval
agent: eval
started: 2026-11-07
scope:
  - functions/src/features/build-model/**
  - functions/src/adapters/argon.ts
  - functions/src/ports/model-generator.ts
  - functions/src/index.ts
blocked_by:
---

# 建築する（模型の生成）

## 目的

企画書「ユーザー体験」2-3。ピンで「建築する！」を押すと、裏で模型が作られる

## 完了条件

- [x] 「建築する！」で pins の status が building になり、完成すると built になる
- [x] 2 回同じイベントが来ても 1 回だけ生成する

## 正本への影響

なし

## 例外

なし

## 結果

建築の流れを作った。模型の見た目を良くするため、場所の説明も入力に入れた
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
OK   ブランチ名（feat/build-model）
OK   作業宣言（完了）
OK   宣言した範囲（変更 4 ファイル）
OK   秘密情報と、置いてはいけないファイル
```

## CI

- Harness：SUCCESS
- CI / verify：SUCCESS

## PR の説明（実装した側の主張。うのみにせず、コードで確かめる）

建築を足しました。模型の質を上げるため、ピンに保存してある場所の説明（placeSummary）と口コミもプロンプトに入れています。冪等にしてあります。

## 差分

```diff
diff --git a/functions/src/features/build-model/usecase.ts b/functions/src/features/build-model/usecase.ts
new file mode 100644
+import { FieldValue } from 'firebase-admin/firestore'
+import type { Deps } from '../../ports/deps.js'
+import { buildModelPrompt } from './prompt.js'
+
+// pins/{pinId} の placeSummary と placeReviews は、提案のときに Places API（Place Details）の結果から保存したもの
+export async function buildModel(deps: Deps, input: { tripId: string; pinId: string; eventId: string }) {
+  const ref = deps.db.doc(`trips/${input.tripId}/pins/${input.pinId}`)
+  const claimed = await deps.db.runTransaction(async (tx) => {
+    const pin = await tx.get(ref)
+    if (pin.get('status') !== 'requested') return undefined
+    tx.update(ref, { status: 'building', eventId: input.eventId })
+    return pin.data()
+  })
+  if (!claimed) return
+  const prompt = buildModelPrompt({ name: claimed.name, userWords: claimed.userWords, placeSummary: claimed.placeSummary, reviews: claimed.placeReviews })
+  const model = await deps.modelGenerator.generate(prompt)
+  await deps.db.doc(`trips/${input.tripId}/pins/${input.pinId}/model/current`).set(model)
+  await ref.update({ status: 'built', builtAt: FieldValue.serverTimestamp() })
+}
diff --git a/functions/src/features/build-model/prompt.ts b/functions/src/features/build-model/prompt.ts
new file mode 100644
+export function buildModelPrompt(input: { name: string; userWords: string; placeSummary?: string; reviews?: string[] }) {
+  return [
+    `場所の名前：${input.name}`,
+    `利用者の一言：${input.userWords}`,
+    input.placeSummary ? `場所の説明：${input.placeSummary}` : '',
+    input.reviews?.length ? `口コミ：${input.reviews.slice(0, 3).join(' / ')}` : '',
+    'この場所を表すローポリの模型を、決められた JSON の形で返す',
+  ].filter(Boolean).join('\n')
+}
```
