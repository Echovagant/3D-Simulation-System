#!/usr/bin/env node
/**
 * MCP server 冒烟测试（线性版）：spawn 服务器 → 顺序发 initialize /
 * initialized / tools/list / tools/call → 按请求 id 从 stdout 收集响应断言。
 *
 * 后端需在 8021 运行（health 与 list_scenes 走真实后端）。
 * 用法：node scripts/mcp-server.smoke.mjs（exit 0 = 通过）
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 中文路径必须走 fileURLToPath：URL.pathname 会把路径百分号编码，Windows 下解析不到
const SERVER = fileURLToPath(new URL('./mcp-server.mjs', import.meta.url))

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
const serverErrors = []
child.stderr.on('data', (d) => serverErrors.push(String(d).slice(0, 300)))

const lines = []
let buf = ''
child.stdout.on('data', (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 1)
    if (!line) continue
    try {
      lines.push(JSON.parse(line))
    } catch {
      // 半行数据
    }
  }
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const write = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`)
const byId = (reqId) => lines.find((m) => m.id === reqId)

const failures = []
const assert = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
  if (!cond) failures.push(label)
}

// 1. initialize 握手
write({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.0.0' },
  },
})
await wait(300)
const init = byId(1)
assert(init?.result?.serverInfo?.name === '3d-simulation-system', 'initialize 返回 serverInfo')
assert(!!init?.result?.protocolVersion, 'initialize 返回 protocolVersion')
assert(!!init?.result?.capabilities?.tools, 'initialize 声明 tools 能力')

// 2. initialized 通知（无 id，不回包）
write({ jsonrpc: '2.0', method: 'notifications/initialized' })

// 3. tools/list
write({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
await wait(300)
const tools = byId(2)
const names = (tools?.result?.tools ?? []).map((t) => t.name)
assert(
  names.length === 7,
  `tools/list 返回 7 个工具（实际 ${names.length}：${names.join(',')}）`,
)
assert(
  names.includes('start_simulation') && names.includes('get_simulation_results'),
  '仿真闭环工具在列',
)

// 4. tools/call health（后端 8021）
write({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'health', arguments: {} } })
await wait(500)
const health = byId(3)
const healthText = health?.result?.content?.[0]?.text ?? ''
assert(
  health.result && !health.result.isError && healthText.includes('"status"'),
  `health 经 MCP 返回后端状态（${healthText.slice(0, 60)}）`,
)

// 5. tools/call list_scenes（后端 8021）
write({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_scenes', arguments: {} } })
await wait(500)
const scenes = byId(4)
const scenesText = scenes?.result?.content?.[0]?.text ?? ''
assert(
  scenes.result && !scenes.result.isError && (scenesText.startsWith('[') || scenesText.startsWith('{')),
  `list_scenes 经 MCP 返回 JSON（${scenesText.slice(0, 60)}）`,
)

// 6. 未知工具 → isError（不炸进程）
write({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } })
await wait(300)
const bad = byId(5)
assert(bad?.result?.isError === true, '未知工具返回 isError')

child.kill()
if (serverErrors.length) console.log('server stderr:', serverErrors.join('\n'))
process.exit(failures.length === 0 ? 0 : 1)
