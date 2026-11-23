// チームの名簿（scripts/harness/members.json）。作業宣言の owner は git の user.name なので、GitHub のアカウント名と違うことがある
// （例：Takana → Takana-12）。名簿で GitHub のアカウントと Discord のユーザー ID を引く。純関数と読み込みだけを置く。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const MEMBERS_PATH = 'scripts/harness/members.json'

/** 名簿を読む。ない・壊れているときは空（担当とメンションを飛ばすだけで、ほかは止めない） */
export function loadMembers(root) {
  try {
    const data = JSON.parse(readFileSync(join(root, MEMBERS_PATH), 'utf8'))
    return Array.isArray(data.members) ? data.members.filter((member) => member && member.github) : []
  } catch {
    return []
  }
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()

/** owner（git の名前か GitHub のアカウント名）に当たる人。名簿になければ undefined */
export function findMember(owner, members = []) {
  if (!String(owner ?? '').trim()) return undefined
  return members.find((member) => same(member.github, owner) || (member.names ?? []).some((name) => same(name, owner)))
}

/** owner の GitHub のアカウント名。名簿になければ、owner がそのままアカウント名のことに賭けず undefined */
export const githubLogin = (owner, members) => findMember(owner, members)?.github

/** Discord で人を指す書き方。ID があればメンション（<@ID>）、なければ GitHub のアカウント名、名簿になければ owner のまま */
export function discordName(owner, members) {
  const member = findMember(owner, members)
  if (member && /^\d{5,}$/.test(String(member.discord ?? ''))) return `<@${member.discord}>`
  return member?.github ?? owner
}
