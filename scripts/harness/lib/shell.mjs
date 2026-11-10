// シェルの命令を、ガードで調べられる形（区切りごとの単語の並び）にする。
// 完全な構文解析ではない。引用符でのごまかし（git 'push'）や、&&・;・| でつないだ命令、
// bash -c "..." の中までは追う。それより凝った迂回は git hooks と CI で止める（多層防御）。

const SEPARATORS = ['&&', '||', '|&', ';', '|', '&', '\n', '(', ')']

// shell が 'powershell' のときは \ をパスの区切りとして残す（エスケープにしない）
export function splitCommands(command, { shell = 'bash' } = {}) {
  const backslashEscapes = shell !== 'powershell'
  const segments = []
  let words = []
  let redirects = [] // { op: '>' | '>>' | '<', target }。引用符の外のものだけ
  let word = ''
  let quote
  let hasWord = false

  const endWord = () => {
    if (hasWord) words.push(word)
    word = ''
    hasWord = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0 || redirects.length > 0) {
      words.redirects = redirects
      segments.push(words)
    }
    words = []
    redirects = []
  }

  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (quote) {
      if (char === quote) {
        quote = undefined
      } else if (backslashEscapes && char === '\\' && quote === '"' && i + 1 < command.length) {
        word += command[++i]
      } else {
        word += char
      }
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      hasWord = true
      continue
    }
    if (backslashEscapes && char === '\\' && i + 1 < command.length) {
      const next = command[i + 1]
      if (next === '\n') {
        i++
        continue
      }
      word += next
      hasWord = true
      i++
      continue
    }
    if (char === '$' && command[i + 1] === '(') {
      endSegment()
      i++
      continue
    }
    // リダイレクト（2>&1、> file、>> file、>| file、&> file、< file）は命令の引数ではない。
    // 行き先（読む・書くファイル）は redirects に残し、ガードが調べる
    if (char === '>' || char === '<' || (char === '&' && command[i + 1] === '>')) {
      if (hasWord && /^\d+$/.test(word)) {
        word = '' // 2> の 2（ファイル記述子）
        hasWord = false
      } else {
        endWord()
      }
      let j = i + (char === '&' ? 2 : 1)
      let op = char === '<' ? '<' : '>'
      if (char !== '<' && command[j] === '>') {
        op = '>>'
        j++
      }
      if (char !== '<' && command[j] === '|') j++ // >|（noclobber を無視する書き込み）
      if (command[j] === '&') {
        j++ // >&1、>&-（ファイルではない）
        while (/[\d-]/.test(command[j] ?? '')) j++
      } else {
        while (command[j] === ' ' || command[j] === '\t') j++
        // 書き込み先は命令の単語と同じ読み方で読む（"harness".config.json の引用符の連結、
        // harness\.config.json の \ を外す）。読み方が違うと、それがそのまま抜け道になる
        const read = readWordAt(command, j, backslashEscapes)
        j = read.end
        if (read.value) redirects.push({ op, target: read.value })
      }
      i = j - 1
      continue
    }
    const separator = SEPARATORS.find((item) => command.startsWith(item, i))
    if (separator) {
      endSegment()
      i += separator.length - 1
      continue
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      endWord()
      continue
    }
    if (char === '`' && !hasWord) {
      // バッククォートの置換の中身も 1 つの命令として調べる
      endSegment()
      continue
    }
    word += char
    hasWord = true
  }
  endSegment()
  return segments
}

// command の start から 1 つの単語を、splitCommands の単語と同じ規則（引用符、\ のエスケープ）で読む。
// 引用符の外の空白、区切り、リダイレクトの記号で終わる
function readWordAt(command, start, backslashEscapes) {
  let value = ''
  let quote
  let j = start
  for (; j < command.length; j++) {
    const char = command[j]
    if (quote) {
      if (char === quote) quote = undefined
      else if (backslashEscapes && char === '\\' && quote === '"' && j + 1 < command.length) value += command[++j]
      else value += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (backslashEscapes && char === '\\' && j + 1 < command.length) {
      value += command[++j]
      continue
    }
    if (/[\s;&|()<>`]/.test(char)) break
    value += char
  }
  return { value, end: j }
}

const WRAPPERS = new Set(['sudo', 'command', 'builtin', 'time', 'nice', 'nohup', 'exec', 'stdbuf', 'xargs', 'env', 'npx', 'bunx', 'pnpx'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const POWERSHELLS = new Set(['powershell', 'pwsh'])

export const programName = (word) =>
  word
    .replaceAll('\\', '/')
    .split('/')
    .pop()
    .replace(/\.(exe|cmd|bat|ps1)$/i, '')
    .toLowerCase()

// 環境変数の代入と、ほかの命令を包むだけの命令を外す
export function unwrap(words) {
  const env = {}
  let rest = [...words]
  for (;;) {
    const assignment = rest[0]?.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (assignment) {
      env[assignment[1]] = assignment[2]
      rest = rest.slice(1)
      continue
    }
    const name = rest[0] && programName(rest[0])
    if (name === 'timeout') {
      rest = rest.slice(1)
      while (rest[0]?.startsWith('-')) rest = rest.slice(1)
      rest = rest.slice(1) // 時間
      continue
    }
    if (name && WRAPPERS.has(name)) {
      rest = rest.slice(1)
      while (rest[0]?.startsWith('-')) rest = rest.slice(1)
      continue
    }
    break
  }
  return { env, words: rest }
}

// bash -c "..." や powershell -Command "..." の中身を取り出す
export function innerScript(words) {
  const name = programName(words[0] ?? '')
  if (SHELLS.has(name)) {
    const index = words.findIndex((word, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(word))
    return index > 0 ? words[index + 1] : undefined
  }
  if (POWERSHELLS.has(name)) {
    const index = words.findIndex((word, i) => i > 0 && /^-(c|command|encodedcommand|e|ec)$/i.test(word))
    if (index < 0) return undefined
    const flag = words[index].toLowerCase()
    const value = words[index + 1]
    if (value && /^-(encodedcommand|e|ec)$/.test(flag)) {
      try {
        return Buffer.from(value, 'base64').toString('utf16le')
      } catch {
        return undefined
      }
    }
    return words.slice(index + 1).join(' ')
  }
  if (name === 'cmd') {
    const index = words.findIndex((word) => /^\/c$/i.test(word))
    return index > 0 ? words.slice(index + 1).join(' ') : undefined
  }
  if (name === 'eval' || name === 'invoke-expression' || name === 'iex') return words.slice(1).join(' ')
  return undefined
}

// すべての命令を、入れ子の中まで平らに並べる
export function flattenCommands(command, { shell = 'bash' } = {}, depth = 0) {
  const result = []
  for (const segment of splitCommands(command, { shell })) {
    const { env, words } = unwrap(segment)
    const redirects = segment.redirects ?? []
    if (words.length === 0) {
      if (redirects.length > 0) result.push({ env, words, program: '', redirects })
      continue
    }
    const inner = depth < 4 ? innerScript(words) : undefined
    if (inner) {
      const innerShell = POWERSHELLS.has(programName(words[0])) ? 'powershell' : 'bash'
      result.push(...flattenCommands(inner, { shell: innerShell }, depth + 1))
      if (redirects.length > 0) result.push({ env, words: [], program: '', redirects })
    } else {
      result.push({ env, words, program: programName(words[0]), redirects })
    }
  }
  return result
}
