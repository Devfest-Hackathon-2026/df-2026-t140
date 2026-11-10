// 作業宣言（docs/work/）と人の判断（todo/humans/）の先頭にある、簡単な front matter を読む。
// 依存を増やさないため YAML の一部だけ（「key: 値」と「key:」の下の「  - 項目」）に対応する。

export function parseFrontMatter(text) {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized, hasFrontMatter: false }
  const end = normalized.indexOf('\n---', 4)
  if (end === -1) return { data: {}, body: normalized, hasFrontMatter: false }

  const data = {}
  let listKey
  for (const line of normalized.slice(4, end).split('\n')) {
    if (!line.trim()) continue
    const item = line.match(/^\s+-\s*(.*)$/)
    if (item && listKey) {
      data[listKey].push(unquote(item[1]))
      continue
    }
    const pair = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!pair) continue
    const [, key, value] = pair
    if (value === '') {
      data[key] = []
      listKey = key
    } else {
      data[key] = unquote(value)
      listKey = undefined
    }
  }
  const body = normalized.slice(normalized.indexOf('\n', end + 1) + 1)
  return { data, body, hasFrontMatter: true }
}

const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2')

// 値だけを書き換える（ほかの行と並びはそのまま残す）
export function setFrontMatterValue(text, key, value) {
  const normalized = text.replace(/\r\n/g, '\n')
  const end = normalized.indexOf('\n---', 4)
  const head = normalized.slice(0, end)
  const rest = normalized.slice(end)
  const line = new RegExp(`^${key}:.*$`, 'm')
  const safe = String(value).replace(/\n/g, ' ')
  const updated = line.test(head) ? head.replace(line, () => `${key}: ${safe}`) : `${head}\n${key}: ${safe}`
  return updated + rest
}

// 「## 見出し」ごとの本文。HTML コメント（書き方の案内）は中身に数えない。
export function parseSections(body) {
  const sections = {}
  let current
  for (const line of body.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    if (heading) {
      current = heading[1]
      sections[current] = ''
    } else if (current) {
      sections[current] += `${line}\n`
    }
  }
  for (const key of Object.keys(sections)) {
    sections[key] = sections[key].replace(/<!--[\s\S]*?-->/g, '').trim()
  }
  return sections
}

export function parseTitle(body) {
  return body.match(/^#\s+(.+?)\s*$/m)?.[1]
}
