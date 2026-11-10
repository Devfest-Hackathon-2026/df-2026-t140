// TypeScript / JavaScript のソースを、依存なしで大まかに読む。
// 層のチェックに要るのは import の行とコメントだけなので、正規表現の字句（/.../）は扱わない。

export function scanSource(text) {
  const src = text.replace(/\r\n/g, '\n')
  let noComments = '' // コメントを空白にしたもの（文字列は残す）
  let codeOnly = '' // コメントと文字列の中身を空白にしたもの
  const comments = []
  const stack = [{ type: 'code', braces: 0 }]
  let line = 1
  let comment

  const blank = (char) => (char === '\n' ? '\n' : ' ')
  const emit = (char, { inComment = false, inString = false } = {}) => {
    noComments += inComment ? blank(char) : char
    codeOnly += inComment || inString ? blank(char) : char
    if (char === '\n') line++
  }

  for (let i = 0; i < src.length; i++) {
    const char = src[i]
    const next = src[i + 1]
    const top = stack[stack.length - 1]

    if (comment) {
      if (comment.kind === 'line' && char === '\n') {
        comments.push({ ...comment, endLine: line })
        comment = undefined
        emit(char)
        continue
      }
      if (comment.kind === 'block' && char === '*' && next === '/') {
        comment.text += '*/'
        comments.push({ ...comment, endLine: line })
        comment = undefined
        emit(char, { inComment: true })
        emit(next, { inComment: true })
        i++
        continue
      }
      comment.text += char
      emit(char, { inComment: true })
      continue
    }

    if (top.type === 'code') {
      if (char === '/' && (next === '/' || next === '*')) {
        comment = { kind: next === '/' ? 'line' : 'block', text: char + next, startLine: line }
        emit(char, { inComment: true })
        emit(next, { inComment: true })
        i++
        continue
      }
      if (char === "'" || char === '"') {
        stack.push({ type: 'string', quote: char })
        emit(char)
        continue
      }
      if (char === '`') {
        stack.push({ type: 'template' })
        emit(char)
        continue
      }
      if (char === '{') top.braces++
      if (char === '}') {
        if (top.braces === 0 && stack.length > 1) {
          stack.pop() // テンプレートの ${ } を抜ける
          emit(char)
          continue
        }
        top.braces--
      }
      emit(char)
      continue
    }

    if (top.type === 'string') {
      if (char === '\\') {
        emit(char, { inString: true })
        if (next !== undefined) emit(next, { inString: true })
        i++
        continue
      }
      if (char === top.quote || char === '\n') {
        stack.pop()
        emit(char)
        continue
      }
      emit(char, { inString: true })
      continue
    }

    // テンプレート文字列
    if (char === '\\') {
      emit(char, { inString: true })
      if (next !== undefined) emit(next, { inString: true })
      i++
      continue
    }
    if (char === '`') {
      stack.pop()
      emit(char)
      continue
    }
    if (char === '$' && next === '{') {
      emit(char)
      emit(next)
      i++
      stack.push({ type: 'code', braces: 0 })
      continue
    }
    emit(char, { inString: true })
  }
  if (comment) comments.push({ ...comment, endLine: line })

  return { noComments, codeOnly, comments: mergeLineComments(comments) }
}

// 続けて書いた // の行は 1 つのコメントとして扱う
function mergeLineComments(comments) {
  const merged = []
  for (const item of comments) {
    const last = merged[merged.length - 1]
    if (last && last.kind === 'line' && item.kind === 'line' && item.startLine === last.endLine + 1) {
      last.text += `\n${item.text}`
      last.endLine = item.endLine
    } else {
      merged.push({ ...item })
    }
  }
  return merged
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length

const IMPORT_FROM = /\b(import|export)\s+(type\s+)?([\w*${}\s,]*?)\s*from\s*(['"])([^'"\n]+)\4/g
const SIDE_EFFECT = /\bimport\s*(['"])([^'"\n]+)\1/g
const DYNAMIC = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g

function isTypeOnlyClause(clause) {
  const trimmed = clause.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
  const names = trimmed
    .slice(1, -1)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  return names.length > 0 && names.every((name) => name.startsWith('type '))
}

export function findImports(noComments) {
  const imports = []
  for (const match of noComments.matchAll(IMPORT_FROM)) {
    imports.push({
      spec: match[5],
      line: lineAt(noComments, match.index),
      typeOnly: Boolean(match[2]) || isTypeOnlyClause(match[3]),
    })
  }
  for (const match of noComments.matchAll(SIDE_EFFECT)) {
    imports.push({ spec: match[2], line: lineAt(noComments, match.index), typeOnly: false })
  }
  for (const match of noComments.matchAll(DYNAMIC)) {
    imports.push({ spec: match[2], line: lineAt(noComments, match.index), typeOnly: false })
  }
  return imports
}

export function findPattern(codeOnly, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...codeOnly.matchAll(new RegExp(pattern.source, flags))].map((match) => lineAt(codeOnly, match.index))
}

// @harness-exception <ルール ID> と「理由：」を読む。書き方は docs/architecture/design-principles.md。
const TAG = /@harness-exception(-file)?\s+([a-z]+\/[a-z0-9-]+)/g
const REASON = /理由\s*[:：]\s*(\S[^\n]{4,})/

export function findExceptions(text, comments) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const exceptions = []
  for (const comment of comments) {
    for (const match of comment.text.matchAll(TAG)) {
      const reason = comment.text.match(REASON)?.[1]?.replace(/\*\/\s*$/, '').trim()
      let appliesTo
      if (!match[1]) {
        for (let n = comment.endLine + 1; n <= lines.length; n++) {
          if (lines[n - 1].trim()) {
            appliesTo = n
            break
          }
        }
      }
      exceptions.push({
        rule: match[2],
        fileLevel: Boolean(match[1]),
        line: comment.startLine,
        appliesTo,
        reason,
      })
    }
  }
  return exceptions
}
