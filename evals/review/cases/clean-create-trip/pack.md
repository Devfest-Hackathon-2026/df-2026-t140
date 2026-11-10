# レビューパック：評価ケース clean-create-trip（旅の作成（問題なし））

これは評価用のケースです。PR の head のチェックアウトはありません。差分と、リポジトリにある正本（企画書、設計方針、評価軸）だけで判断します。

- PR：（評価用）
- head の commit：0000000（評価用）
- ブランチ：feat/create-trip → main
- PR の head のチェックアウト：（なし。差分だけで判断する）

## 作業宣言（完了条件がレビューの基準）

```markdown
---
branch: feat/create-trip
title: 旅の作成（S01）
status: 完了
owner: eval
agent: eval
started: 2026-11-07
scope:
  - web/src/features/create-trip/**
  - web/src/entities/trip/**
  - firestore.rules
  - scripts/smoke.mjs
blocked_by:
---

# 旅の作成（S01）

## 目的

企画書「ユーザー体験」1。S01 でタイトル・日程・出発地を入れて旅を作れるようにする

## 完了条件

- [x] タイトルと開始日を入れて「旅を計画する」を押すと trips に 1 件でき、作った人が members に入る
- [x] タイトルが空なら押せない
- [x] 他人の旅は読めないことを確認テストで確かめた

## 正本への影響

なし

## 例外

なし

## 結果

S01 の旅の作成、Security Rules、確認テストを足した。npm run verify が通る
```

## 機械のチェック（ここは判断し直さない。NG と注意だけ R の項目に結びつける）

```text
OK   設計方針の層（5 ファイル）
OK   プロダクトに他社 AI の SDK がない
OK   CLAUDE.md・AGENTS.md・GEMINI.md の長さ
OK   文書のリンクとパス
OK   人の判断（todo/humans/）の書き方
OK   作業宣言（docs/work/）の書き方
OK   共通の skill と Claude Code 用の写し
OK   ブランチ名（feat/create-trip）
OK   作業宣言（完了）
OK   宣言した範囲（変更 7 ファイル）
OK   秘密情報と、置いてはいけないファイル
```

## CI

- Harness：SUCCESS
- CI / verify：SUCCESS

## PR の説明（実装した側の主張。うのみにせず、コードで確かめる）

S01 の旅の作成を足しました。ui は描画だけで、作成は model のフックから entities/trip の api を呼びます。Security Rules でメンバーだけが読めるようにし、確認テストを足しました。

## 差分

```diff
diff --git a/web/src/entities/trip/api/tripApi.ts b/web/src/entities/trip/api/tripApi.ts
new file mode 100644
+import { addDoc, collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
+import { firebase } from '@/shared/api'
+import type { TripDraft } from '../model/types'
+
+export async function createTrip(draft: TripDraft): Promise<string> {
+  const { db, user } = await firebase
+  const ref = await addDoc(collection(db, 'trips'), { ...draft, ownerUid: user.uid, createdAt: serverTimestamp() })
+  await setDoc(doc(db, 'trips', ref.id, 'members', user.uid), { joinedAt: serverTimestamp(), color: 'orange' })
+  return ref.id
+}
diff --git a/web/src/entities/trip/model/types.ts b/web/src/entities/trip/model/types.ts
new file mode 100644
+export type TripDraft = { title: string; startDate: string; endDate?: string; origin: string }
+export const TITLE_MAX = 60
diff --git a/web/src/entities/trip/index.ts b/web/src/entities/trip/index.ts
new file mode 100644
+export { TITLE_MAX, type TripDraft } from './model/types'
+export { createTrip } from './api/tripApi'
diff --git a/web/src/features/create-trip/model/useCreateTrip.ts b/web/src/features/create-trip/model/useCreateTrip.ts
new file mode 100644
+import { useState } from 'react'
+import { createTrip, TITLE_MAX, type TripDraft } from '@/entities/trip'
+
+export function useCreateTrip(onCreated: (tripId: string) => void) {
+  const [pending, setPending] = useState(false)
+  const [error, setError] = useState<string>()
+  const canSubmit = (draft: TripDraft) => draft.title.trim().length > 0 && draft.title.trim().length <= TITLE_MAX && draft.startDate !== '' && !pending
+  async function submit(draft: TripDraft) {
+    if (!canSubmit(draft)) return
+    setPending(true)
+    // 終了日が空なら日帰り。undefined のキーは Firestore に送らない
+    const { endDate, ...rest } = draft
+    try {
+      onCreated(await createTrip({ ...rest, title: draft.title.trim(), ...(endDate ? { endDate } : {}) }))
+    } catch (cause) {
+      setError((cause as Error).message)
+    } finally {
+      setPending(false)
+    }
+  }
+  return { submit, canSubmit, pending, error }
+}
diff --git a/web/src/features/create-trip/ui/CreateTripForm.tsx b/web/src/features/create-trip/ui/CreateTripForm.tsx
new file mode 100644
+import { useState } from 'react'
+import { TITLE_MAX, type TripDraft } from '@/entities/trip'
+import { useCreateTrip } from '../model/useCreateTrip'
+
+export function CreateTripForm({ onCreated }: { onCreated: (tripId: string) => void }) {
+  const [draft, setDraft] = useState<TripDraft>({ title: '', startDate: '', origin: '' })
+  const { submit, canSubmit, pending, error } = useCreateTrip(onCreated)
+  return (
+    <form onSubmit={(event) => { event.preventDefault(); void submit(draft) }}>
+      <input aria-label="タイトル" maxLength={TITLE_MAX} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
+      <input aria-label="開始日" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
+      <input aria-label="終了日" type="date" value={draft.endDate ?? ''} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
+      <input aria-label="出発地" value={draft.origin} onChange={(e) => setDraft({ ...draft, origin: e.target.value })} />
+      <button type="submit" disabled={!canSubmit(draft)}>{pending ? '作成中…' : '旅を計画する'}</button>
+      {error && <p role="alert">{error}</p>}
+    </form>
+  )
+}
diff --git a/web/src/features/create-trip/index.ts b/web/src/features/create-trip/index.ts
new file mode 100644
+export { CreateTripForm } from './ui/CreateTripForm'
diff --git a/firestore.rules b/firestore.rules
+    match /trips/{tripId} {
+      allow create: if request.auth != null && request.resource.data.ownerUid == request.auth.uid
+        && request.resource.data.title is string && request.resource.data.title.size() > 0 && request.resource.data.title.size() <= 60;
+      allow read: if request.auth != null && exists(/databases/$(database)/documents/trips/$(tripId)/members/$(request.auth.uid));
+      match /members/{uid} {
+        allow create: if request.auth != null && request.auth.uid == uid
+          && get(/databases/$(database)/documents/trips/$(tripId)).data.ownerUid == request.auth.uid;
+        allow read: if request.auth != null && exists(/databases/$(database)/documents/trips/$(tripId)/members/$(request.auth.uid));
+      }
+    }
diff --git a/scripts/smoke.mjs b/scripts/smoke.mjs
+await check('他人の旅は読めない', async () => {
+  const response = await call(`${urls.firestore}/${database}/trips/${othersTripId}`, { token })
+  assert.equal(response.status, 403)
+})
```
