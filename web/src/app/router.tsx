import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router'
import { MenuPage } from '@/pages/menu'
import { NotFoundPage } from '@/pages/not-found'
import { TripCreatePage } from '@/pages/trip-create'
import { TripGatePage } from '@/pages/trip-gate'
import { TripMapPage } from '@/pages/trip-map'

// 画面と URL の対応。
//   /                      ホーム（M01）：旅の一覧、旅の切り替え
//   /new                   旅をつくる（S01）
//   /t/:tripId             旅の地図（S02 以降）。この URL がそのまま招待 URL。メンバーでなければ参加の画面になる
//   /t/:tripId?view=shiori しおり（S11〜S13）。同じ地図の上で、左上のルートボタンで切り替える（&place=ピンの ID で場所の情報）
//
// 前の形（ルート案と投票）の URL は、しおりへ送る（2026-11-07 にルート案と投票をやめた）。
// 旅の中の画面を足すときは、TripGatePage の下に並べる。
// そうすると、メンバーかどうかの確認と参加の画面が、どの画面にも効く。
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MenuPage />} />
        <Route path="/new" element={<TripCreatePage />} />
        <Route path="/t/:tripId" element={<TripGatePage />}>
          <Route index element={<TripMapPage />} />
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
