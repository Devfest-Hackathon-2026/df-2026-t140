// パスとグロブ。Windows の区切り（\）も / にそろえてから比べる。

export const toPosix = (path) => path.replaceAll('\\', '/')

const hasWildcard = (pattern) => /[*?]/.test(pattern)

export function globToRegExp(glob) {
  const pattern = toPosix(glob).replace(/^\.\//, '')
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        const slash = pattern[i + 2] === '/'
        source += slash ? '(?:.*/)?' : '.*'
        i += slash ? 2 : 1
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  // ワイルドカードのないパスは、そのファイルか、そのフォルダの中身に当たる
  return new RegExp(hasWildcard(pattern) ? `^${source}$` : `^${source.replace(/\/$/, '')}(?:/.*)?$`)
}

export function matchesAny(path, globs) {
  const target = toPosix(path)
  return globs.some((glob) => globToRegExp(glob).test(target))
}

// グロブの、ワイルドカードより前の部分（例：web/src/features/**/ui → web/src/features）
export function staticPrefix(glob) {
  const segments = toPosix(glob).replace(/^\.\//, '').split('/')
  const fixed = []
  for (const segment of segments) {
    if (hasWildcard(segment)) break
    fixed.push(segment)
  }
  return fixed.join('/')
}

const isWithin = (inner, outer) => outer === '' || inner === outer || inner.startsWith(`${outer}/`)

// 2 つのグロブが同じファイルに当たり得るか。前の部分どうしで近似する（多めに当てる）。
export function globsOverlap(a, b) {
  const pa = staticPrefix(a)
  const pb = staticPrefix(b)
  if (!hasWildcard(a) && !hasWildcard(b)) return isWithin(pa, pb) || isWithin(pb, pa)
  if (!hasWildcard(a)) return matchesAny(pa, [b]) || isWithin(pa, pb) || isWithin(pb, pa)
  if (!hasWildcard(b)) return matchesAny(pb, [a]) || isWithin(pa, pb) || isWithin(pb, pa)
  return isWithin(pa, pb) || isWithin(pb, pa)
}
