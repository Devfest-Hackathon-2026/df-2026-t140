// 層のチェック。ルールの説明は docs/architecture/design-principles.md、ID の一覧は rules.mjs。
// ファイルの一覧と中身を受け取るだけなので、作業ツリーでも、任意の git の ref でも同じに動く。
import { posix } from 'node:path'
import { isKnownRule, RULES } from './rules.mjs'
import { findExceptions, findImports, findPattern, scanSource } from './source.mjs'

const CODE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/
// lib/ は FSD の正式なセグメント（shared/lib）なので外さない。functions のビルド結果は functions/lib で src の外
const IGNORED = /(^|\/)node_modules\/|\.d\.ts$|\.(test|spec)\.[cm]?[jt]sx?$/

export const WEB = {
  root: 'web/src/',
  layers: ['app', 'pages', 'widgets', 'features', 'entities', 'shared'],
  sliced: new Set(['pages', 'widgets', 'features', 'entities']),
  entry: new Set(['main.tsx', 'main.ts']),
}

export const FN = {
  root: 'functions/src/',
  layers: ['app', 'features', 'adapters', 'ports', 'domain', 'shared'],
  entry: new Set(['index.ts']),
  // feature の中のファイル（またはフォルダ）の役割。ports はその機能が外に頼むものの型
  segments: ['handler', 'usecase', 'logic', 'prompt', 'ports', 'types', 'index'],
  // 使ってよい層（features の中の同じスライスは別に扱う）。
  // app は features を知らない。features と app をつなぐのは index.ts（1 機能 1 行）。
  allowed: {
    entry: ['app', 'features', 'shared'],
    app: ['app', 'adapters', 'ports', 'domain', 'shared'],
    features: ['ports', 'domain', 'shared'],
    adapters: ['adapters', 'ports', 'domain', 'shared'],
    ports: ['ports', 'domain', 'shared'],
    domain: ['domain', 'shared'],
    shared: ['shared'],
  },
}

const WEB_FIREBASE = /^firebase(\/|$)/
const AI_SDK = /^(@google\/genai|@google-cloud\/)/
const FN_ADAPTER_SDK = /^(@google\/genai|@google-cloud\/|firebase-admin(\/|$)|@googlemaps\/)/
const FN_TRIGGER_SDK = /^firebase-functions(\/|$)/
const NODE_IO = /^(node:)?(fs|fs\/promises|child_process|http|https|http2|net|dgram|tls|dns|worker_threads)$/
const GENERATION_SOURCE = /(^|\/)(build-model|generate-model|model-generation|argon)(\/|\.|-|$)/i
const MAPS_TARGET = /(^@googlemaps\/|^@vis\.gl\/react-google-maps|(^|\/)(place|places|maps|google-maps|routes-api)(\/|\.|-|$))/i

export const isCodeFile = (path) => path.startsWith(WEB.root) || path.startsWith(FN.root)
  ? CODE.test(path) && !IGNORED.test(path)
  : false

const withoutExtension = (path) => path.replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/, '')
const withoutIndex = (path) => withoutExtension(path).replace(/\/index$/, '')

function describeWeb(path) {
  const parts = path.slice(WEB.root.length).split('/')
  if (parts.length === 1) return { area: 'web', entry: WEB.entry.has(parts[0]), rootFile: true }
  const layer = WEB.layers.includes(parts[0]) ? parts[0] : undefined
  if (!layer) return { area: 'web', unknown: parts[0] }
  if (WEB.sliced.has(layer)) {
    return { area: 'web', layer, slice: parts.length >= 3 ? parts[1] : undefined, segment: parts.length >= 4 ? parts[2] : undefined }
  }
  return { area: 'web', layer, segment: parts.length >= 3 ? parts[1] : undefined }
}

function describeFn(path) {
  const parts = path.slice(FN.root.length).split('/')
  if (parts.length === 1) return { area: 'fn', entry: FN.entry.has(parts[0]), rootFile: true }
  const layer = FN.layers.includes(parts[0]) ? parts[0] : undefined
  if (!layer) return { area: 'fn', unknown: parts[0] }
  if (layer === 'features') {
    const segment = parts.length === 3 ? withoutExtension(parts[2]) : parts[2]
    return { area: 'fn', layer, slice: parts.length >= 3 ? parts[1] : undefined, segment }
  }
  return { area: 'fn', layer }
}

function targetOf(path, root, slicedLayers) {
  const parts = withoutIndex(path).slice(root.length).split('/')
  const layer = parts[0]
  const sliced = slicedLayers.has(layer)
  return {
    layer,
    slice: sliced ? parts[1] : undefined,
    segment: sliced ? parts[2] : parts[1],
    isPublic: sliced ? parts.length === 2 : true,
  }
}

function resolve(spec, from) {
  if (spec.startsWith('.')) return { path: posix.normalize(posix.join(posix.dirname(from), spec)) }
  if (spec.startsWith('@/') && from.startsWith(WEB.root)) return { path: WEB.root + spec.slice(2) }
  return { pkg: spec }
}

// 純粋な中心（I/O なし）。usecase は「読む → logic で決める → 書く」の殻なので含めない
const isPureCore = (info) =>
  info.layer === 'domain' || info.layer === 'ports' || (info.layer === 'features' && ['logic', 'prompt', 'ports', 'types'].includes(info.segment))

function checkWeb(path, info, imports, codeOnly, add) {
  if (info.rootFile && !info.entry) {
    add('layer/placement', 1, `web/src の直下に置けるのは main.tsx だけです。${WEB.layers.join('、')} のどれかの層へ移します`)
    return
  }
  if (info.unknown) {
    add('layer/placement', 1, `「${info.unknown}/」は FSD の層ではありません。${WEB.layers.join('、')} のどれかへ移します`)
    return
  }
  if (info.entry) return
  if (WEB.sliced.has(info.layer) && !info.slice) {
    add('layer/placement', 1, `${info.layer} の直下にはファイルを置かず、スライスのフォルダ（例：${info.layer}/trip-create/）を作ります`)
    return
  }
  if (/\.[jt]sx$/.test(path) && info.layer !== 'app' && info.segment !== 'ui') {
    add('segment/no-jsx-outside-ui', 1, 'JSX は ui セグメントに置きます。ロジックは model、データの読み書きは api に分けます')
  }

  const rank = WEB.layers.indexOf(info.layer)
  for (const item of imports) {
    const target = resolve(item.spec, path)
    if (target.pkg) {
      const dataSdk = WEB_FIREBASE.test(target.pkg) || AI_SDK.test(target.pkg)
      if (info.segment === 'ui' && dataSdk && !item.typeOnly) {
        add('ui/no-data-access', item.line, `ui から ${target.pkg} を直接使わない。データは model のフックか props で受け取ります`)
      } else if (WEB_FIREBASE.test(target.pkg) && !item.typeOnly && info.segment !== 'api' && info.layer !== 'app') {
        add('data/firebase-in-api', item.line, `${target.pkg} は api セグメント（例：entities/trip/api/）だけで使います`)
      }
      continue
    }
    if (!target.path.startsWith(WEB.root)) continue
    const to = targetOf(target.path, WEB.root, WEB.sliced)
    const toRank = WEB.layers.indexOf(to.layer)
    if (toRank === -1) continue
    if (toRank === rank) {
      if (WEB.sliced.has(info.layer) && to.slice !== info.slice) {
        add('layer/no-cross-slice', item.line, `${info.layer}/${info.slice} から同じ層の ${to.layer}/${to.slice} は使えません。共通の部分は下の層へ移すか、上の層で組み合わせます`)
      }
    } else if (toRank < rank) {
      add('layer/direction', item.line, `${info.layer} から上の層の ${to.layer} は使えません（app > pages > widgets > features > entities > shared）`)
    } else if (WEB.sliced.has(to.layer) && !to.isPublic) {
      add('layer/public-api', item.line, `${to.layer}/${to.slice} の中を直接使わず、${to.layer}/${to.slice}（index.ts）から使います`)
    }
    if (info.segment === 'ui' && to.segment === 'api' && !item.typeOnly) {
      add('ui/no-data-access', item.line, 'ui から api セグメントを直接使わない。model のフックを通します')
    }
  }
  if (info.segment === 'ui') {
    for (const line of findPattern(codeOnly, /\bfetch\s*\(/)) {
      add('ui/no-data-access', line, 'ui で fetch しない。通信は api セグメントに置きます')
    }
  }
}

function checkFn(path, info, imports, codeOnly, add) {
  if (info.rootFile && !info.entry) {
    add('fn/placement', 1, `functions/src の直下に置けるのは index.ts だけです。${FN.layers.join('、')} のどれかへ移します`)
    return
  }
  if (info.unknown) {
    add('fn/placement', 1, `「${info.unknown}/」はバックエンドの層ではありません。${FN.layers.join('、')} のどれかへ移します`)
    return
  }
  if (info.layer === 'features' && !info.slice) {
    add('fn/placement', 1, 'features の直下にはファイルを置かず、機能ごとのフォルダ（例：features/suggest-places/）を作ります')
    return
  }
  if (info.layer === 'features' && !FN.segments.includes(info.segment)) {
    add('fn/placement', 1, `feature の中は ${FN.segments.join('、')} のどれかの名前にします（今は「${info.segment}」）`)
  }

  for (const item of imports) {
    const target = resolve(item.spec, path)
    if (target.pkg) {
      if (item.typeOnly) continue
      if (FN_ADAPTER_SDK.test(target.pkg)) {
        const adminAllowed =
          /^firebase-admin/.test(target.pkg) &&
          (info.layer === 'app' || info.entry || (info.layer === 'features' && info.segment === 'usecase' && /^firebase-admin\/firestore$/.test(target.pkg)))
        if (info.layer !== 'adapters' && !adminAllowed) {
          const hint = /^firebase-admin/.test(target.pkg)
            ? 'Firestore は features/<機能>/usecase.ts で firebase-admin/firestore から使います'
            : 'features からは ports のインターフェース越しに使い、実体は app が渡します'
          add('fn/sdk-boundary', item.line, `${target.pkg} は adapters だけで使います。${hint}`)
        }
      }
      if (FN_TRIGGER_SDK.test(target.pkg)) {
        const allowed = info.entry || info.layer === 'app' || (info.layer === 'features' && info.segment === 'handler')
        if (!allowed) add('fn/sdk-boundary', item.line, `${target.pkg} は features/<機能>/handler.ts と app だけで使います`)
      }
      if (NODE_IO.test(target.pkg) && isPureCore(info)) {
        add('fn/pure-core', item.line, `${info.layer === 'features' ? info.segment : info.layer} では ${target.pkg} を使いません。I/O は adapters に置きます`)
      }
      continue
    }
    if (!target.path.startsWith(FN.root)) continue
    const to = targetOf(target.path, FN.root, new Set(['features']))
    if (!FN.layers.includes(to.layer)) continue
    if (to.layer === 'features') {
      if (info.layer === 'features' && to.slice === info.slice) continue
      if (info.layer === 'features') {
        add('fn/no-cross-feature', item.line, `features/${info.slice} から features/${to.slice} は使えません。共通の規則は domain へ移し、機能どうしは Firestore の状態でつなぎます`)
      } else if (!info.entry) {
        add('fn/layer-direction', item.line, `${info.layer} から features は使えません。features をつなぐのは index.ts だけです（1 機能 1 行）`)
      } else if (!to.isPublic) {
        add('fn/public-api', item.line, `features/${to.slice} の中を直接使わず、features/${to.slice}（index.ts）から使います`)
      }
      continue
    }
    const from = info.entry ? 'entry' : info.layer
    // handler はその機能の入口で、adapters の実体を usecase・logic に渡してよい（機能ごとの組み立て）
    if (info.layer === 'features' && info.segment === 'handler' && to.layer === 'adapters') continue
    if (!FN.allowed[from].includes(to.layer)) {
      const hint =
        info.layer === 'features' && to.layer === 'adapters'
          ? '。usecase・logic は ports の型で受け取り、実体は handler（か app/deps.ts）が渡します'
          : info.entry
            ? '。index.ts は app と features をつなぐだけにします'
            : ''
      add('fn/layer-direction', item.line, `${info.entry ? 'index.ts' : info.layer} から ${to.layer} は使えません${hint}`)
    }
  }
  if (isPureCore(info)) {
    for (const line of findPattern(codeOnly, /\bfetch\s*\(/)) {
      add('fn/pure-core', line, 'ここで fetch しない。通信は adapters に置きます')
    }
  }
}

function checkFile(file) {
  const raw = []
  const add = (rule, line, message) => raw.push({ rule, path: file.path, line, message })
  const { noComments, codeOnly, comments } = scanSource(file.text)
  const imports = findImports(noComments)

  if (file.path.startsWith(WEB.root)) checkWeb(file.path, describeWeb(file.path), imports, codeOnly, add)
  else checkFn(file.path, describeFn(file.path), imports, codeOnly, add)

  for (const line of findPattern(codeOnly, /\beval\s*\(|\bnew\s+Function\s*\(/)) {
    add('security/no-eval', line, '文字列をコードとして実行しない。AI が返したものはデータ（JSON）として検証して使います')
  }
  if (GENERATION_SOURCE.test(file.path)) {
    for (const item of imports) {
      const target = resolve(item.spec, file.path)
      const name = target.pkg ?? target.path
      if (MAPS_TARGET.test(name)) {
        add('maps/no-generation-input', item.line, `3D 生成の入力を作るコードから Maps 由来のモジュール（${item.spec}）を使わない（Maps Platform 規約 3.2.3(c)）`)
      }
    }
  }

  const exceptions = findExceptions(file.text, comments).map((item) => ({ ...item, path: file.path, used: false }))
  const errors = []
  for (const item of exceptions) {
    if (!isKnownRule(item.rule)) errors.push({ path: file.path, line: item.line, message: `@harness-exception の「${item.rule}」は知らないルールです（scripts/harness/lib/rules.mjs）` })
    else if (!item.reason) errors.push({ path: file.path, line: item.line, message: `@harness-exception ${item.rule} に「理由：」がありません。なぜこのルールから外れるのかを書きます` })
  }
  const valid = exceptions.filter((item) => isKnownRule(item.rule) && item.reason)

  const violations = []
  const suppressed = []
  for (const violation of raw) {
    const exception = valid.find((item) => item.rule === violation.rule && (item.fileLevel || item.appliesTo === violation.line))
    if (exception) {
      exception.used = true
      suppressed.push({ ...violation, reason: exception.reason })
    } else {
      violations.push(violation)
    }
  }
  const warnings = valid
    .filter((item) => !item.used && RULES[item.rule].kind === 'machine')
    .map((item) => ({ path: file.path, line: item.line, message: `@harness-exception ${item.rule} に当たる違反がありません。不要になったら消します` }))

  return { violations, suppressed, exceptions, errors, warnings }
}

export function checkArchitecture(files) {
  const result = { violations: [], suppressed: [], exceptions: [], errors: [], warnings: [], checked: 0 }
  for (const file of files) {
    if (!isCodeFile(file.path)) continue
    result.checked++
    const one = checkFile(file)
    for (const key of ['violations', 'suppressed', 'exceptions', 'errors', 'warnings']) result[key].push(...one[key])
  }
  return result
}
