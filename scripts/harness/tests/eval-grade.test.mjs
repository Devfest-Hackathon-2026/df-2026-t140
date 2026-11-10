import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractReviewJson, gradeReview } from '../lib/eval-grade.mjs'

const expected = { verdict: ['REQUEST_CHANGES'], must_find: [{ rubric: ['R3'], min_severity: 'blocker' }] }

test('採点：返答の最後の JSON を取り出し、見逃し・結論・誤検出を数える', () => {
  const text = '要約です。\n```json\n{"verdict":"REQUEST_CHANGES","findings":[{"rubric":"R3","severity":"blocker"}]}\n```'
  assert.equal(gradeReview(extractReviewJson(text), expected).pass, true)
  assert.equal(gradeReview({ verdict: 'REQUEST_CHANGES', findings: [{ rubric: 'R3', severity: 'major' }] }, expected).pass, false, '重さが足りない')
  assert.equal(gradeReview({ verdict: 'APPROVE', findings: [{ rubric: 'R3', severity: 'blocker' }] }, expected).pass, false, '結論が違う')
  assert.equal(gradeReview(undefined, expected).pass, false)
  const clean = { verdict: ['APPROVE', 'COMMENT'], must_find: [], no_major: true }
  assert.equal(gradeReview({ verdict: 'APPROVE', findings: [{ rubric: 'R6', severity: 'minor' }] }, clean).pass, true)
  assert.equal(gradeReview({ verdict: 'APPROVE', findings: [{ rubric: 'R6', severity: 'major' }] }, clean).pass, false, '誤った重い指摘')
})
