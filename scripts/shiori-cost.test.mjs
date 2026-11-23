import assert from 'node:assert/strict'
import { test } from 'node:test'
import { costLegPairs, estimateShioriCost } from '../web/src/features/shiori-cost/model/estimate.ts'

test('徒歩は無料で、日帰りの食費は昼食のみ', () => {
  assert.deepEqual(estimateShioriCost([{ mode: 'walk', km: null }], 0, 1), {
    transport: [0, 0], meals: [900, 1800], total: [900, 1800], missingLegs: 0, transportKnown: true,
  })
})

test('車は同乗者で割り、飛行機と電車・バスは人数で割らない', () => {
  const legs = [{ mode: 'car', km: 100 }, { mode: 'plane', km: 700 }, { mode: 'transit', km: 20 }]
  const solo = estimateShioriCost(legs, 1, 1)
  const group = estimateShioriCost(legs, 1, 4)
  assert.deepEqual(solo.meals, [3300, 6600])
  assert.deepEqual(group.meals, solo.meals)
  assert.ok(group.transport[0] < solo.transport[0])
  assert.ok(group.transport[1] < solo.transport[1])
  assert.deepEqual(group.total, [group.transport[0] + 3300, group.transport[1] + 6600])
  assert.deepEqual(estimateShioriCost(legs.slice(1), 0, 4), estimateShioriCost(legs.slice(1), 0, 1))
})

test('距離の不明な区間は記録し、既知の区間だけ足す', () => {
  const valid = { mode: 'transit', km: 20 }
  const baseline = estimateShioriCost([valid], 0, 2)
  const partial = estimateShioriCost([valid, { mode: 'car', km: null }, { mode: 'plane', km: NaN }], 0, 2)
  assert.deepEqual(partial, { ...baseline, missingLegs: 2 })
  assert.equal(estimateShioriCost([{ mode: 'transit', km: null }], 0, 2).transportKnown, false)
})

test('交通費の区間は、出発地から回って、最後の場所から出発地へ帰るまで（帰りも数える）', () => {
  assert.deepEqual(costLegPairs(['a', 'b'], '@origin'), [['@origin', 'a'], ['a', 'b'], ['b', '@origin']])
  assert.deepEqual(costLegPairs(['a'], '@origin'), [['@origin', 'a'], ['a', '@origin']])
  assert.deepEqual(costLegPairs([], '@origin'), [])
})

test('徒歩の区間は「計算できた区間」に数えない', () => {
  const result = estimateShioriCost([{ mode: 'walk', km: 1 }, { mode: 'car', km: null }], 0, 2)
  assert.equal(result.missingLegs, 1)
  assert.equal(result.transportKnown, false)
})
