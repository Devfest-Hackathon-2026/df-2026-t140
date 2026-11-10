import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkArchitecture } from '../lib/arch.mjs'
import { treeSource } from '../lib/checks.mjs'
import { repoRoot } from '../lib/proc.mjs'
import { INVALID, VALID } from './cases/arch-cases.mjs'

const files = (record) => Object.entries(record).map(([path, text]) => ({ path, text }))
const describe = (result) => result.violations.map((item) => `${item.path}:${item.line} ${item.rule}`).join('\n')

test('正常系：見本の組み立て（web の FSD、functions のスライス）は違反なし', () => {
  const result = checkArchitecture(files(VALID))
  assert.equal(result.violations.length, 0, describe(result))
  assert.equal(result.errors.length, 0)
})

test('異常系：それぞれの違反を、決めたルールで見つける', () => {
  for (const [path, text, rule] of INVALID) {
    const result = checkArchitecture([{ path, text }])
    assert.ok(
      result.violations.some((item) => item.rule === rule),
      `${path}：${rule} が出るはず（実際：${result.violations.map((item) => item.rule).join(',') || 'なし'}）\n${text}`,
    )
  }
})

test('型だけの import は、ui からでも使える', () => {
  const result = checkArchitecture([
    { path: 'web/src/features/f/ui/A.tsx', text: `import type { Firestore } from 'firebase/firestore'\nimport { type Trip } from '../api/types'\nexport const A = () => null` },
  ])
  assert.equal(result.violations.length, 0, describe(result))
})

test('例外：理由を書いた @harness-exception は、その行の違反を外す', () => {
  const result = checkArchitecture([
    {
      path: 'web/src/features/f/ui/A.tsx',
      text: `/*
 * @harness-exception ui/no-data-access
 * 理由：地図の SDK の初期化が描画と切り離せないため（代替案：model へ移す → 描画のたびに作り直しになる）
 * 解消条件：地図の部品を widgets に移すとき
 */
import { getDocs } from 'firebase/firestore'
import { save } from '../api/save'
export const A = () => null`,
    },
  ])
  // 1 行目の import だけが外れ、次の行は違反のまま
  assert.equal(result.suppressed.length, 1)
  assert.equal(result.violations.length, 1)
  assert.equal(result.violations[0].line, 7)
})

test('例外：ファイル全体の例外、理由のない例外、知らないルール、使われていない例外', () => {
  const whole = checkArchitecture([{ path: 'functions/src/index.ts', text: `// @harness-exception-file fn/sdk-boundary 理由：接続確認だけの最小構成で、まだ層に分けていない\nimport { GoogleGenAI } from '@google/genai'` }])
  assert.equal(whole.violations.length, 0)
  assert.equal(whole.suppressed.length, 1)

  const noReason = checkArchitecture([{ path: 'web/src/features/f/ui/A.tsx', text: `// @harness-exception ui/no-data-access\nimport { getDocs } from 'firebase/firestore'` }])
  assert.equal(noReason.errors.length, 1)
  assert.equal(noReason.violations.length, 1)

  const unknown = checkArchitecture([{ path: 'web/src/features/f/ui/A.tsx', text: `// @harness-exception ui/whatever 理由：ためしに書いた理由です\nexport const A = 1` }])
  assert.equal(unknown.errors.length, 1)

  const unused = checkArchitecture([{ path: 'web/src/features/f/ui/A.tsx', text: `// @harness-exception ui/no-data-access 理由：もう要らない理由です\nexport const A = 1` }])
  assert.equal(unused.warnings.length, 1)

  const judgement = checkArchitecture([{ path: 'web/src/features/f/ui/A.tsx', text: `// @harness-exception ui/render-only 理由：アニメーションの計算を描画と同じ場所に置く\nexport const A = 1` }])
  assert.equal(judgement.warnings.length, 0, '判断で見るルールの例外は、機械では「使われていない」と言わない')
  assert.equal(judgement.exceptions.length, 1)
})

test('このリポジトリの今のコードは、設計方針のチェックに通る', () => {
  const root = repoRoot(process.cwd())
  const source = treeSource(root)
  const paths = source.list(['web/src', 'functions/src'])
  const result = checkArchitecture(paths.map((path) => ({ path, text: source.read(path) ?? '' })))
  assert.equal(result.violations.length, 0, describe(result))
  assert.equal(result.errors.length, 0, result.errors.map((item) => item.message).join('\n'))
})
