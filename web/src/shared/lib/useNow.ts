import { useEffect, useState } from 'react'

/** いまの時刻。intervalMs ごとに新しくなる（「3分前」のような表示を進めるため） */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
