// 設計方針のルール一覧。説明の原本は docs/architecture/design-principles.md。
// machine：scripts/harness/lib/arch.mjs が機械で確かめる。judgement：レビュー役（人と AI）が見る。
// ここに足したら、design-principles.md にも同じ ID を書く（テストで確かめている）。

export const DESIGN_DOC = 'docs/architecture/design-principles.md'

export const RULES = {
  // フロントエンド（web/src、Feature-Sliced Design）
  'layer/placement': { kind: 'machine', summary: 'web/src のコードは FSD の層（app、pages、widgets、features、entities、shared）のどれかに置く' },
  'layer/direction': { kind: 'machine', summary: '上の層は下の層だけを使う（app > pages > widgets > features > entities > shared）' },
  'layer/no-cross-slice': { kind: 'machine', summary: '同じ層のほかのスライスを直接使わない' },
  'layer/public-api': { kind: 'machine', summary: 'ほかのスライスは index.ts（公開の入口）からだけ使う' },
  'ui/no-data-access': { kind: 'machine', summary: 'ui の部品は Firebase、Gemini、api セグメント、fetch を直接使わない（型だけは可）' },
  'ui/render-only': { kind: 'judgement', summary: 'ui の部品は描画と、表示だけの状態（開閉など）に限る。計算や判断は model に置く' },
  'segment/no-jsx-outside-ui': { kind: 'machine', summary: '.tsx（JSX）は ui セグメントと app 層だけに置く' },
  'data/firebase-in-api': { kind: 'machine', summary: 'firebase の読み書きは api セグメント（と app の初期化）に閉じる' },

  // バックエンド（functions/src、縦のスライス + ポートとアダプター）
  'fn/placement': { kind: 'machine', summary: 'functions/src のコードは app、features、adapters、ports、domain、shared のどれかに置き、feature の中は handler、usecase、logic、prompt、ports、types、index に分ける' },
  'fn/layer-direction': { kind: 'machine', summary: '依存は内側へ向ける。features は ports、domain、shared を使い、adapters の実体を使うのは handler だけ。app は features を知らず、つなぐのは index.ts' },
  'fn/no-cross-feature': { kind: 'machine', summary: 'feature どうしは直接使わない。共通の規則は domain に置き、機能どうしは Firestore の状態でつなぐ' },
  'fn/public-api': { kind: 'machine', summary: 'feature は index.ts（公開の入口）からだけ使う' },
  'fn/sdk-boundary': { kind: 'machine', summary: 'Gemini と Maps の SDK は adapters だけ、firebase-functions は handler と app だけ、firebase-admin/firestore は usecase と adapters だけが使う' },
  'fn/pure-core': { kind: 'machine', summary: 'domain、ports、logic、prompt は I/O（fs、child_process、fetch など）を使わない' },
  'fn/idempotent': { kind: 'judgement', summary: 'Firestore のトリガーは同じイベントが 2 回来ても、順番が入れ替わっても結果が変わらないように書く' },
  'fn/lazy-init': { kind: 'judgement', summary: 'SDK のクライアントはモジュールの読み込み時に作らず、最初に使うときに作る（コールドスタートとデプロイ時の読み込みを遅くしない）' },

  // 両方
  'security/no-eval': { kind: 'machine', summary: 'eval や new Function で文字列をコードとして実行しない（AI が書いたコードは実行しない）' },
  'maps/no-generation-input': { kind: 'machine', summary: '3D 生成の入力を作るコードは、Maps 由来のデータを扱うモジュールを使わない（規約 3.2.3(c)）' },
  'cost/gemini-guarded': { kind: 'judgement', summary: 'Gemini を呼ぶ経路は、ログイン確認と回数の上限を必ず通る' },
  'spec/proposal-first': { kind: 'judgement', summary: '何を作るかが変わる実装は、先に企画書を直す' },
}

export const isKnownRule = (id) => Object.hasOwn(RULES, id)
