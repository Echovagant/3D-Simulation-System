/**
 * sdd.mjs 的纯函数测试（node:test，`npm run verify:sdd` 先跑这里再跑 check）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateLedger, reconcileCommits } from './sdd.mjs'

const okLedger = {
  version: 1,
  plan: 'plan-demo',
  updatedAt: '2026-11-23T00:00:00+08:00',
  tasks: [
    { id: 'T1', title: '示例任务', status: 'done', commits: ['8360afb'] },
    { id: 'T2', title: '未开工', status: 'open', commits: [] },
  ],
  decisions: [{ id: 'C1', what: '示例裁决', date: '2026-11-21' }],
}

test('schema：合法 ledger 通过', () => {
  const r = validateLedger(okLedger)
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
})

test('schema：version 非法 / 缺 plan / updatedAt 坏时间', () => {
  const r = validateLedger({ ...okLedger, version: 2, plan: '', updatedAt: 'not-a-time' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('version')))
  assert.ok(r.errors.some((e) => e.includes('plan')))
  assert.ok(r.errors.some((e) => e.includes('updatedAt')))
})

test('schema：done 但 commits 为空 → 红', () => {
  const r = validateLedger({
    ...okLedger,
    tasks: [{ id: 'T1', title: 'x', status: 'done', commits: [] }],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('done 但没有任何提交号')))
})

test('schema：非法状态与非法哈希格式', () => {
  const r = validateLedger({
    ...okLedger,
    tasks: [
      { id: 'T1', title: 'x', status: 'finished', commits: ['NOTAHASH!'] },
      { id: 'T1', title: 'x', status: 'done', commits: [] },
    ],
  })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('非法状态')))
  assert.ok(r.errors.some((e) => e.includes('非法提交号')))
  assert.ok(r.errors.some((e) => e.includes('id 重复')))
})

test('schema：非对象与 tasks 缺失', () => {
  assert.equal(validateLedger(null).ok, false)
  const r = validateLedger({ version: 1, plan: 'p', updatedAt: '2026-11-23T00:00:00+08:00' })
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('tasks')))
})

test('对账：存在的提交绿、不存在的红（注入 runner，不依赖真 git）', () => {
  const ok = reconcileCommits([{ id: 'T1', commits: ['8360afb'] }], (cmd) => {
    if (cmd.includes('8360afb')) return '8360afb'
    throw new Error('not found')
  })
  assert.equal(ok.ok, true)
  const bad = reconcileCommits([{ id: 'T1', commits: ['deadbee'] }], () => {
    throw new Error('not found')
  })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors[0].includes('T1'))
  assert.ok(bad.errors[0].includes('deadbee'))
})
