/** 招待 URL。旅の画面の URL と同じで、メンバーでない人が開くと参加の画面になる */
export function inviteUrl(tripId: string): string {
  return `${location.origin}/t/${tripId}`
}
