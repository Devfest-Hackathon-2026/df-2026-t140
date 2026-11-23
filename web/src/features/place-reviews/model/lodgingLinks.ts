// 宿の場所の情報に出す、外のサイトへのリンクの決め。React と Firebase に依存しない（node のテストから読む）

/**
 * Booking.com で宿の名前（とあたりの地名）を検索する URL（#705）。
 * API もキーも使わない、ただのリンク（費用 0、契約も要らない）。名前は Gemini が書いたピンの名前で、Google マップの内容ではない。
 * 料金と空室は、開いたページで確かめてもらう（アプリでは料金を出さない）
 */
export function bookingSearchUrl(name: string, area: string | null | undefined): string {
  const query = area ? `${name} ${area}` : name
  return `https://www.booking.com/searchresults.ja.html?ss=${encodeURIComponent(query)}`
}
