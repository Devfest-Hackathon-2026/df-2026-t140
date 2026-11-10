// Emulator に開発用の初期データを入れる。本番には使わない。
//
// 見本の旅を 1 つ置く。http://localhost:5173/t/demo-shinshu を開いて名前を入れると、
// 2 人（あき、みお）がもう参加している旅に入れる。人名と地名は画面のイメージ用の仮のもの。
const PROJECT_ID = 'konbu-devfest-hackathon-2026'
const BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`
const TRIP_ID = 'demo-shinshu'

async function waitForFirestore() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await fetch('http://127.0.0.1:8080/')
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  throw new Error('Firestore Emulator が起動しませんでした')
}

const text = (value) => ({ stringValue: value })
const time = (offsetMs = 0) => ({ timestampValue: new Date(Date.now() + offsetMs).toISOString() })
const none = { nullValue: null }

// Emulator では「Bearer owner」が管理者の扱いになり、ルールを通らずに書ける
async function put(path, fields) {
  const response = await fetch(`${BASE}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!response.ok) throw new Error(`初期データを入れられませんでした（${path}：${response.status}）`)
}

await waitForFirestore()

await put(`trips/${TRIP_ID}`, {
  title: text('秋の信州ふらり旅'),
  startDate: text('2026-11-21'),
  endDate: text('2026-11-22'),
  origin: text('東京駅'),
  status: text('planning'),
  decidedRouteId: none,
  createdBy: text('seed-aki'),
  createdAt: time(),
  updatedAt: time(),
})

const members = [
  { uid: 'seed-aki', displayName: 'あき', color: '#3d4a8f' },
  { uid: 'seed-mio', displayName: 'みお', color: '#c9571e' },
]
for (const [index, member] of members.entries()) {
  await put(`trips/${TRIP_ID}/members/${member.uid}`, {
    uid: text(member.uid),
    displayName: text(member.displayName),
    color: text(member.color),
    votedRouteId: none,
    joinedAt: time(index),
  })
}

console.log(`初期データを入れました（見本の旅：http://localhost:5173/t/${TRIP_ID}）`)
