import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { CollectionPage } from '@/pages/collection'
import { CollectionMapPage } from '@/pages/collection-map'
import { FinalShioriPage } from '@/pages/final-shiori'
import { MenuPage } from '@/pages/menu'
import { NotFoundPage } from '@/pages/not-found'
import { TripCreatePage } from '@/pages/trip-create'
import { TripGatePage } from '@/pages/trip-gate'
import { TripMapPage } from '@/pages/trip-map'

// 画面と URL の対応。
//   /                      ホーム（M01）：旅の一覧、旅の切り替え
//   /collection            コレクション：過去の旅で建てた建物を、旅ごとに並べる（企画書「ユーザー体験」4-2）
//   /collection/map        日本コレクション：過去のすべての旅の建物を、日本全体の地図に並べる（同 4-3）
//   /new                   旅をつくる（S01）
//   /t/:tripId             旅の地図（S02 以降）。この URL がそのまま招待 URL。メンバーでなければ参加の画面になる
//   /t/:tripId?view=shiori しおり（S11〜S13）。同じ地図の上で、左上のルートボタンで切り替える（&place=ピンの ID で場所の情報）
//   /t/:tripId/final       決まったしおり（S14）。発案者が旅程を確定した旅のしおりを、地図なしで画面いっぱいに出す別の画面
//                          （2026-11-18 の #393 の画面を、2026-11-21 に戻した。#502）。ホームの「決まったしおり」から開く
//
// 前の URL は、いまの画面へ送る：/t/:tripId?view=shiori&book=1（2026-11-20〜21 の、シートを広げたしおりビュー）は TripMapPage が決まったしおりへ送る。
// 前の形（ルート案と投票）の URL は、しおりへ送る（2026-11-07 にルート案と投票をやめた）。
// 旅の中の画面を足すときは、TripGatePage の下に並べる。
// そうすると、メンバーかどうかの確認と参加の画面が、どの画面にも効く。
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MenuPage />} />
        <Route path="/collection" element={<CollectionPage />} />
        <Route path="/collection/map" element={<CollectionMapPage />} />
        <Route path="/new" element={<TripCreatePage />} />
        <Route path="/t/:tripId" element={<TripGatePage />}>
          <Route index element={<TripMapPage />} />
          <Route path="final" element={<FinalShioriPage />} />
          <Route path="routes" element={<ToShiori />} />
          <Route path="shiori" element={<ToShiori />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

/** 前の形のルート案・しおりの URL を、地図の上のしおりへ送る */
function ToShiori() {
  const { tripId = '' } = useParams()
  return <Navigate to={`/t/${tripId}?view=shiori`} replace />
}
