import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateReview, validateReview } from './review.mjs'

/**
 * 评审状态机的纯判定测试。
 * 只测「记录是否合法」「记录与 HEAD 的关系」，不读写真实 review.json。
 */

const okReview = {
  version: 1,
  approvedCommit: '7af11e4',
  approvedAt: '2026-11-23T13:00:00.000Z',
  branch: 'redesign/ui-overhaul',
}

test('没有记录 → missing（跳过，不拦）', () => {
  assert.deepEqual(evaluateReview(null, '7af11e4'), { status: 'missing' })
})

test('approvedCommit 与 HEAD 相同 → current', () => {
  assert.deepEqual(evaluateReview(okReview, '7af11e4'), { status: 'current' })
})

test('HEAD 前进 → stale（默认只提醒）', () => {
  assert.deepEqual(evaluateReview(okReview, 'abcdef0'), { status: 'stale' })
})

test('schema：合法记录通过', () => {
  assert.deepEqual(validateReview(okReview), [])
})

test('schema：缺字段 / 非法提交号 / 坏时间', () => {
  const errors = validateReview({
    version: 2,
    approvedCommit: 'NOT-A-COMMIT!',
    approvedAt: 'not-a-time',
    branch: '',
  })
  assert.ok(errors.some((item) => item.includes('version')))
  assert.ok(errors.some((item) => item.includes('approvedCommit')))
  assert.ok(errors.some((item) => item.includes('approvedAt')))
  assert.ok(errors.some((item) => item.includes('branch')))
})
