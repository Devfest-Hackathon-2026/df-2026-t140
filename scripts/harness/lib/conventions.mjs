// ブランチ名と commit メッセージの決まり。これまでの履歴（chore/local-prod-parity、
// docs/screen-flow、「docs: 〜を追加」）に合わせてある。説明は docs/process/work.md。

export const BRANCH_TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'perf', 'ci']
export const COMMIT_TYPES = [...BRANCH_TYPES, 'build', 'style', 'revert']
export const PROTECTED_BRANCHES = ['main', 'master']

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_BRANCH_LENGTH = 60

export const isProtectedBranch = (name) => PROTECTED_BRANCHES.includes(name)
// 本番へ出すブランチ。人が main から反映したときだけ Deploy が走る（かめの決定：todo/humans/2026-11-07-deploy-branch.md）。
// AI は push も commit も merge もしない
// 作業中の PR の目印。Free の Organization の private リポジトリでは Draft PR が使えないので、ラベルで表す
// （リポジトリを Organization へ移したため。かめと会話で合意、2026-11-18）
export const WIP_LABEL = '作業中'
export const isWipPr = (pr) => Boolean(pr?.isDraft) || (pr?.labels ?? []).some((label) => (label?.name ?? label) === WIP_LABEL)

export const DEPLOY_BRANCH = 'deploy'
export const isDeployBranch = (name) => name === DEPLOY_BRANCH

export function checkBranchName(name) {
  const example = '例：feat/trip-create、fix/pin-sync、docs/ui-readme'
  if (!name) return { ok: false, reason: 'ブランチ名が空です' }
  if (isProtectedBranch(name)) return { ok: false, reason: `${name} は作業用のブランチにできません` }
  if (isDeployBranch(name)) return { ok: false, reason: `${name} は本番へ出すブランチで、作業用にできません（人が main から反映します）` }
  if (name.length > MAX_BRANCH_LENGTH) {
    return { ok: false, reason: `ブランチ名は ${MAX_BRANCH_LENGTH} 文字以内にします（${example}）` }
  }
  const parts = name.split('/')
  if (parts.length !== 2) {
    return { ok: false, reason: `ブランチ名は「種類/内容」の 2 つに分けます（${example}）` }
  }
  const [type, slug] = parts
  if (!BRANCH_TYPES.includes(type)) {
    return { ok: false, reason: `種類は ${BRANCH_TYPES.join('、')} のどれかにします（今は「${type}」）` }
  }
  if (!SLUG.test(slug)) {
    return { ok: false, reason: `内容は英小文字・数字・ハイフンだけで書きます（今は「${slug}」。${example}）` }
  }
  return { ok: true }
}

// 作業宣言のファイル。1 ブランチに 1 ファイルなので、ほかの作業と衝突しない。
export const ledgerPathFor = (branch) => `docs/work/${branch.replace('/', '-')}.md`

const COMMIT_PATTERN = new RegExp(`^(${COMMIT_TYPES.join('|')})(\\([^)]+\\))?!?: \\S`)
const MAX_SUBJECT_LENGTH = 120

export function checkCommitMessage(message) {
  const subject =
    message
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#')) ?? ''
  if (/^(Merge |Revert "|fixup! |squash! |amend! )/.test(subject)) return { ok: true }
  if (!COMMIT_PATTERN.test(subject)) {
    return {
      ok: false,
      reason: `commit の 1 行目は「種類: 日本語の説明」にします（例：feat: 旅の作成画面を追加する）。種類は ${COMMIT_TYPES.join('、')}`,
    }
  }
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { ok: false, reason: `commit の 1 行目は ${MAX_SUBJECT_LENGTH} 文字以内にします` }
  }
  return { ok: true }
}
