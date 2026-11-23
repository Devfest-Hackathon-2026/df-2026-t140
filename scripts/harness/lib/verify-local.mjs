// 手元で CI と同じ確認を走らせて記録する（npm run verify:local）ための、純粋な決め（I/O なし。tests/verify-local.test.mjs）。
// merge の条件は、CI ではなく、今の先頭の commit の「手元で通った記録」にする（ガードは lib/command-guard.mjs の mergeProblems）。
// CI は本番への反映のときに Deploy の verify がまとめて確かめる（Lazyturtle0852 の決定、2026-11-22。前は CI が始まらないときだけ代えていた）。
// 手順を飛ばさないための記録で、改ざんへの防御ではない（レビューの目印と同じく、実装した AI が自分で残す）。
// 判断の記録：todo/humans/2026-11-21-local-verify-policy.md

/** 手元で通った記録の目印。verify-local.mjs が PR のコメントに入れる。sha は確かめた commit（40 けた） */
export const VERIFY_MARKER = /<!-- harness-verify result=pass sha=([0-9a-f]{40}) -->/

/** 目印の 1 行 */
export const verifyMarker = (sha) => `<!-- harness-verify result=pass sha=${sha} -->`

/** GitHub が、支払い・利用上限でジョブを始めなかったときに付ける注記 */
export const NOT_STARTED = /The job was not started because/i

/** チェックの注記（check-runs の annotations）から、ジョブが始まらなかったかを決める */
export function jobNotStarted(annotations) {
  return (annotations ?? []).some((item) => NOT_STARTED.test(item?.message ?? ''))
}

// Emulator の確認（npm run verify）を走らせない変更。手元の確認と、本番への反映の判断（release.mjs）が使う。
// 前は ci.yml の paths-ignore と同じ並びにしていたが、ci.yml は手で走らせるときだけになったので、ここが正本（2026-11-22）
export const LIGHT_PATHS = ['docs/**', 'todo/**', 'transcripts/**', '**/*.md', '.claude/**', '.agents/**', '.codex/**', '.gemini/**', '.githooks/**', 'evals/**', 'harness.config.json']

const isLight = (file) =>
  LIGHT_PATHS.some((pattern) => {
    if (pattern === '**/*.md') return file.endsWith('.md')
    if (pattern.endsWith('/**')) return file.startsWith(pattern.slice(0, -2))
    return file === pattern
  })

/** 変えたファイルから、Emulator の確認（npm run verify）が要るか。CI と同じく、文書やハーネスの設定だけなら要らない */
export function heavyNeeded(files) {
  return files.some((file) => !isLight(file))
}

/** Emulator のポートをずらす量（npm run dev:alt）。画面は、開いたポートの 1 万の位で、つなぐ Emulator のずれを決める（web/src/shared/api/connect.ts） */
export const ALT_OFFSET = 10000

/**
 * 手元の確認（verify:local）が使うずれ。既定のポート（ずれ 0）は使わず、この Mac のセルフホストランナーの Deploy に空けておく。
 * 手元の確認が先に既定のポートを取ると、あとから来た Deploy が「port taken」で落ちるため（2026-11-23、かめの決定）。
 * 10000 がふさがっていれば（ほかの手元の確認、npm run dev:alt）20000 にする
 */
export const LOCAL_OFFSETS = [ALT_OFFSET, 2 * ALT_OFFSET]

/** 使うずれを選ぶ。isFree(offset) が true を返す最初のずれ。どれもふさがっていれば null */
export async function pickLocalOffset(isFree, offsets = LOCAL_OFFSETS) {
  for (const offset of offsets) if (await isFree(offset)) return offset
  return null
}

/** firebase.json に書いていない Emulator の既定のポート（ずらさないとぶつかる） */
const EXTRA_PORTS = { hub: 4400, ui: 4000, logging: 4500, eventarc: 9299, tasks: 9499, firestoreWs: 9150 }

/**
 * firebase.json の中身から、Emulator のポートを全部 offset ずらした設定を作る（firebase.alt.json に書いて使う。npm run dev:alt と同じ形）
 */
export function altFirebaseConfig(config, offset = ALT_OFFSET) {
  const emulators = Object.fromEntries(
    Object.entries(config.emulators ?? {}).map(([name, value]) =>
      typeof value === 'object' && value && 'port' in value ? [name, { ...value, port: value.port + offset }] : [name, value],
    ),
  )
  emulators.hub = { host: '127.0.0.1', port: EXTRA_PORTS.hub + offset }
  emulators.ui = { ...(emulators.ui ?? {}), enabled: true, port: EXTRA_PORTS.ui + offset }
  emulators.logging = { port: EXTRA_PORTS.logging + offset }
  emulators.eventarc = { port: EXTRA_PORTS.eventarc + offset }
  emulators.tasks = { port: EXTRA_PORTS.tasks + offset }
  // Firestore は、書いたポートのほかに WebSocket の 9150 も使う
  emulators.firestore = { ...(emulators.firestore ?? {}), websocketPort: EXTRA_PORTS.firestoreWs + offset }
  return { ...config, emulators }
}

/** Emulator が使うポート（firebase.json に書いたものと、既定のもの）。空いているかを確かめるのに使う */
export function emulatorPorts(config, offset = 0) {
  const listed = Object.values(config.emulators ?? {}).flatMap((value) => (typeof value === 'object' && value && 'port' in value ? [value.port] : []))
  return [...new Set([...listed, ...Object.values(EXTRA_PORTS)])].map((port) => port + offset)
}

/**
 * package.json の verify の命令を、ずらした Emulator で走る形にする（firebase.alt.json を読ませる）。
 * 命令そのものは package.json の 1 か所に置き、ここでは書き写さない。形が変わって置き換えられなければ null
 */
export function altVerifyCommand(command, configFile = 'firebase.alt.json') {
  const from = 'firebase emulators:exec '
  if (!command.includes(from) || command.includes('--config ')) return null
  return command.replace(from, `${from}--config ${configFile} `)
}

/** PR に残すコメント。steps は { name, detail } の並び */
export function verifyComment({ sha, steps, where }) {
  return [
    '## 手元の確認（npm run verify:local）：通りました',
    '',
    `commit ${sha.slice(0, 7)} を、${where}で確かめました。CI と同じ命令です（CI の代わりになるのは、CI のジョブが始まらなかったときだけ。docs/process/work.md）。`,
    '',
    ...steps.map((step) => `- ${step.name}：${step.detail}`),
    '',
    verifyMarker(sha),
  ].join('\n')
}
