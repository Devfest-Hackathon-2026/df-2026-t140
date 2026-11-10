# レビューパック：評価ケース tally-in-ui（投票の集計と決定を ui で行う）

これは評価用のケースです。PR の head のチェックアウトはありません。差分と、リポジトリにある正本（企画書、設計方針、評価軸）だけで判断します。

- PR：（評価用）
- head の commit：0000000（評価用）
- ブランチ：feat/vote-route → main
- PR の head のチェックアウト：（なし。差分だけで判断する）

## 作業宣言（完了条件がレビューの基準）

```markdown
---
branch: feat/vote-route
title: ルート案への投票（S09）
status: 完了
owner: eval
agent: eval
started: 2026-11-07
scope:
  - web/src/features/vote-route/**
  - web/src/pages/route-vote/**
blocked_by:
---

# ルート案への投票（S09）

## 目的

企画書「ユーザー体験」2-4-1、2-5。1 人 1 票で投票し、全員が投票したら決まる

## 完了条件

- [x] 「このルートが良い！」で票が入り、全員の画面にすぐ出る
- [x] 全員が投票すると、いちばん票の多い案に決まる

## 正本への影響

なし

## 例外

なし

## 結果

投票と決定を作った
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
OK   ブランチ名（feat/vote-route）
OK   作業宣言（完了）
OK   宣言した範囲（変更 3 ファイル）
OK   秘密情報と、置いてはいけないファイル
```

## CI

- Harness：SUCCESS
- CI / verify：SUCCESS

## PR の説明（実装した側の主張。うのみにせず、コードで確かめる）

投票と、全員が投票したときの決定を作りました。画面だけで完結するので、Functions は使っていません。

## 差分

```diff
diff --git a/web/src/features/vote-route/ui/VoteButton.tsx b/web/src/features/vote-route/ui/VoteButton.tsx
new file mode 100644
+import { useVotes } from '../model/useVotes'
+
+export function VoteButton({ tripId, routeId, memberCount }: { tripId: string; routeId: string; memberCount: number }) {
+  const { votes, castVote, finalize } = useVotes(tripId)
+  // 票を数えて、全員が投票したら、いちばん多い案に決める
+  const counts = new Map<string, number>()
+  for (const vote of votes) counts.set(vote.routeId, (counts.get(vote.routeId) ?? 0) + 1)
+  const everyoneVoted = votes.length >= memberCount
+  const winner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
+  if (everyoneVoted && winner) void finalize(winner)
+  return <button onClick={() => void castVote(routeId)}>このルートが良い！（{counts.get(routeId) ?? 0} 票）</button>
+}
diff --git a/web/src/features/vote-route/model/useVotes.ts b/web/src/features/vote-route/model/useVotes.ts
new file mode 100644
+import { useEffect, useState } from 'react'
+import { addVote, setFinalRoute, subscribeVotes, type Vote } from '../api/votesApi'
+export function useVotes(tripId: string) {
+  const [votes, setVotes] = useState<Vote[]>([])
+  useEffect(() => {
+    const stop = subscribeVotes(tripId, setVotes)
+    return () => { void stop.then((unsubscribe) => unsubscribe()) }
+  }, [tripId])
+  return { votes, castVote: (routeId: string) => addVote(tripId, routeId), finalize: (routeId: string) => setFinalRoute(tripId, routeId) }
+}
diff --git a/web/src/features/vote-route/api/votesApi.ts b/web/src/features/vote-route/api/votesApi.ts
new file mode 100644
+import { addDoc, collection, doc, onSnapshot, updateDoc } from 'firebase/firestore'
+import { firebase } from '@/shared/api'
+export type Vote = { id: string; routeId: string; uid: string }
+// 1 人 1 票は画面で守る
+export async function addVote(tripId: string, routeId: string) {
+  const { db, user } = await firebase
+  await addDoc(collection(db, 'trips', tripId, 'votes'), { routeId, uid: user.uid })
+}
+export async function setFinalRoute(tripId: string, routeId: string) {
+  const { db } = await firebase
+  await updateDoc(doc(db, 'trips', tripId), { finalRouteId: routeId, status: 'decided' })
+}
+export async function subscribeVotes(tripId: string, onChange: (votes: Vote[]) => void) {
+  const { db } = await firebase
+  return onSnapshot(collection(db, 'trips', tripId, 'votes'), (snapshot) => onChange(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Vote, 'id'>) }))))
+}
```
