// ローカルと本番で同じ版を使っていることを確かめる。版は .tool-versions で管理する。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const versions = Object.fromEntries(
  readFileSync(new URL('../.tool-versions', import.meta.url), 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(/\s+/)),
)
const wantedNode = Number(versions.nodejs)
const wantedJava = Number(versions.java.match(/\d+/)[0])

const problems = []

const node = Number(process.versions.node.split('.')[0])
if (node !== wantedNode) problems.push(`Node ${wantedNode} が必要です（今は ${node}）`)

// java -version は標準エラーに出力する
const java = spawnSync('java', ['-version'], { encoding: 'utf8' })
const javaMajor = Number(`${java.stderr}${java.stdout}`.match(/version "(\d+)/)?.[1])
if (javaMajor !== wantedJava) {
  problems.push(`Java ${wantedJava} が必要です（今は ${javaMajor || '見つかりません'}）`)
}

if (problems.length > 0) {
  console.error(problems.join('\n'))
  console.error('`mise install` のあと、`mise exec -- npm run ...` で実行してください。docs/process/setup.md も参照してください。')
  process.exit(1)
}
