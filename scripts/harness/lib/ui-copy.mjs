// 画面の日本語の文言（UI の文言）を、web/src の .ts と .tsx から抜き出す。
// npm run copy:check（scripts/copy-check.mjs）と、編集の直後のフック（hook.mjs）が使う。
// 文言は AI が書いたら yomiyasu で推敲する決まり（docs/ui/README.md「画面の文言」）。
//
// TypeScript 7 には JS から呼べるコンパイラの API がないので、小さな字句解析で見分ける。
// 拾うもの：'…' と "…" の文字列、`…` のテンプレート（${…} は 〇 に置き換える）、JSX のテキスト。
// 拾わないもの：コメント、正規表現、日本語を含まない文字列。

export const COPY_ROOT = 'web/src'

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/

export const hasJapanese = (text) => JAPANESE.test(text)

// 文言の点検の対象になるファイル（web/src の .ts と .tsx。テストと型の宣言は除く）
export function isCopyFile(path) {
  const rel = String(path).replaceAll('\\', '/')
  if (!rel.startsWith(`${COPY_ROOT}/`)) return false
  if (!/\.tsx?$/.test(rel) || /\.d\.ts$/.test(rel)) return false
  return !/(\.test\.|\.spec\.|\/__tests__\/)/.test(rel)
}

// 直前の意味のある文字がこれなら、次の / は割り算ではなく正規表現の始まり。
// '<' は入れない（JSX の閉じタグ </p> の / を正規表現と読み違え、同じ行のあとの文言を取りこぼすため）
const REGEX_BEFORE = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '>', '~', '^'])
const REGEX_KEYWORD = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/

const squash = (text) => text.replace(/\s+/g, ' ').trim()

/**
 * ソースの文字列から、日本語を含む文言を出現順に返す。
 * @returns {{ line: number, text: string, kind: 'string' | 'template' | 'jsx' }[]}
 */
export function extractCopy(source) {
  const src = String(source ?? '')
  const found = []
  const lineStarts = [0]
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1)
  const lineOf = (index) => {
    let lo = 0
    let hi = lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (lineStarts[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
  const record = (index, text, kind) => {
    const value = squash(text)
    if (value && hasJapanese(value)) found.push({ line: lineOf(index), text: value, kind })
  }

  // 引用符の文字列を読み、閉じたあとの位置を返す
  const readQuoted = (start) => {
    const quote = src[start]
    let i = start + 1
    let text = ''
    while (i < src.length && src[i] !== quote && src[i] !== '\n') {
      if (src[i] === '\\') {
        text += src[i + 1] ?? ''
        i += 2
        continue
      }
      text += src[i++]
    }
    record(start, text, 'string')
    return i + 1
  }

  // テンプレートを読み、閉じたあとの位置を返す。${…} の中はコードとして読む
  const readTemplate = (start) => {
    let i = start + 1
    let text = ''
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') {
        text += src[i + 1] ?? ''
        i += 2
        continue
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        i = readCode(i + 2, '}')
        text += '〇'
        continue
      }
      text += src[i++]
    }
    record(start, text, 'template')
    return i + 1
  }

  // 正規表現の閉じる / の位置（行の中で閉じなければ -1）
  const regexClose = (start) => {
    let i = start + 1
    let inClass = false
    while (i < src.length && src[i] !== '\n') {
      const ch = src[i]
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '[') inClass = true
      else if (ch === ']') inClass = false
      else if (ch === '/' && !inClass) return i
      i++
    }
    return -1
  }

  // } と > のあとの / は、コードなら正規表現の始まり、JSX のテキストならただの文字（<p>{a}/{b} 件</p>）。
  // 行の中で閉じない、または閉じる / が閉じタグの </ なら、テキストとみなす
  const looksLikeJsxText = (start) => {
    const close = regexClose(start)
    return close < 0 || src[close - 1] === '<'
  }

  const readRegex = (start) => {
    let i = start + 1
    let inClass = false
    while (i < src.length && src[i] !== '\n') {
      const ch = src[i]
      if (ch === '\\') {
        i += 2
        continue
      }
      if (ch === '[') inClass = true
      else if (ch === ']') inClass = false
      else if (ch === '/' && !inClass) break
      i++
    }
    i++
    while (i < src.length && /[a-z]/i.test(src[i])) i++
    return i
  }

  // コードを読む。until（'}'）が来たら、閉じたあとの位置を返す
  function readCode(start, until) {
    let i = start
    let depth = 0
    let prev = '' // 直前の意味のある文字（空白とコメントを飛ばす）
    let textStart = start // JSX のテキストが始まりうる位置（直前の > か } のあと）
    while (i < src.length) {
      const ch = src[i]
      const next = src[i + 1]
      if (ch === '/' && next === '/') {
        while (i < src.length && src[i] !== '\n') i++
        continue
      }
      if (ch === '/' && next === '*') {
        const end = src.indexOf('*/', i + 2)
        i = end < 0 ? src.length : end + 2
        continue
      }
      if (ch === "'" || ch === '"') {
        i = readQuoted(i)
        prev = 'a'
        continue
      }
      if (ch === '`') {
        i = readTemplate(i)
        prev = 'a'
        continue
      }
      if (
        ch === '/' &&
        (REGEX_BEFORE.has(prev) || REGEX_KEYWORD.test(src.slice(Math.max(0, i - 12), i).trimEnd())) &&
        !((prev === '}' || prev === '>') && looksLikeJsxText(i))
      ) {
        i = readRegex(i)
        prev = 'a'
        continue
      }
      if (JAPANESE.test(ch)) {
        // 文字列でもコメントでもない所の日本語は、JSX のテキスト。
        // テキストの中の {…} は 〇 にして、次のタグ（<）まで 1 つの文言としてつなぐ
        let text = src[textStart - 1] === '}' ? '〇' : ''
        let end = textStart
        while (end < src.length && src[end] !== '<') {
          if (src[end] === '{') {
            end = readCode(end + 1, '}')
            text += '〇'
            continue
          }
          text += src[end++]
        }
        // 行番号は、文言の最初の空白でない文字の行にする（> のあとで改行してから書く JSX が多い）
        let first = textStart
        while (first < i && /\s/.test(src[first])) first++
        record(first, text, 'jsx')
        i = end
        prev = 'a'
        continue
      }
      if (ch === '{') depth++
      if (ch === '}') {
        if (depth === 0 && until === '}') return i + 1
        depth--
      }
      if (ch === '>' || ch === '}') textStart = i + 1
      if (!/\s/.test(ch)) prev = /[\w$)\]]/.test(ch) ? 'a' : ch
      i++
    }
    return i
  }

  readCode(0)
  return found
}

/**
 * before になくて after にある文言（編集で足した文言）。同じ文言は 1 つにまとめる。
 */
export function addedCopy(before, after) {
  const old = new Set(extractCopy(before).map((item) => item.text))
  const seen = new Set()
  return extractCopy(after).filter((item) => {
    if (old.has(item.text) || seen.has(item.text)) return false
    seen.add(item.text)
    return true
  })
}

const MAX_UNDO_CANDIDATES = 8

/**
 * Edit の置き換えを後ろから戻して、編集の前の中身の候補を返す。
 * new_string が前にもある（同じ文が 2 か所ある）と、最初の出現を戻すだけでは違う所を戻す。
 * そこで出現ごとに戻してみて、Edit の決まり（replace_all でなければ old_string は 1 か所だけ）に合う戻し方だけを残す。
 * 合うものがなければ、すべての出現を候補にする。
 * @returns {string[]} 1 つ以上の候補
 */
export function undoEdits(after, edits) {
  let states = [after]
  for (const edit of [...edits].reverse()) {
    const next = String(edit.new_string ?? '')
    const old = String(edit.old_string ?? '')
    if (!next) continue // 消した所は戻せない（どこにあったか分からない）。足した文言の判定には要らない
    const nextStates = []
    for (const state of states) {
      if (edit.replace_all) {
        nextStates.push(state.split(next).join(old))
        continue
      }
      const all = []
      for (let at = state.indexOf(next); at !== -1; at = state.indexOf(next, at + 1)) {
        all.push(state.slice(0, at) + old + state.slice(at + next.length))
      }
      if (all.length === 0) {
        nextStates.push(state)
        continue
      }
      const valid = old ? all.filter((candidate) => candidate.split(old).length === 2) : all
      nextStates.push(...(valid.length > 0 ? valid : all))
    }
    states = [...new Set(nextStates)].slice(0, MAX_UNDO_CANDIDATES)
  }
  return states
}
