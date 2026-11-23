// 時刻（HH:MM）と、数字だけで打つ時刻の入力（shared/ui の TimeField）の決め。画面がなくても意味があるので、ui から分けて置く

const pad = (value: number) => String(value).padStart(2, '0')

/** 「09:30」を 0 時からの分にする。形が違えば null */
export function clockMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** 0 時からの分を「09:30」にする。1 日の外は、1 日の中に折り返す */
export function clockLabel(minutes: number): string {
  const value = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`
}

/**
 * 「HH:MM」の時刻から minutes 分あとの時刻（HH:MM）。0 時をまたいだら、次の日の時刻に折り返す。
 * 時刻として読めないとき、足す分が 0 以下のときは null
 */
export function clockAfter(time: string, minutes: number): string | null {
  const from = clockMinutes(time)
  if (from === null || !(minutes > 0)) return null
  return clockLabel(from + minutes)
}

/**
 * 時刻の入力に数字を 1 つ足す（24 時間制、4 けたで HH:MM）。時刻にならない数字は受け付けず、今のままを返す。
 * 1 けた目が 3〜9 なら、時の 1 けた目に 0 を補う（「9」で 09 時）
 */
export function pushClockDigit(digits: string, digit: string): string {
  if (!/^\d$/.test(digit) || digits.length >= 4) return digits
  const value = Number(digit)
  if (digits.length === 0) return value >= 3 ? `0${digit}` : digit
  if (digits.length === 1) return digits === '2' && value > 3 ? digits : digits + digit
  if (digits.length === 2) return value > 5 ? digits : digits + digit
  return digits + digit
}

/**
 * 入力欄の文字（「09:3」など、コロンの入ったもの）が変わったときの、新しい数字の並び。
 * 足した数字は 1 つずつ確かめる。消したときは、消した分だけ減らす（コロンだけを消したときは、その前の数字を消す）
 */
export function nextClockDigits(digits: string, raw: string): string {
  const typed = raw.replace(/\D/g, '')
  if (typed === digits) return raw.length < formatClockDigits(digits).length ? digits.slice(0, -1) : digits
  const base = typed.startsWith(digits) ? digits : ''
  return [...typed.slice(base.length)].reduce(pushClockDigit, base)
}

/** 入力欄に出す形。3 けた目からコロンを入れる（「093」は「09:3」） */
export function formatClockDigits(digits: string): string {
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits
}

/**
 * 打った数字を 0 時からの分にする。4 けたは HH:MM、1〜2 けたは HH 時ちょうど、3 けたは HH 時 M0 分（「093」は 9 時 30 分）。
 * 何も打っていなければ null
 */
export function clockFromDigits(digits: string): number | null {
  if (!/^\d{1,4}$/.test(digits)) return null
  const hours = Number(digits.slice(0, 2))
  const minutes = Number(digits.slice(2).padEnd(2, '0') || '0')
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}
