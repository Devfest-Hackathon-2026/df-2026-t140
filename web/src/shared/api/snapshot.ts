import {
  type DocumentSnapshot,
  type DocumentReference,
  onSnapshot,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from 'firebase/firestore'
import { snapshotDelivery } from '../lib/snapshotDelivery'

/** ドキュメントの ID を付けた形 */
export type WithId<T> = T & { id: string }

/**
 * スナップショットを、ID 付きのデータにする。
 * 自分が書いた直後は serverTimestamp() がまだ決まっていないので、端末の時刻で仮に埋める。
 */
export function withId<T>(snapshot: QueryDocumentSnapshot | DocumentSnapshot): WithId<T> {
  return { id: snapshot.id, ...(snapshot.data({ serverTimestamps: 'estimate' }) as T) }
}

/**
 * 一覧（コレクションや問い合わせ）を読み、変わるたびに届ける。onSnapshot の代わりに使う。
 *
 * サーバーの答えが届くまでの「手元にある分だけ」の結果は飛ばす。ほかの問い合わせで読んだドキュメントが
 * 手元にあると、最初に一部だけが届き、あとから残りが届く。そのまま使うと、前からいた人やピンを
 * 「いま増えた」と見まちがえる（参加のお知らせなど）。
 * 一度サーバーとそろったあとは、電波が切れている間の手元の変更も届ける。
 * liveは、接続中の新しい変更だけtrue。初回・キャッシュ・再接続の同期はfalseで届ける。
 */
export function subscribeQuery(
  target: Query,
  onData: (snapshot: QuerySnapshot, live: boolean) => void,
  onError: (error: Error) => void,
  connection?: DocumentReference,
): () => void {
  const delivery = snapshotDelivery()
  // 一覧は削除の確認中にもfromCacheになるため、通信断の判定には親の文書を使う。
  // 同じ文書の購読はFirestore SDKが共有する。
  const stopConnection = connection
    ? onSnapshot(connection, { includeMetadataChanges: true },
        (snapshot) => delivery.connect(!snapshot.metadata.fromCache),
        () => delivery.connect(false))
    : undefined
  if (!connection) delivery.connect(true)
  // 手元の分とサーバーの答えが同じ中身のとき、「サーバーとそろった」という変化だけが届く。
  // それを受け取るために includeMetadataChanges が要る（ないと、いつまでも届かない）
  const stopQuery = onSnapshot(
    target,
    { includeMetadataChanges: true },
    (snapshot) => {
      const live = delivery.deliver(snapshot.metadata.fromCache)
      if (live === null) return
      onData(snapshot, live)
    },
    onError,
  )
  return () => { stopQuery(); stopConnection?.() }
}
