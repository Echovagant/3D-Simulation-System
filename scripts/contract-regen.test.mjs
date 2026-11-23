import assert from 'node:assert/strict'
import test from 'node:test'

import { isContractRelevant, needsContractRegen, normalizePath } from './check-contract-regen.mjs'

/**
 * 契约重生成闸门的纯判定测试。
 * 只测「哪些变更需要契约文档同步」，不碰 git 与后端。
 */

test('路径归一化：Windows 反斜杠与 ./ 前缀', () => {
  assert.equal(normalizePath('.\\backend\\app\\main.py'), 'backend/app/main.py')
  assert.equal(normalizePath('./backend/app/schemas.py'), 'backend/app/schemas.py')
})

test('路由 / schema / main 都算契约相关', () => {
  assert.equal(isContractRelevant('backend/app/routers/gym.py'), true)
  assert.equal(isContractRelevant('backend/app/routers/nested/x.py'), true)
  assert.equal(isContractRelevant('backend/app/schemas.py'), true)
  assert.equal(isContractRelevant('backend/app/main.py'), true)
})

test('普通 service / 测试 / 前端文件不算契约相关', () => {
  assert.equal(isContractRelevant('backend/app/services/gym_service.py'), false)
  assert.equal(isContractRelevant('backend/tests/test_gym.py'), false)
  assert.equal(isContractRelevant('src/services/api/gym.ts'), false)
})

test('改了路由但没改契约文档 → 必须重生成', () => {
  const verdict = needsContractRegen(['backend/app/routers/gym.py'])
  assert.equal(verdict.required, true)
  assert.deepEqual(verdict.backendChanged, ['backend/app/routers/gym.py'])
})

test('改了 schema 且契约文档同步 → 放行', () => {
  const verdict = needsContractRegen([
    'backend/app/schemas.py',
    'docs/api-contract.md',
  ])
  assert.equal(verdict.required, false)
  assert.equal(verdict.docChanged, true)
})

test('只改前端 / service → 不要求契约变更', () => {
  assert.equal(needsContractRegen(['src/views/Foo.vue']).required, false)
  assert.equal(needsContractRegen(['backend/app/services/simulator.py']).required, false)
})

test('main 改了也算（应用装配会影响 openapi）', () => {
  assert.equal(needsContractRegen(['backend/app/main.py']).required, true)
})
