import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { checkCommand } from '../lib/command-guard.mjs'
import { checkEdit } from '../lib/edit-guard.mjs'
import { ALLOW, ALLOW_POWERSHELL, DENY, DENY_ON_DEPLOY, DENY_ON_MAIN, DENY_POWERSHELL } from './cases/guard-cases.mjs'

const projectDir = resolve(process.cwd(), '.harness-test-project')

function ctx(overrides = {}) {
  return {
    branch: 'feat/trip-create',
    projectDir,
    cwd: projectDir,
    shell: 'bash',
    remoteUrl: (name) =>
      name === 'submit' ? 'https://github.com/Devfest-Hackathon-2026/df-2026-t140.git' : 'https://github.com/Lazyturtle0852/konbu-devfest.git',
    prInfo: (target) => PRS[target],
    ...overrides,
  }
}

// merge の評価用の PR（gh pr view の結果を、ハーネスが読む形にしたもの）
const ready = { base: 'main', files: ['web/src/app/App.tsx'], isDraft: false, mergeable: 'MERGEABLE', checks: [{ name: 'harness', state: 'SUCCESS' }, { name: 'verify', state: 'SKIPPED' }], review: { verdict: 'APPROVE', sha: 'abc1234' }, headSha: 'abc1234def567' }
const PRS = {
  12: { ...ready, files: ['docs/work/feat-trip-create.md'], isDraft: true, checks: [], review: undefined }, // 作業宣言だけ
  20: ready,
  21: { ...ready, review: undefined, reviewDecision: 'APPROVED' }, // 人が承認した
  13: { ...ready, review: undefined },
  14: { ...ready, checks: [{ name: 'harness', state: 'FAILURE' }] },
  15: { ...ready, isDraft: true },
  16: { ...ready, mergeable: 'CONFLICTING' },
  17: { ...ready, review: { verdict: 'APPROVE', sha: '0000000' } },
  18: { ...ready, checks: [{ name: 'verify', state: 'PENDING' }] },
  19: { ...ready, review: { verdict: 'REQUEST_CHANGES', sha: 'abc1234' } },
  30: { ...ready, base: 'deploy', files: ['web/src/app/App.tsx'] }, // main → deploy の反映。条件がそろっていても人が行う
}

const rules = (command, overrides) => checkCommand(command, ctx(overrides)).map((item) => item.rule)

test('正常系：普段の操作は止めない（止めすぎない）', () => {
  for (const command of ALLOW) assert.deepEqual(rules(command), [], command)
  for (const command of ALLOW_POWERSHELL) assert.deepEqual(rules(command, { shell: 'powershell' }), [], command)
})

test('異常系：危険な操作は、決めたルールで止める', () => {
  for (const [command, rule] of DENY) assert.ok(rules(command).includes(rule), `${command} → ${rule}（実際：${rules(command).join(',') || 'なし'}）`)
  for (const [command, rule] of DENY_POWERSHELL) {
    const actual = rules(command, { shell: 'powershell' })
    assert.ok(actual.includes(rule), `${command} → ${rule}（実際：${actual.join(',') || 'なし'}）`)
  }
})

test('異常系：main の上では commit、merge、push を止める', () => {
  for (const [command, rule] of DENY_ON_MAIN) {
    const actual = rules(command, { branch: 'main' })
    assert.ok(actual.includes(rule), `${command} → ${rule}（実際：${actual.join(',') || 'なし'}）`)
  }
})

test('異常系：deploy の上では commit、merge、push を止める（deploy への反映は人が行う）', () => {
  for (const [command, rule] of DENY_ON_DEPLOY) {
    const actual = rules(command, { branch: 'deploy' })
    assert.ok(actual.includes(rule), `${command} → ${rule}（実際：${actual.join(',') || 'なし'}）`)
  }
})

test('正常系：deploy を読むだけの操作と、main への PR の merge は止めない', () => {
  for (const command of ['git fetch origin deploy', 'git log origin/deploy --oneline -5', 'git diff origin/deploy...origin/main', 'git switch deploy', 'gh pr merge 20 --merge', 'gh pr create --base deploy --head main --title "本番へ反映する" --body x']) {
    assert.deepEqual(rules(command), [], command)
  }
})

test('main でも、todo/humans/ だけの commit と push は通す（人の判断の記録）', () => {
  const humans = ['todo/humans/2026-11-07-x.md']
  const onMain = { branch: 'main', stagedFiles: () => humans, outgoingFiles: () => humans }
  for (const command of ['git commit -m "docs: 判断を記録する"', 'git commit -q -m "docs: x" --author="T <t@example.invalid>"', 'git commit -sm "docs: x"','git push', 'git push origin main', 'git push origin HEAD', 'git push -u origin main', 'git push origin HEAD:main']) {
    assert.deepEqual(rules(command, onMain), [], command)
  }
})

test('main で todo/humans/ 以外が混ざる、または中身が決まらない commit と push は止める', () => {
  const mixed = ['todo/humans/2026-11-07-x.md', 'CLAUDE.md']
  const humans = ['todo/humans/2026-11-07-x.md']
  const cases = [
    ['git commit -m "docs: x"', { stagedFiles: () => mixed }, 'no-commit-on-main'],
    ['git commit -m "docs: x"', { stagedFiles: () => [] }, 'no-commit-on-main'],
    ['git commit -am "docs: x"', { stagedFiles: () => humans }, 'no-commit-on-main'],
    ['git commit -a -m "docs: x"', { stagedFiles: () => humans }, 'no-commit-on-main'],
    ['git commit --amend -m "docs: x"', { stagedFiles: () => humans }, 'no-commit-on-main'],
    ['git commit -m "docs: x" -- CLAUDE.md', { stagedFiles: () => humans }, 'no-commit-on-main'],
    ['git commit -m "docs: x" CLAUDE.md', { stagedFiles: () => humans }, 'no-commit-on-main'],
    ['git commit -m "docs: x" --pathspec-from-file=list.txt', { stagedFiles: () => humans }, 'no-commit-on-main'],
    ['git commit -m "docs: x"', {}, 'no-commit-on-main'], // 調べられない
    ['git merge feat/x', { stagedFiles: () => humans }, 'no-commit-on-main'],
    ['git push origin main', { outgoingFiles: () => mixed }, 'no-push-main'],
    ['git push', { outgoingFiles: () => [] }, 'no-push-main'],
    ['git push', {}, 'no-push-main'],
    ['git push --force origin main', { outgoingFiles: () => humans }, 'no-force-push'],
    ['git push origin +main', { outgoingFiles: () => humans }, 'no-force-push'],
    ['git push --all origin', { outgoingFiles: () => humans }, 'no-push-main'],
    ['git push origin feat/x:main', { outgoingFiles: () => humans }, 'no-push-main'],
  ]
  for (const [command, overrides, rule] of cases) {
    const actual = rules(command, { branch: 'main', ...overrides })
    assert.ok(actual.includes(rule), `${command} → ${rule}（実際：${actual.join(',') || 'なし'}）`)
  }
  // 作業ブランチから手で main へ push するのは、todo/humans/ だけでも止める。todo/humans/ は npm run human -- publish が入れる
  assert.ok(rules('git push origin HEAD:main', { branch: 'feat/x', outgoingFiles: () => humans }).includes('no-push-main'))
})

test('止めるときは、代わりにどうするかを必ず書く', () => {
  for (const [command] of [...DENY, ...DENY_ON_MAIN, ...DENY_ON_DEPLOY]) {
    for (const finding of checkCommand(command, ctx({ branch: 'main' }))) {
      assert.ok(finding.message && finding.message.length > 20, `${command} の ${finding.rule} に説明がない`)
    }
  }
})

test('ファイルの編集：main では止め、作業ブランチでは通す', () => {
  const file = resolve(projectDir, 'web/src/app/App.tsx')
  assert.equal(checkEdit({ filePath: file, projectDir, branch: 'main' }).decision, 'deny')
  assert.equal(checkEdit({ filePath: file, projectDir, branch: 'feat/trip-create' }).decision, 'allow')
  // 人の判断の記録だけは main で直してよい
  assert.equal(checkEdit({ filePath: resolve(projectDir, 'todo/humans/2026-11-07-x.md'), projectDir, branch: 'main' }).decision, 'allow')
  assert.equal(checkEdit({ filePath: resolve(projectDir, 'todo/other.md'), projectDir, branch: 'main' }).decision, 'deny')
})

test('ファイルの編集：秘密情報、運営資料、artifact のコピー、ガードレール', () => {
  const at = (path) => checkEdit({ filePath: resolve(projectDir, path), projectDir, branch: 'feat/x' })
  assert.equal(at('web/.env.local').decision, 'deny')
  assert.equal(at('.env').decision, 'deny')
  assert.equal(at('web/.env.example').decision, 'allow')
  assert.equal(at('.local/kickoff.pdf').decision, 'deny')
  assert.equal(at('.git/config').decision, 'deny')
  assert.equal(at('docs/ui/screen-flow/S01-Start.dc.html').decision, 'ask')
  assert.equal(at('.claude/settings.json').decision, 'ask')
  assert.equal(at('.githooks/pre-push').decision, 'ask')
  assert.equal(at('scripts/harness/lib/command-guard.mjs').decision, 'ask')
  assert.equal(at('scripts/harness/tests/cases/guard-cases.mjs').decision, 'allow')
  assert.equal(at('.harness/trace/x.jsonl').decision, 'allow')
  assert.equal(at('harness.config.json').decision, 'deny', '自動で進めてよい期間を AI が自分で延ばさない')
})

test('ファイルの編集：プロジェクトの外（メモや一時ファイル）は対象外', () => {
  const outside = resolve(projectDir, '..', 'memory', 'note.md')
  assert.equal(checkEdit({ filePath: outside, projectDir, branch: 'main' }).decision, 'allow')
})
