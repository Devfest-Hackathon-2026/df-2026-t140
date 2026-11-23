import { useEffect, useRef } from 'react'
import { playSound } from '@/shared/lib'
import type { TutorialSlide } from '../config/slides'

/** 動画のない 1 枚（コードで描く場面）を見せる長さ（ミリ秒） */
export const SCENE_MS = 8000

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

interface Options {
  /** 最後の 1 枚か。最後の 1 枚は動画を繰り返し、自動では次へ進まない */
  isLast: boolean
  /** 1 周し終えたとき（最後の 1 枚以外）。次の 1 枚へ進める */
  onEnd: () => void
}

/**
 * いまの 1 枚を流し、上の棒をその進み具合に合わせて伸ばす（インスタのストーリーのように、1 周したら次へ進む）。
 * 返した videoRef を video に、barRef をいまの 1 枚の棒の中身に付ける（どちらも 1 枚ごとに作り直す）。
 * - 動画は 1 周の長さ、コードで描く場面は SCENE_MS で棒が伸び切る。最後の 1 枚は繰り返し、棒は伸び切ったまま止まる
 * - 決めた秒数（cue）で効果音を鳴らす。その 1 枚を初めて見たときだけ（戻ってきたときや 2 周目では鳴らさない）
 * - 流せないとき（省電力の設定など）は棒が進まず、最初の 1 コマのまま、タップを待つ
 * - 動きを減らす設定では流さず、自動で進めない。動画は最後の 1 コマ（伝えたい状態がそろう 1 コマ）で止め、棒は伸び切った形にする
 */
export function useSlidePlayback(slide: TutorialSlide, { isLast, onEnd }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const barRef = useRef<HTMLSpanElement>(null)
  /** 音を鳴らし終えた 1 枚 */
  const sounded = useRef(new Set<string>())
  // 進めたあとに渡し直される関数でも、いつも新しいほうを呼ぶ
  const endRef = useRef(onEnd)
  useEffect(() => {
    endRef.current = onEnd
  }, [onEnd])

  useEffect(() => {
    const video = videoRef.current
    const bar = barRef.current
    const fill = (ratio: number) => {
      if (bar) bar.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`
    }
    fill(0)

    if (reducedMotion()) {
      fill(1)
      if (!video) return
      const toLast = () => {
        video.currentTime = Math.max(0, video.duration - 0.05)
      }
      video.pause()
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) toLast()
      else video.addEventListener('loadedmetadata', toLast, { once: true })
      return () => video.removeEventListener('loadedmetadata', toLast)
    }

    const loop = { frame: 0, stopped: false, ended: false }
    const cue = slide.cue
    const finish = () => {
      if (loop.ended) return
      loop.ended = true
      fill(1)
      if (!isLast) endRef.current()
    }

    // コードで描く場面：時間で棒を伸ばす
    if (!video) {
      const start = performance.now()
      const tick = (now: number) => {
        if (loop.stopped) return
        const ratio = (now - start) / SCENE_MS
        if (ratio >= 1) return finish()
        fill(ratio)
        loop.frame = requestAnimationFrame(tick)
      }
      loop.frame = requestAnimationFrame(tick)
      return () => {
        loop.stopped = true
        cancelAnimationFrame(loop.frame)
      }
    }

    // 動画：再生の位置で棒を伸ばし、音を鳴らす。最後の 1 枚は繰り返すので、位置が先頭へ戻ったら 1 周とみなす
    const last = { time: 0 }
    const tick = () => {
      if (loop.stopped) return
      const { currentTime, duration } = video
      if (cue && !sounded.current.has(slide.id) && currentTime >= cue.at) {
        sounded.current.add(slide.id)
        playSound(cue.sound)
      }
      if (currentTime + 0.2 < last.time) finish()
      last.time = currentTime
      if (!loop.ended && duration > 0) fill(currentTime / duration)
      loop.frame = requestAnimationFrame(tick)
    }
    video.addEventListener('ended', finish)
    video
      .play()
      .then(() => {
        loop.frame = requestAnimationFrame(tick)
      })
      .catch(() => undefined)
    return () => {
      loop.stopped = true
      cancelAnimationFrame(loop.frame)
      video.removeEventListener('ended', finish)
    }
  }, [slide, isLast])

  return { videoRef, barRef }
}
