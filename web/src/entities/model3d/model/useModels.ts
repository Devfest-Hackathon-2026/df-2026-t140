import { useEffect, useRef, useState } from 'react'
import { useSession } from '@/shared/api'
import { getStoredModel } from '../api/model'
import { FALLBACK_MODEL } from '../lib/fallbackModel'
import { parseModelJson } from '../lib/parseModelJson'
import type { ModelJson } from './types'
import { type ModelReference, readReference } from './reference'

export type { ModelReference }

/** 読み終えて、検査を通った模型 */
export interface LoadedModel {
  json: ModelJson
  /** parts：用意した部品。argon：Gemini が作った。fallback：読めなかったので、代わりの模型を出している */
  source: 'parts' | 'argon' | 'fallback'
  /** 見た目の参考にした説明の出典。画面に出す（CC BY-SA の表示） */
  reference?: ModelReference
}

const NONE: Record<string, LoadedModel> = {}
const FALLBACK: LoadedModel = { json: FALLBACK_MODEL, source: 'fallback' }

/**
 * 建物（完成したピン）の模型。ピンの ID → 検査済みの模型の JSON と、その出どころ。
 * pinIds に足されたピンの模型を、1 回ずつ読む。読めなかった、形が決めたとおりでなかったときは、
 * 代わりの模型（lib/fallbackModel.ts）にする（建物が出ないままにしない）。
 */
export function useModels(tripId: string, pinIds: readonly string[]): Record<string, LoadedModel> {
  const session = useSession()
  const scope = `${session.uid}/${tripId}`
  const [loaded, setLoaded] = useState<{ scope: string; models: Record<string, LoadedModel> }>({ scope, models: NONE })
  const requested = useRef<{ scope: string; ids: Set<string> }>({ scope, ids: new Set() })

  const key = pinIds.join(',')
  useEffect(() => {
    if (requested.current.scope !== scope) requested.current = { scope, ids: new Set() }
    const ids = key ? key.split(',') : []
    for (const pinId of ids) {
      if (requested.current.ids.has(pinId)) continue
      requested.current.ids.add(pinId)
      getStoredModel(session, tripId, pinId)
        .then((stored): LoadedModel => {
          const json = parseModelJson(stored?.json)
          if (!json || !stored) return FALLBACK
          const source = stored.source === 'argon' ? 'argon' : 'parts'
          const reference = source === 'argon' ? readReference(stored.reference) : undefined
          return reference ? { json, source, reference } : { json, source }
        })
        .catch(() => FALLBACK)
        .then((model) =>
          setLoaded((current) => ({
            scope,
            models: { ...(current.scope === scope ? current.models : NONE), [pinId]: model },
          })),
        )
    }
  }, [session, tripId, scope, key])

  return loaded.scope === scope ? loaded.models : NONE
}
