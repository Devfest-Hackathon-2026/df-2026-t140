// AI がファイルを書き換える前に調べる。返り値の decision は allow / deny / ask。
import { relative } from 'node:path'
import { isProtectedBranch } from './conventions.mjs'
import { toPosix } from './paths.mjs'
import { isDirectToMainPath } from './policy.mjs'

// ガードレールそのもの。AI が弱めないよう、変えるときは人に確かめる
const HARNESS_FILES = [
  /^\.claude\/settings\.json$/,
  /^\.agents\/hooks\.json$/,
  /^\.claude\/agents\//,
  /^\.githooks\//,
  /^scripts\/harness\/(?!tests\/)/,
  /^\.github\/workflows\//,
  /^\.gemini\/settings\.json$/,
  /^\.codex\//,
]
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$)[^/]+)?|\.dev\.vars(\.(?!example$)[^/]+)?|[^/]*\.(pem|key|p12|pfx)|(service-account|credentials)[^/]*\.json)$/i

export const isSecretFile = (path) => SECRET_FILE.test(path)

export function checkEdit({ filePath, projectDir, branch }) {
  const rel = toPosix(relative(projectDir, filePath))
  if (!rel || rel.startsWith('../') || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/')) return { decision: 'allow' } // プロジェクトの外（メモ、一時ファイル）
  if (rel.startsWith('.harness/')) return { decision: 'allow' } // 手元だけの記録
  if (rel === '.git' || rel.startsWith('.git/')) {
    return { decision: 'deny', rule: 'no-git-internals', message: '.git の中は直接書き換えません。git の命令を使います' }
  }
  if (SECRET_FILE.test(rel)) {
    return {
      decision: 'deny',
      rule: 'no-secret-files',
      message: '秘密情報のファイルは AI が書きません。必要な変数の名前を .env.example に書き、値の設定は todo/humans/ で人に頼みます（`npm run human -- add`）',
    }
  }
  if (rel === 'harness.config.json') {
    // 自動で進めてよい期間を AI が自分で延ばさないよう、期間中も止める（変えるのは人）
    return { decision: 'deny', rule: 'harness-config', message: 'harness.config.json（自動で進めてよい期間など）は人が変えます。変えたいときは `npm run human -- add` で頼みます' }
  }
  if (rel.startsWith('.local/')) {
    return { decision: 'deny', rule: 'no-local-dir', message: '.local/ は運営資料などの置き場で、AI は書き換えません' }
  }
  if (isProtectedBranch(branch) && isDirectToMainPath(rel)) return { decision: 'allow' } // 人の判断の記録は main で直接直してよい
  if (isProtectedBranch(branch)) {
    return {
      decision: 'deny',
      rule: 'no-edit-on-main',
      message: `いまのブランチは ${branch} です。main では編集しません（todo/humans/ だけは別で、どのブランチで書いても \`npm run human -- publish\` で main に直接入れてよい）。先に \`npm run work -- start <種類>/<内容>\` で作業ブランチと作業宣言を作ります（未 commit の変更はそのまま新しいブランチへ移ります）。他の人の作業は \`npm run work -- status\``,
    }
  }
  if (/^docs\/(ui\/screen-flow|architecture\/sources)\//.test(rel)) {
    return {
      decision: 'ask',
      rule: 'artifact-copy',
      message: 'ここは artifact のコピーで、直接は編集しません。原本の artifact を更新したあと、コピーを取り直すときだけ書き換えます（docs/README.md「更新の手順」）',
    }
  }
  if (HARNESS_FILES.some((pattern) => pattern.test(rel))) {
    return {
      decision: 'ask',
      rule: 'harness-change',
      message: 'ガードレール（hooks、権限、CI、ハーネスのスクリプト）を変えます。弱める変更でないか、人が確かめてから進めます',
    }
  }
  return { decision: 'allow' }
}
