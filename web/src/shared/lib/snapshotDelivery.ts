/** 一覧の初回・再接続と、新しい変更を区別する。接続状態は安定した文書の購読から受け取る。 */
export function snapshotDelivery() {
  let synced = false
  let connected = false
  let baseline = false
  const connect = (value: boolean) => {
    connected = value
    if (!value) baseline = false
  }
  const deliver = (fromCache: boolean): boolean | null => {
    if (!synced && fromCache) return null
    const live = !fromCache && connected && baseline
    synced = true
    if (!fromCache) baseline = true
    return live
  }
  return { connect, deliver }
}
