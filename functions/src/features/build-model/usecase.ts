import { FieldValue } from 'firebase-admin/firestore'
import { decideAiGate, gateCandidates } from '../../domain/geminiBudget'
import type { PinModel } from '../../domain/model3d'
import type { Pin } from '../../domain/pin'
import type { Wish } from '../../domain/wish'
import type { GeminiPermit } from '../../ports/gemini'
import { chooseModel, shouldStartBuild } from './logic'
import type { BuildModelPorts } from './ports'
import { buildModelTask } from './prompt'
import { libraryEntry, modelKey, readLibraryEntry, type ReusableModel } from './logic/library'

/**
 * 建物辞書（logic/prebuilt.ts、ビルド後で約 5.5MB）を、使うときにだけ読み込む。
 * Cloud Functions はどの関数のインスタンスも index 全体を読み込むので、ここで静的に import すると、
 * 合言葉の関数（unlockAi）なども起動時に辞書を読み込み、既定の 256MiB を超えて落ちる（2026-11-23 の本番の障害）。
 * 動的 import は CJS の出力でも import() のまま残り、最初に呼んだときに 1 回だけ読み込まれる。
 */
async function prebuiltModels() {
  const { PREBUILT_MODELS } = await import('./logic/prebuilt.js')
  return PREBUILT_MODELS
}

export interface BuildModelOptions {
  /**
   * 今の Gemini の経路に費用がかかる（vertex）か。true なら、呼ぶ前に関所（aiGate）を通し、
   * 通ったときだけ印（GeminiPermit）を付ける。false（stub、agy）なら関所は見ない
   */
  guarded: boolean
  /**
   * 本物の Gemini（stub 以外）で作るか。true のときだけ、名前の参考の説明を引く（固定の応答では使わないので呼ばない）
   */
  lookUp?: boolean
  /** 部品の見本を使ってよいか。handlerはEmulatorのときだけtrueにする。 */
  allowParts?: boolean
  /**
   * 本番の確認テストの旅（isSmokeTrip）か。true なら、本物の生成ができなくても失敗にせず、部品の模型で「完成」にする。
   * ほかの旅は allowParts、lookUp、guarded の判断のまま
   */
  smokeTrip?: boolean
}

/**
 * 「工事中」のピンの模型を作り、保存して「完成」にする。読む → logic で決める → 書く。
 *
 * 同じイベントが 2 回届いても、1 回だけ作る：
 * - 最初にトランザクションで、「工事中」で、まだ誰も引き受けていない（buildStartedAt が null）ことを確かめ、
 *   引き受けた時刻を書く。2 回目は、もう時刻が入っているので何もしない
 * - 模型の保存と「完成」は、1 回の書き込みにまとめる
 *
 * 本番で生成に失敗したときは「失敗」にする（画面からもう一度建てられる）。部品の見本はEmulatorと本番の確認テストの旅と、
 * 費用のかかる経路で印が付かなかったとき（本物を呼べないとき。#728）に使う。
 * 生成する前に辞書を調べ、妥当な生成済み模型があれば、出典と一緒にコピーする。
 *
 * 模型の入力は、場所の名前、説明、希望の文と、名前で引いた百科事典の説明（Knowledge Graph、あれば）だけ。
 * ピンの placeId と位置（Maps 由来）は使わない。
 *
 * 費用：経路が vertex のときは、建てた人（builtBy）か希望を書いた人（pin.uid）が合言葉を通していて（aiAccess/{uid}）、
 * Argon が 1 日の上限と累計の上限の中（usage/argon）のときだけ印を付ける。印がなければ呼び出し口が
 * 固定の応答（部品の模型）に戻す（design-principles の cost/gemini-guarded）
 */
export async function buildModelForPin(
  ports: BuildModelPorts,
  tripId: string,
  pinId: string,
  options: BuildModelOptions = { guarded: false },
): Promise<void> {
  const { db, gemini } = ports
  const trip = db.collection('trips').doc(tripId)
  const pinRef = trip.collection('pins').doc(pinId)

  const pin = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(pinRef)
    const data = snapshot.data() as Pin | undefined
    if (!shouldStartBuild(data)) return null
    tx.update(pinRef, { buildStartedAt: FieldValue.serverTimestamp() })
    return data as Pin
  })
  if (!pin) return

  try {
    const key = modelKey(pin)
    const cacheRef = key ? db.collection('modelCache').doc(key) : null
    let cached: ReusableModel | null = null
    if (cacheRef) {
      try { cached = readLibraryEntry((await cacheRef.get()).data(), pin) }
      catch (cause) { console.warn('建物辞書を読めなかったので通常の生成に進みます', cause) }
    }
    cached ??= (await prebuiltModels()).map((entry) => readLibraryEntry(entry, pin)).find((entry) => entry !== null) ?? null
    if (cached) {
      if (ports.stubDelayMs > 0) await ports.wait(ports.stubDelayMs)
      const batch = db.batch()
      batch.set(pinRef.collection('model').doc('current'), { ...cached, createdAt: FieldValue.serverTimestamp() })
      batch.update(pinRef, { status: 'done', updatedAt: FieldValue.serverTimestamp() })
      await batch.commit()
      return
    }
    const wish = (await trip.collection('wishes').doc(pin.wishId).get()).data() as Wish | undefined
    const permit = options.guarded ? await modelPermit(ports, [pin.builtBy, pin.uid], pinId) : undefined
    // 本物の Gemini で作るときだけ、名前の参考の説明を引く（費用のかかる経路なら、印が付いたときだけ）
    const willUseGemini = options.lookUp === true && (!options.guarded || permit !== undefined)
    const reference = willUseGemini && ports.knowledgeGraph?.enabled() ? await ports.knowledgeGraph.describe(pin.name) : null
    const result = await gemini.run(
      buildModelTask,
      {
        name: pin.name,
        description: pin.description,
        wishText: wish?.text ?? '',
        category: pin.category,
        ...(reference ? { reference: reference.text } : {}),
      },
      { permit },
    )
    const model = chooseModel(result, pin.category)
    // 本物の生成に失敗したとき、汎用の部品模型を生成の成功として表示しない。
    // ただし、費用のかかる経路で印が付かなかった（合言葉を通した人がいない、Argon の上限を使い切った）ときは、本物を呼んでいないので
    // 部品の模型で完成にする。場所の情報に「用意した部品の模型です」と出る（企画書。#728。何度押しても失敗する状態を作らない）
    const notCalled = options.guarded === true && permit === undefined
    if (options.smokeTrip !== true && !notCalled && (options.allowParts === false || options.lookUp || options.guarded) && (model.source !== 'argon' || result.fellBack)) throw new Error('模型を生成できませんでした')

    // 固定の応答はすぐ返るので、全員の画面に「工事中」が見えるよう少し待つ（本物の生成は約 2 分かかる）
    if (result.provider === 'stub' && ports.stubDelayMs > 0) await ports.wait(ports.stubDelayMs)

    // 参考の説明を使って Gemini が作った模型には、説明と出典（記事とライセンス）を残す。場所の情報に出す（CC BY-SA の表示）
    const stored: Omit<PinModel, 'createdAt'> = {
      json: model.json,
      source: model.source,
      ...(reference && model.source === 'argon' ? { reference: { text: reference.text, url: reference.url, license: reference.license } } : {}),
    }
    const batch = db.batch()
    batch.set(pinRef.collection('model').doc('current'), { ...stored, createdAt: FieldValue.serverTimestamp() })
    batch.update(pinRef, { status: 'done', updatedAt: FieldValue.serverTimestamp() })
    await batch.commit()
    const entry = libraryEntry(pin, stored)
    if (cacheRef && entry) {
      try { await cacheRef.set({ ...entry, createdAt: FieldValue.serverTimestamp() }) }
      catch (cause) { console.warn('完成した模型を辞書に保存できませんでした', cause) }
    }
  } catch (cause) {
    console.error(`ピン ${tripId}/${pinId} の模型を作れませんでした`, cause)
    await pinRef.update({ status: 'failed', updatedAt: FieldValue.serverTimestamp() })
  }
}

/** 関所を通す（テストのために export する）。合言葉を通した人がいなければ回数を消費しない（先に unlocked を見る） */
export async function modelPermit(
  ports: Pick<BuildModelPorts, 'aiGate'>,
  uids: readonly (string | null)[],
  pinId: string,
): Promise<GeminiPermit | undefined> {
  const gate = ports.aiGate
  const candidates = gateCandidates(uids)
  // 全員に開く切り替え（settings/ai）が入っていれば、合言葉は見ずに最初の人の名前で印を付ける
  let unlockedUid: string | undefined = (await gate.isOpenToAll()) ? candidates[0] : undefined
  for (const uid of unlockedUid ? [] : candidates) {
    if (await gate.isUnlocked(uid)) {
      unlockedUid = uid
      break
    }
  }
  const reserved = unlockedUid ? await gate.reserveArgonCall() : false
  const decision = decideAiGate({ unlocked: unlockedUid !== undefined, reserved })
  if (decision !== 'ok' || !unlockedUid) {
    console.info(`ピン ${pinId} の模型：本物の Gemini の生成を見送ります（${decision}）`)
    return undefined
  }
  return { uid: unlockedUid, refund: () => gate.refundArgonCall() }
}
