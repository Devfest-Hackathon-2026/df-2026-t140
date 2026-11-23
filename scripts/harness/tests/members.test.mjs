// チームの名簿（lib/members.mjs）と、着手した Issue の担当（lib/board.mjs の planAssignees）。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planAssignees } from '../lib/board.mjs'
import { discordName, findMember, githubLogin, loadMembers } from '../lib/members.mjs'

const members = [
  { github: 'Takana-12', names: ['Takana'], discord: '' },
  { github: 'Mah110hat', names: ['Paralysis'], discord: '123456789012345678' },
]

test('git の名前からも GitHub のアカウント名からも、同じ人を引く（大文字と小文字は区別しない）', () => {
  assert.equal(githubLogin('Takana', members), 'Takana-12')
  assert.equal(githubLogin('takana-12', members), 'Takana-12')
  assert.equal(githubLogin('Paralysis', members), 'Mah110hat')
  assert.equal(githubLogin('だれか', members), undefined, '名簿にない人は推測しない')
  assert.equal(findMember('', members), undefined)
})

test('Discord：ID があればメンション、なければ GitHub のアカウント名、名簿になければ owner のまま', () => {
  assert.equal(discordName('Paralysis', members), '<@123456789012345678>')
  assert.equal(discordName('Takana', members), 'Takana-12')
  assert.equal(discordName('Claude', members), 'Claude')
})

test('リポジトリの名簿は読めて、全員に GitHub のアカウントがある', () => {
  const list = loadMembers(process.cwd())
  assert.ok(list.length > 0)
  for (const member of list) assert.match(member.github, /^[A-Za-z0-9-]+$/)
})

const entry = (over = {}) => ({ branch: 'feat/x', issue: 10, owner: 'Takana', active: true, ...over })

test('担当：進行中の作業の Issue に、作業する人を足す', () => {
  const add = planAssignees({ entries: [entry()], issues: [{ number: 10, assignees: [] }], members })
  assert.deepEqual(add, [{ number: 10, login: 'Takana-12', branch: 'feat/x' }])
})

test('担当：もう付いている人、閉じた Issue、終わった作業、Issue のない作業には足さない', () => {
  const issues = [{ number: 10, assignees: ['takana-12'] }, { number: 11, assignees: [] }]
  assert.deepEqual(planAssignees({ entries: [entry()], issues, members }), [], 'もう付いている')
  assert.deepEqual(planAssignees({ entries: [entry({ issue: 12 })], issues, members }), [], '開いていない Issue')
  assert.deepEqual(planAssignees({ entries: [entry({ issue: 11, active: false })], issues, members }), [], '終わった作業')
  assert.deepEqual(planAssignees({ entries: [entry({ issue: undefined })], issues, members }), [], 'Issue がない')
})

test('担当：ほかの人が付いていても外さずに足す。同じ人を 2 回は足さない', () => {
  const add = planAssignees({ entries: [entry(), entry({ branch: 'fix/y' })], issues: [{ number: 10, assignees: ['Youkin06'] }], members })
  assert.deepEqual(add.map((item) => item.login), ['Takana-12'])
})

test('担当：名簿にない人は PR の作者で代える。担当にできないアカウントは足さない', () => {
  const issues = [{ number: 10, assignees: [] }]
  const fromPr = planAssignees({ entries: [entry({ owner: 'Claude', pr: { author: { login: 'Youkin06' } } })], issues, members })
  assert.deepEqual(fromPr.map((item) => item.login), ['Youkin06'])
  assert.deepEqual(planAssignees({ entries: [entry({ owner: 'Claude' })], issues, members }), [], '分からなければ付けない')
  assert.deepEqual(planAssignees({ entries: [entry()], issues, members, assignable: new Set(['youkin06']) }), [], 'collaborator でない')
})
