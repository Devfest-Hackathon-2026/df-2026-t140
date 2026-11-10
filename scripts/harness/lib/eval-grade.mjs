// レビュー役の評価の採点（決まった処理）。LLM の返答から JSON を取り出し、期待と比べる。
const SEVERITY = { nit: 0, minor: 1, major: 2, blocker: 3 }

export function extractReviewJson(text) {
  const blocks = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => match[1])
  for (const block of blocks.reverse()) {
    try {
      return JSON.parse(block)
    } catch {
      // 次の候補へ
    }
  }
  return undefined
}

// expected：{ verdict: [...], must_find: [{ rubric: [...], min_severity }], no_major?: true }
export function gradeReview(review, expected) {
  const problems = []
  if (!review) return { pass: false, problems: ['返答から JSON を取り出せない'], found: 0, needed: expected.must_find.length }
  if (!expected.verdict.includes(review.verdict)) problems.push(`結論が ${review.verdict}（期待：${expected.verdict.join(' か ')}）`)
  const findings = Array.isArray(review.findings) ? review.findings : []
  let found = 0
  for (const want of expected.must_find) {
    const hit = findings.some((item) => want.rubric.includes(item.rubric) && (SEVERITY[item.severity] ?? -1) >= SEVERITY[want.min_severity])
    if (hit) found++
    else problems.push(`見逃し：${want.rubric.join('/')} の ${want.min_severity} 以上`)
  }
  if (expected.no_major) {
    const heavy = findings.filter((item) => (SEVERITY[item.severity] ?? 0) >= SEVERITY.major)
    if (heavy.length > 0) problems.push(`誤った重い指摘：${heavy.map((item) => `${item.rubric} ${item.severity}`).join('、')}`)
  }
  return { pass: problems.length === 0, problems, found, needed: expected.must_find.length }
}
