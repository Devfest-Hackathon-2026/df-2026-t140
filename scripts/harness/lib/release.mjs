// main を deploy へ反映する（npm run release）の判断の部分。git と gh を呼ぶのは release.mjs。
// 人だけが使う。AI はガードの no-push-deploy / no-deploy で止まる（docs/process/setup.md「本番への反映」）。

/** GitHub Actions の paths のうち、ここで使う形（dir/**、**\/*.ext、ファイル名そのもの）だけを扱う */
export function matchesPattern(path, pattern) {
  if (pattern.endsWith('/**') && !pattern.slice(0, -3).includes('*')) return path.startsWith(pattern.slice(0, -2))
  const ext = pattern.match(/^\*\*\/\*(\.[^*/]+)$/)
  if (ext) return path.endsWith(ext[1])
  if (!pattern.includes('*')) return path === pattern
  return false
}

export const isCiIgnored = (path, patterns) => patterns.some((pattern) => matchesPattern(path, pattern))

/**
 * 落ちた CI のうち、ジョブが始まらなかっただけのものに notStarted の印を付ける。runs は新しい順。
 * jobsOf(run)：その CI のジョブの並び。notStarted(job)：そのジョブが始まらなかったか（注記で決める。lib/verify-local.mjs の jobNotStarted）。
 * - 新しいほうから見て、通った CI か、走って落ちた CI に当たったら、そこで確かめるのをやめる（それより古い CI は、反映の判断に使わない）。
 *   Actions が止まっているあいだは、始まらなかった CI が merge のたびに増えるので、数では打ち切らない
 * - すべてのジョブが始まらなかったときだけ印を付ける。ジョブがない、読めない（例外）ときは付けない（ふつうの失敗として止める）
 */
export function markNotStarted(runs, { jobsOf, notStarted }) {
  let done = false
  return runs.map((run) => {
    if (done || run.status !== 'completed') return run
    if (run.conclusion === 'success') {
      done = true
      return run
    }
    if (run.conclusion !== 'failure') return run
    let skipped = false
    try {
      const jobs = jobsOf(run) ?? []
      skipped = jobs.length > 0 && jobs.every((job) => notStarted(job))
    } catch {
      skipped = false
    }
    if (!skipped) done = true
    return skipped ? { ...run, notStarted: true } : run
  })
}

/**
 * 反映してよいかを決める。
 * runs：main への push で動いた CI（新しい順）。{ headSha, status, conclusion, notStarted? }
 * notStarted は、ジョブが始まらなかった（GitHub が、支払い・利用上限でジョブを始めなかった）CI。落ちたのではなく、確かめていないだけ
 * isAncestor(a, b)：a が b の祖先（同じも含む）か
 * changedSince(sha)：sha から main の先頭までに変わったファイル
 *
 * 止めない（2026-11-22 から。main への push では CI を走らせず、merge の条件も手元の確認の記録にしたため。Lazyturtle0852 の決定）。
 * main の CI が落ちていても、取り消されていても、note で知らせて反映する。前は、main の CI が落ちたと分かっているときだけ止めていた。走っている途中・まだ確かめていない変更があるときは待たずに進む。
 * deploy.yml がデプロイの前に同じ verify をかけるので、通らない中身は本番に出ない（main の CI を待つと、同じ確認を 2 回待つことになる。
 * かめの判断、2026-11-19）。そのときは note で、deploy の verify が確かめることを伝える。
 * ジョブが始まらなかった CI（notStarted）も、落ちたとは言えないので止めない（かめが反映しようとして止まった。2026-11-21）。
 * Actions が止まったままなら、Deploy のジョブも始まらず、本番には出ない（note でそう伝える）
 */
export function judgeCi({ mainSha, runs, patterns, isAncestor, changedSince }) {
  const byDeploy = 'デプロイの前に、Deploy の verify が確かめます'
  // main への push では CI を走らせなくなった（2026-11-22）ので、古い失敗や取り消しを上書きする CI は来ない。止めずに知らせるだけにする
  const notGate = `main の CI は反映の条件にしない（2026-11-22）ので反映し、${byDeploy}。落ちた中身なら Deploy が止まります`
  const head = runs.find((run) => run.headSha === mainSha)
  const notStartedNote = (sha) =>
    `main の CI（${sha.slice(0, 7)}）は、ジョブが始まりませんでした（GitHub Actions の支払い・利用上限など）。落ちたのではないので反映し、${byDeploy}。Actions が止まったままなら、Deploy も始まらず、本番には出ません（Actions を戻してから、Deploy を走らせ直します）`
  // 先頭の CI が始まらなかったときは、先頭を確かめていないものとして、下の「その前の CI」の見方に進む（前の commit で走って落ちていれば止める）
  if (head && !head.notStarted) {
    if (head.status !== 'completed') return { ok: true, note: `main の先頭（${mainSha.slice(0, 7)}）の CI はまだ走っています。待たずに反映し、${byDeploy}` }
    if (head.conclusion !== 'success') return { ok: true, note: `main の先頭（${mainSha.slice(0, 7)}）の CI が通っていません（${head.conclusion}）。${notGate}` }
    return { ok: true, note: `main の先頭（${mainSha.slice(0, 7)}）の CI は通っています` }
  }
  // 文書と todo だけの commit では CI が走らない。最後に CI が通った commit から、CI の対象の変更がないかを見る
  const passed = runs.find((run) => run.status === 'completed' && run.conclusion === 'success' && isAncestor(run.headSha, mainSha))
  const newer = (run) => isAncestor(run.headSha, mainSha) && (!passed || !isAncestor(run.headSha, passed.headSha))
  const failed = runs.find((run) => run.status === 'completed' && run.conclusion !== 'success' && !run.notStarted && newer(run))
  if (failed) return { ok: true, note: `main の CI（${failed.headSha.slice(0, 7)}）が通っていません（${failed.conclusion}）。${notGate}` }
  const skipped = runs.find((run) => run.notStarted && newer(run))
  if (skipped) return { ok: true, note: notStartedNote(skipped.headSha) }
  if (!passed) return { ok: true, note: `main で CI が通った commit が見つかりません。${byDeploy}` }
  const pending = runs.find((run) => run.status !== 'completed' && newer(run))
  if (pending) return { ok: true, note: `main の CI（${pending.headSha.slice(0, 7)}）はまだ走っています。待たずに反映し、${byDeploy}` }
  const unchecked = changedSince(passed.headSha).filter((path) => !isCiIgnored(path, patterns))
  if (unchecked.length > 0) {
    return { ok: true, note: `CI が通った ${passed.headSha.slice(0, 7)} のあとに、main の CI でまだ確かめていない変更があります（${unchecked.slice(0, 5).join('、')}${unchecked.length > 5 ? ' ほか' : ''}）。${byDeploy}` }
  }
  return { ok: true, note: `CI は ${passed.headSha.slice(0, 7)} で通っています（そのあとは文書などの CI の対象外の変更だけです）` }
}
