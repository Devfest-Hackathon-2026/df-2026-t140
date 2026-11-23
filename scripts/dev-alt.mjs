// 2 組目の Emulator を立てる（npm run dev:alt）。ポートを全部 10000 ずらすので、同じ Mac で別の Emulator
// （CI のセルフホストランナー、ほかの作業の npm run dev）が動いていてもぶつからない。
// 画面は http://localhost:15173 、Emulator の画面は http://localhost:14000 。止めるときは Ctrl+C。
//
// firebase.json をもとに、ポートをずらした firebase.alt.json（.gitignore に入れてある）を作って使う。
// Firebase CLI は設定ファイルのあるフォルダを基準に読むので、リポジトリの直下に置く。
// 画面は、開いたポートの 1 万の位で、つなぐ Emulator のずれを決める（web/src/shared/api/connect.ts）
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { altFirebaseConfig } from './harness/lib/verify-local.mjs'

const OFFSET = 10000
const PROJECT_ID = 'konbu-devfest-hackathon-2026'
const root = new URL('..', import.meta.url)

const config = JSON.parse(readFileSync(new URL('firebase.json', root), 'utf8'))
// ポートをずらした設定の作り方は、手元の確認（npm run verify:local）と同じもの
writeFileSync(new URL('firebase.alt.json', root), `${JSON.stringify(altFirebaseConfig(config, OFFSET), null, 2)}\n`)

const env = { ...process.env, EMULATOR_PORT_OFFSET: String(OFFSET) }
// 画面か見本のデータが失敗したときの終了コード。全部を止めたあと、これで終える（呼んだ側が失敗に気づけるように）
let failed = 0
const children = []
function run(name, command, args) {
  const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split('\n')) if (line) console.log(`[${name}] ${line}`)
    })
  }
  children.push(child)
  return child
}
function stop() {
  for (const child of children) child.kill('SIGINT')
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

// Functions と画面は、先にビルドしておく（Hosting の Emulator と Functions の Emulator が使う）
const build = run('build', 'npm', ['run', 'build'])
build.on('exit', (code) => {
  if (code !== 0) {
    console.error('ビルドに失敗しました')
    process.exit(code ?? 1)
  }
  const emu = run('emu', 'npx', ['firebase', 'emulators:start', '--config', 'firebase.alt.json', '--project', PROJECT_ID])
  // 画面か見本のデータが失敗したら、Emulator も止めて終える（npm run dev の --kill-others-on-fail と同じ）
  for (const [name, args] of [['web', ['npm', ['run', 'dev', '--prefix', 'web']]], ['seed', ['node', ['scripts/seed.mjs']]]]) {
    run(name, ...args).on('exit', (exitCode) => {
      if (exitCode !== 0 && exitCode !== null) {
        failed = exitCode
        console.error(`[${name}] が失敗しました（${exitCode}）。全部を止めます（15173 などのポートが使われていないか確かめてください）`)
        stop()
      }
    })
  }
  emu.on('exit', (exitCode) => {
    stop()
    process.exit(failed || exitCode || 0)
  })
})
