// 秘密情報の検出。提出用リポジトリは公開なので、push した時点で漏れる（CLAUDE.md）。
// テストでは本物に見える値をそのまま書かず、文字列をつないで作る（このファイル自体が引っかからないように）。

export const SECRET_PATTERNS = [
  { id: 'google-api-key', label: 'Google の API キー', pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { id: 'google-oauth-secret', label: 'Google の OAuth クライアントシークレット', pattern: /GOCSPX-[0-9A-Za-z_-]{20,}/ },
  { id: 'private-key', label: '秘密鍵', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/ },
  { id: 'github-token', label: 'GitHub のトークン', pattern: /\b(?:gh[pousr]_[0-9A-Za-z]{36,}|github_pat_[0-9A-Za-z_]{40,})\b/ },
  { id: 'slack-token', label: 'Slack のトークン', pattern: /\bxox[abprs]-[0-9A-Za-z-]{10,}/ },
  { id: 'aws-access-key', label: 'AWS のアクセスキー', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'ai-api-key', label: 'AI サービスの API キー', pattern: /\bsk-(?:ant-|proj-)?[0-9A-Za-z_-]{32,}/ },
]

// 中身を見なくても、置いてはいけないファイル
const FORBIDDEN_FILES = [
  { pattern: /(^|\/)\.env(\.(?!example$)[^/]+)?$/, reason: '.env は秘密情報を置く場所なのでコミットしない（.env.example は可）' },
  { pattern: /(^|\/)\.dev\.vars(\.(?!example$)[^/]+)?$/, reason: '.dev.vars はコミットしない' },
  { pattern: /\.(pem|key|p12|pfx)$/, reason: '鍵のファイルはコミットしない' },
  { pattern: /(^|\/)(service-account|credentials)[^/]*\.json$/, reason: 'サービスアカウントの鍵はコミットしない' },
  { pattern: /(^|\/)(google-services\.json|GoogleService-Info\.plist)$/, reason: 'Firebase の端末用設定はコミットしない' },
  { pattern: /^\.local\//, reason: '.local/ は運営資料などローカル専用の置き場。再配布しない' },
  { pattern: /^poc\//, reason: '開発開始前の PoC は持ち込まない（ルールで禁止）' },
]

export function forbiddenFileReason(path) {
  return FORBIDDEN_FILES.find(({ pattern }) => pattern.test(path))?.reason
}

const mask = (value) => (value.length <= 8 ? '****' : `${value.slice(0, 4)}…${value.slice(-2)}`)

export function scanText(text) {
  const findings = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const { id, label, pattern } of SECRET_PATTERNS) {
      const match = line.match(pattern)
      if (match) findings.push({ id, label, line: index + 1, excerpt: mask(match[0]) })
    }
  })
  return findings
}

// git diff -U0 の出力から、足した行だけを調べる
export function scanAddedLines(diff) {
  const findings = []
  let file
  let lineNumber = 0
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      file = line.replace(/^\+\+\+ (b\/)?/, '')
      continue
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/)
    if (hunk) {
      lineNumber = Number(hunk[1])
      continue
    }
    if (line.startsWith('+')) {
      for (const finding of scanText(line.slice(1))) findings.push({ ...finding, file, line: lineNumber })
      lineNumber++
    }
  }
  return findings
}
