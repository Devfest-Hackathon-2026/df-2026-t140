// Deploy ワークフローが、関数の環境変数のファイル（functions/.env.<プロジェクト>）を書く。
// 値は GitHub の variable と secret から環境変数で受け取る（.github/workflows/deploy.yml）。
// リポジトリには置かない（.gitignore）。手元で実行する必要はない。
//
//   GEMINI_PROVIDER     stub | agy | vertex。空なら書かない（固定の応答）
//   VERTEX_FLASH_MODEL  Vertex の Flash のモデル名。空なら書かない（functions/src/adapters/gemini/vertex.ts の既定）
//   VERTEX_ARGON_MODEL  Vertex の Argon（模型）のモデル名。空なら書かない（同じく vertex.ts の既定）
//   AI_PASSPHRASE       合言葉。空なら書かない（合言葉は使えず、本物の AI は誰も呼べない）
//   ROUTES_API_KEY      しおりの移動時間を聞く Routes API のキー。空なら書かない（移動時間は直線距離の目安のまま。
//                       todo/humans/2026-11-07-shiori-routes-api.md、functions/src/adapters/routes-api.ts）
//   PLACES_API_KEY      建てる場所を確かめる Places API（テキスト検索）のキー。空なら書かない（ピンの位置は Gemini の推測のまま。
//                       todo/humans/2026-11-08-places-verify-suggestions.md、functions/src/adapters/places-api.ts）
//   PLACES_REVIEWS      on なら、場所の情報に Google マップの口コミを出す（Place Details の別の料金の区分）。空なら書かない（出さない。
//                       todo/humans/2026-11-08-places-reviews.md、functions/src/features/place-reviews）
//   PLACES_PHOTOS       on なら、口コミと一緒に Google マップの写真を 1 枚出す（Place Photo の別の料金の区分）。空なら書かない（出さない。
//                       人が写真の 1 日の上限を 0 回から上げてから。todo/humans/2026-11-07-places-photos-reviews.md）
//   KG_API_KEY          模型の見た目の参考に、場所の名前を引く Knowledge Graph Search API のキー。空なら書かない（参考なしで作る。
//                       todo/humans/2026-11-08-model-kg-description.md、functions/src/adapters/knowledge-graph.ts）
//
// 本番で vertex を有効にするのは人（todo/humans/2026-11-07-vertex-gemini-passphrase.md）。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PROJECT_ID = 'konbu-devfest-hackathon-2026'
const NAMES = ['GEMINI_PROVIDER', 'VERTEX_FLASH_MODEL', 'VERTEX_ARGON_MODEL', 'AI_PASSPHRASE', 'ROUTES_API_KEY', 'PLACES_API_KEY', 'PLACES_REVIEWS', 'PLACES_PHOTOS', 'KG_API_KEY']

const lines = NAMES.map((name) => [name, process.env[name]?.trim() ?? ''])
  .filter(([, value]) => value.length > 0)
  .map(([name, value]) => {
    if (/[\n\r"\\]/.test(value)) throw new Error(`${name} に改行、引用符、バックスラッシュは使えません`)
    return `${name}="${value}"`
  })

const file = join('functions', `.env.${PROJECT_ID}`)
writeFileSync(file, lines.length > 0 ? `${lines.join('\n')}\n` : '')
console.log(`${file} に ${lines.map(([name]) => name).join('、') || '何も'}書きました（値は出しません）`)
