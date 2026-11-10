// 層のチェックの評価用の入力セット。
// VALID は「こう書く」の見本でもある（docs/architecture/design-principles.md から参照している）。
// バックエンドの見本は、縦のスライス（features/<機能>）＋ポートとアダプター＋純粋な logic の組み立て方を示す。

export const VALID = {
  // ---- フロントエンド（FSD） ----
  'web/src/main.tsx': `import { createRoot } from 'react-dom/client'
import { App } from './app/App'
createRoot(document.getElementById('root')!).render(<App />)`,
  'web/src/app/App.tsx': `import { TripCreatePage } from '@/pages/trip-create'
export function App() { return <TripCreatePage /> }`,
  'web/src/pages/trip-create/index.ts': `export { TripCreatePage } from './ui/TripCreatePage'`,
  'web/src/pages/trip-create/ui/TripCreatePage.tsx': `import { CreateTripForm } from '@/features/create-trip'
export function TripCreatePage() { return <main><CreateTripForm /></main> }`,
  'web/src/features/create-trip/index.ts': `export { CreateTripForm } from './ui/CreateTripForm'`,
  'web/src/features/create-trip/ui/CreateTripForm.tsx': `import { useState } from 'react'
import type { Trip } from '@/entities/trip'
import { Button } from '@/shared/ui/button'
import { useCreateTrip } from '../model/useCreateTrip'
// 表示だけの状態（開閉）は ui に置いてよい
export function CreateTripForm() {
  const [open, setOpen] = useState(false)
  const { create, pending } = useCreateTrip()
  const draft: Partial<Trip> = {}
  return <form onSubmit={() => create(draft)}><Button disabled={pending} onClick={() => setOpen(!open)}>旅を計画する</Button></form>
}`,
  'web/src/features/create-trip/model/useCreateTrip.ts': `import { useState } from 'react'
import { createTrip, type Trip } from '@/entities/trip'
export function useCreateTrip() {
  const [pending, setPending] = useState(false)
  async function create(draft: Partial<Trip>) { setPending(true); await createTrip(draft); setPending(false) }
  return { create, pending }
}`,
  'web/src/entities/trip/index.ts': `export type { Trip } from './model/types'
export { createTrip, subscribeTrip } from './api/tripApi'`,
  'web/src/entities/trip/model/types.ts': `export type Trip = { id: string; title: string; startDate: string; endDate?: string }`,
  'web/src/entities/trip/api/tripApi.ts': `import { addDoc, collection, doc, onSnapshot } from 'firebase/firestore'
import { firebase } from '@/shared/api'
import type { Trip } from '../model/types'
export async function createTrip(draft: Partial<Trip>) { const { db } = await firebase; return addDoc(collection(db, 'trips'), draft) }
export function subscribeTrip(id: string, onChange: (trip: Trip) => void) { return firebase.then(({ db }) => onSnapshot(doc(db, 'trips', id), (snap) => onChange(snap.data() as Trip))) }`,
  'web/src/shared/api/index.ts': `export { firebase } from './firebase'`,
  'web/src/shared/api/firebase.ts': `import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
export const firebase = Promise.resolve({ db: getFirestore(initializeApp({})) })`,
  'web/src/shared/ui/button/index.ts': `export { Button } from './Button'`,
  'web/src/shared/ui/button/Button.tsx': `export function Button(props: { disabled?: boolean; onClick?: () => void; children?: unknown }) { return <button {...props} /> }`,
  'web/src/features/create-trip/ui/Hint.tsx': `// import { getDocs } from 'firebase/firestore'（コメントの中は数えない）
export const Hint = () => <p>{'fetch( と書いた文字列も数えない'}</p>`,

  // ---- バックエンド（縦のスライス + ポートとアダプター） ----
  // index.ts：Firebase が読む関数の一覧。1 機能 1 行でつなぐだけ
  'functions/src/index.ts': `import { getDeps } from './app/deps.js'
import { createSuggestPlaces } from './features/suggest-places/index.js'
export const suggestPlaces = createSuggestPlaces(getDeps)`,
  // app：どの実体を使うかを選ぶだけ。features は知らない。SDK は初めて使うときに読み込む
  'functions/src/app/deps.ts': `import { getFirestore } from 'firebase-admin/firestore'
import type { Deps } from '../ports/deps.js'
let llm: Deps['llm'] | undefined
export function getDeps(): Deps {
  return {
    db: getFirestore(),
    llm: {
      async suggestPlaces(input) {
        if (!llm) {
          const { createLlm } = await import(process.env.GEMINI_PROVIDER === 'vertex' ? '../adapters/llm-vertex.js' : '../adapters/llm-stub.js')
          llm = createLlm()
        }
        return llm.suggestPlaces(input)
      },
    },
  }
}`,
  'functions/src/ports/deps.ts': `import type { Firestore } from 'firebase-admin/firestore'
import type { LlmPort } from './llm.js'
export type Deps = { db: Firestore; llm: LlmPort }`,
  'functions/src/ports/llm.ts': `import type { PlaceSuggestion } from '../domain/place.js'
export interface LlmPort { suggestPlaces(input: { wish: string; area?: string }): Promise<PlaceSuggestion[]> }`,
  'functions/src/adapters/llm-stub.ts': `import type { LlmPort } from '../ports/llm.js'
export function createLlm(): LlmPort { return { async suggestPlaces() { return [{ name: '固定の場所', description: 'ローカルの固定応答' }] } } }`,
  'functions/src/adapters/llm-vertex.ts': `import { GoogleGenAI } from '@google/genai'
import type { LlmPort } from '../ports/llm.js'
export function createLlm(): LlmPort { const ai = new GoogleGenAI({ vertexai: true }); return { async suggestPlaces() { void ai; return [] } } }`,
  'functions/src/domain/place.ts': `import { LIMITS } from '../shared/limits.js'
export type PlaceSuggestion = { name: string; description: string }
export const clampSuggestions = (items: PlaceSuggestion[]) => items.slice(0, LIMITS.pinsPerWish)`,
  'functions/src/shared/limits.ts': `export const LIMITS = { pinsPerWish: 3 }`,
  // feature：handler（入口）→ usecase（読む・決める・書く）→ logic（純粋な判断）
  'functions/src/features/suggest-places/index.ts': `export { createSuggestPlaces } from './handler.js'`,
  'functions/src/features/suggest-places/handler.ts': `import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import type { Deps } from '../../ports/deps.js'
import { suggestPlacesForWish } from './usecase.js'
export const createSuggestPlaces = (getDeps: () => Deps) =>
  onDocumentCreated('trips/{tripId}/wishes/{wishId}', (event) => suggestPlacesForWish(getDeps(), { eventId: event.id, tripId: event.params.tripId, wishId: event.params.wishId }))`,
  'functions/src/features/suggest-places/usecase.ts': `import { FieldValue } from 'firebase-admin/firestore'
import type { Deps } from '../../ports/deps.js'
import { decidePins } from './logic.js'
import { buildPrompt } from './prompt.js'
// 同じイベントが 2 回来ても 1 回分だけ書く（状態を見てから進める）
export async function suggestPlacesForWish(deps: Deps, input: { eventId: string; tripId: string; wishId: string }) {
  const ref = deps.db.doc(\`trips/\${input.tripId}/wishes/\${input.wishId}\`)
  const claimed = await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (snap.get('status') !== 'new') return false
    tx.update(ref, { status: 'suggesting', eventId: input.eventId, updatedAt: FieldValue.serverTimestamp() })
    return true
  })
  if (!claimed) return
  const suggestions = await deps.llm.suggestPlaces({ wish: buildPrompt(String((await ref.get()).get('text'))) })
  await ref.update({ status: 'suggested', pins: decidePins(suggestions) })
}`,
  'functions/src/features/suggest-places/logic.ts': `import { clampSuggestions, type PlaceSuggestion } from '../../domain/place.js'
export const decidePins = (items: PlaceSuggestion[]) => clampSuggestions(items).map((item, index) => ({ ...item, order: index }))`,
  'functions/src/features/suggest-places/prompt.ts': `export const buildPrompt = (wish: string) => \`旅の希望：\${wish}\``,
  // もう 1 つの組み立て方：機能の handler が adapters の実体を logic に渡す（その機能だけで使うとき。PR #12 の ping の形）
  'functions/src/features/ping/index.ts': `export { pingGemini } from './handler.js'`,
  'functions/src/features/ping/handler.ts': `import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { createLlm } from '../../adapters/llm-stub.js'
import { ping } from './logic.js'
export const pingGemini = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ログインが必要です')
  return ping({ llm: createLlm() })
})`,
  'functions/src/features/ping/ports.ts': `import type { LlmPort } from '../../ports/llm.js'
export interface PingPorts { llm: LlmPort }`,
  'functions/src/features/ping/logic.ts': `import type { PingPorts } from './ports.js'
export async function ping(ports: PingPorts) { const items = await ports.llm.suggestPlaces({ wish: 'ping' }); return { text: items[0]?.name ?? '' } }`,
}

// [ファイル, 中身, 出るはずのルール]
export const INVALID = [
  ['web/src/App.tsx', `export const App = () => null`, 'layer/placement'],
  ['web/src/components/Button.tsx', `export const Button = () => null`, 'layer/placement'],
  ['web/src/features/helpers.ts', `export const x = 1`, 'layer/placement'],
  ['web/src/features/a/model/x.ts', `import { y } from '../../b/model/y'`, 'layer/no-cross-slice'],
  ['web/src/entities/trip/model/x.ts', `import { CreateTripForm } from '@/features/create-trip'`, 'layer/direction'],
  ['web/src/shared/lib/x.ts', `import { createTrip } from '@/entities/trip'`, 'layer/direction'],
  ['web/src/pages/p/model/x.ts', `import { store } from '@/entities/trip/model/store'`, 'layer/public-api'],
  ['web/src/features/f/ui/Btn.tsx', `import { getDocs } from 'firebase/firestore'\nexport const Btn = () => null`, 'ui/no-data-access'],
  ['web/src/features/f/ui/Btn.tsx', `import { save } from '../api/save'\nexport const Btn = () => null`, 'ui/no-data-access'],
  ['web/src/features/f/ui/Btn.tsx', `export const Btn = () => { void fetch('/x'); return null }`, 'ui/no-data-access'],
  ['web/src/widgets/w/ui/Map.tsx', `import { GoogleGenAI } from '@google/genai'\nexport const Map = () => null`, 'ui/no-data-access'],
  ['web/src/features/f/model/x.ts', `import { getDocs } from 'firebase/firestore'`, 'data/firebase-in-api'],
  ['web/src/features/f/model/View.tsx', `export const View = () => <div />`, 'segment/no-jsx-outside-ui'],
  ['web/src/entities/model3d/lib/run.ts', `export const run = (code: string) => eval(code)`, 'security/no-eval'],
  ['web/src/entities/model3d/lib/run2.ts', `export const run = (code: string) => new Function(code)`, 'security/no-eval'],
  ['web/src/features/build-model/api/request.ts', `import { getPlace } from '@/entities/place'`, 'maps/no-generation-input'],
  ['functions/src/helper.ts', `export const x = 1`, 'fn/placement'],
  ['functions/src/services/x.ts', `export const x = 1`, 'fn/placement'],
  ['functions/src/features/x/utils.ts', `export const x = 1`, 'fn/placement'],
  ['functions/src/features/a/usecase.ts', `import { b } from '../b/index.js'`, 'fn/no-cross-feature'],
  ['functions/src/features/a/usecase.ts', `import { createLlm } from '../../adapters/llm-vertex.js'`, 'fn/layer-direction'],
  ['functions/src/features/a/logic.ts', `import { getDeps } from '../../app/deps.js'`, 'fn/layer-direction'],
  ['functions/src/features/a/logic.ts', `import { createLlm } from '../../adapters/llm-stub.js'`, 'fn/layer-direction'],
  ['functions/src/ping/handler.ts', `export const x = 1`, 'fn/placement'],
  ['functions/src/features/a/ports.ts', `import { readFileSync } from 'node:fs'`, 'fn/pure-core'],
  ['functions/src/app/deps.ts', `import { createA } from '../features/a/index.js'`, 'fn/layer-direction'],
  ['functions/src/domain/x.ts', `import { createLlm } from '../adapters/llm-stub.js'`, 'fn/layer-direction'],
  ['functions/src/index.ts', `import { createLlm } from './adapters/llm-stub.js'`, 'fn/layer-direction'],
  ['functions/src/index.ts', `import { createA } from './features/a/handler.js'`, 'fn/public-api'],
  ['functions/src/features/a/usecase.ts', `import { GoogleGenAI } from '@google/genai'`, 'fn/sdk-boundary'],
  ['functions/src/features/a/logic.ts', `import { onCall } from 'firebase-functions/v2/https'`, 'fn/sdk-boundary'],
  ['functions/src/domain/x.ts', `import { getFirestore } from 'firebase-admin/firestore'`, 'fn/sdk-boundary'],
  ['functions/src/features/a/handler.ts', `import { getAuth } from 'firebase-admin/auth'`, 'fn/sdk-boundary'],
  ['functions/src/features/a/logic.ts', `import { readFileSync } from 'node:fs'`, 'fn/pure-core'],
  ['functions/src/ports/x.ts', `import { spawn } from 'child_process'`, 'fn/pure-core'],
  ['functions/src/domain/x.ts', `export const get = () => fetch('https://example.com')`, 'fn/pure-core'],
  ['functions/src/features/generate-model/usecase.ts', `import type { PlacesPort } from '../../ports/places.js'\nimport { x } from '../../ports/places.js'`, 'maps/no-generation-input'],
]
