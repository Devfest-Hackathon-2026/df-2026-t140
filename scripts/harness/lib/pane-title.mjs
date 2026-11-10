// ターミナルの pane（Ghostty の split、tmux の window）の名前を、今の作業の名前にする。
// 名前は作業宣言（docs/work/<ブランチ>.md）の title。宣言がなければブランチ名。
// セッションの開始、プロンプトの送信、ツールの実行のたびに呼ばれ、作業が変わっていれば書き換える。
// 表示に関わるだけなので、失敗しても止めない（fail-open）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ledgerPathFor } from './conventions.mjs'
import { parseFrontMatter } from './frontmatter.mjs'
import { currentBranch, run } from './proc.mjs'

const MAX_LENGTH = 60

// 作業の名前を決める。純粋な関数（テスト用に、読む関数を差し替えられる）
export function paneTitle({ branch, readLedger }) {
  if (!branch) return ''
  let title
  try {
    const text = readLedger(ledgerPathFor(branch))
    if (text) title = String(parseFrontMatter(text).data.title ?? '').trim()
  } catch {
    title = undefined
  }
  // 端末にそのまま書くので、制御文字（ESC、BEL、改行など）を除く。title に ESC ] … BEL を入れて端末を操作されないように
  // eslint-disable-next-line no-control-regex
  const name = (title || branch).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()
  return name.length > MAX_LENGTH ? `${name.slice(0, MAX_LENGTH - 1)}…` : name
}

export function paneTitleFor(projectDir) {
  const branch = currentBranch(projectDir)
  return paneTitle({
    branch,
    readLedger: (path) => (existsSync(join(projectDir, path)) ? readFileSync(join(projectDir, path), 'utf8') : undefined),
  })
}

// 端末に名前を書く。フックの stdout は端末に出ないので、/dev/tty に直接書く
export function applyPaneTitle(projectDir) {
  if (process.env.HARNESS_PANE_TITLE === '0' || process.platform === 'win32') return undefined
  const title = paneTitleFor(projectDir)
  if (!title) return undefined
  try {
    writeFileSync('/dev/tty', `\u001b]0;${title}\u0007`)
  } catch {
    // 端末がない（CI、バックグラウンド）
  }
  if (process.env.TMUX) run('tmux', ['rename-window', title], { timeout: 2_000 })
  return title
}
