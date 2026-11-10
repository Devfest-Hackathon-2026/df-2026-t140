// 投票の集計と決定の純粋な判断。SDK を使わないので、Emulator なしで試せる（scripts/functions.test.mjs）。

/** トリガーが見るメンバーの変化か。「投票したルート」が変わったときと、メンバーが抜けたとき */
export function voteChanged(
  before: { votedRouteId?: string | null } | undefined,
  after: { votedRouteId?: string | null } | undefined,
): boolean {
  if (!after) return before !== undefined
  return (before?.votedRouteId ?? null) !== (after.votedRouteId ?? null)
}

export interface TallyInput {
  /** いまのルート案。先の案から順（A、B、C） */
  routes: readonly { id: string; label: string }[]
  /** メンバーそれぞれの「投票したルート」。未投票は null */
  votes: readonly (string | null)[]
}

/**
 * 決まるルートを返す。まだ決まらなければ null。
 * - メンバーが 1 人以上いて、全員が、いまあるルート案のどれかに投票しているときだけ決まる
 *   （作り直す前の案への票は、数えない。その人は、まだ投票していない扱い）
 * - いちばん票の多い案に決まる。同数なら、先の案（A、B、C の順）
 */
export function decideRoute({ routes, votes }: TallyInput): string | null {
  if (routes.length === 0 || votes.length === 0) return null
  const sorted = [...routes].sort((left, right) => left.label.localeCompare(right.label))
  const ids = new Set(sorted.map((route) => route.id))
  if (!votes.every((vote) => vote !== null && ids.has(vote))) return null
  let winner = sorted[0]
  let most = -1
  for (const route of sorted) {
    const count = votes.filter((vote) => vote === route.id).length
    if (count > most) {
      winner = route
      most = count
    }
  }
  return winner.id
}
