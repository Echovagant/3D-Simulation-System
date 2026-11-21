#!/usr/bin/env node
/**
 * 3D-Simulation-System 的 MCP（Model Context Protocol）服务器。
 *
 * 把后端 REST 契约暴露成 MCP 工具，供 Claude Desktop / Cursor 等
 * MCP 客户端直接操作：查场景、建仿真、取结果——不进编辑器也能驱动整条仿真链路。
 *
 * 零依赖：MCP stdio 传输就是「按行分隔的 JSON-RPC 2.0」，手工实现收发，
 * 不引入 @modelcontextprotocol/sdk（与仓库零依赖脚本风格一致）。
 *
 * 启动：node scripts/mcp-server.mjs（后端地址用 SIM_BACKEND_URL 覆盖，默认 8021）
 *
 * 客户端注册示例（Cursor / Claude Desktop 的 mcpServers 配置）：
 *   {
 *     "mcpServers": {
 *       "3d-simulation-system": {
 *         "command": "node",
 *         "args": ["<仓库路径>/scripts/mcp-server.mjs"]
 *       }
 *     }
 *   }
 *
 * 工具面（v1，全部只读或幂等，不含删除）：
 *   health / list_scenes / get_scene / list_simulations /
 *   start_simulation / get_simulation / get_simulation_results
 */
import { createInterface } from 'node:readline'

const BACKEND_URL = (process.env.SIM_BACKEND_URL || 'http://127.0.0.1:8021').replace(/\/$/, '')

const SERVER_INFO = { name: '3d-simulation-system', version: '0.1.0' }

// ─────────────────────────── 后端 REST 代理 ───────────────────────────

const backendFetch = async (path, init = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: controller.signal,
    })
    const text = await res.text()
    let body = text
    try {
      body = JSON.parse(text)
    } catch {
      // 非 JSON 响应原样带回（后端错误页可能是纯文本）
    }
    if (!res.ok) {
      const detail =
        body && typeof body === 'object' && 'error' in body
          ? JSON.stringify(body.error)
          : String(text).slice(0, 300)
      return { ok: false, status: res.status, error: detail }
    }
    return { ok: true, status: res.status, data: body }
  } catch (error) {
    return { ok: false, status: 0, error: `后端不可达（${BACKEND_URL}）：${error.message}` }
  } finally {
    clearTimeout(timer)
  }
}

// ─────────────────────────── 工具定义 ───────────────────────────

const sceneDocSchema = {
  type: 'object',
  description: '场景文档（SceneDocument：{ id, name, objects: [...] }）',
}

const TOOLS = [
  {
    name: 'health',
    description: '后端健康检查（version / status）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_scenes',
    description: '列出场景编辑器保存的全部场景（id / 名称 / 物体数）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_scene',
    description: '按 id 读取一个完整场景文档（objects 含几何、变换与物理参数）',
    inputSchema: {
      type: 'object',
      properties: { scene_id: { type: 'string', description: '场景 id' } },
      required: ['scene_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_simulations',
    description: '列出最近的批量仿真任务（状态与时间）',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'start_simulation',
    description:
      '提交一次批量仿真：传场景文档与物理参数（步数/步长/重力/摩擦/弹性），' +
      '可选 sweep 参数扫描。返回 job id，用 get_simulation 轮询状态、get_simulation_results 取结果',
    inputSchema: {
      type: 'object',
      properties: {
        scene: sceneDocSchema,
        label: { type: 'string', description: '任务名（可选）' },
        params: {
          type: 'object',
          description: '物理参数（可选）：如 { steps, dt, gravityY, friction, restitution }',
        },
        sweep: {
          type: 'object',
          description: '参数扫描（可选）：如 { dimension: "gravity", values: [-9.81, -5] }',
        },
      },
      required: ['scene'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_simulation',
    description: '按 jobId 查询批量仿真任务状态',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: '任务 id' } },
      required: ['job_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_simulation_results',
    description: '按 jobId 取批量仿真的完整结果（含逐任务数据）',
    inputSchema: {
      type: 'object',
      properties: { job_id: { type: 'string', description: '任务 id' } },
      required: ['job_id'],
      additionalProperties: false,
    },
  },
]

const runTool = async (name, args = {}) => {
  switch (name) {
    case 'health':
      return backendFetch('/api/health')
    case 'list_scenes':
      return backendFetch('/api/scenes')
    case 'get_scene':
      return backendFetch(`/api/scenes/${encodeURIComponent(args.scene_id)}`)
    case 'list_simulations':
      return backendFetch('/api/simulations')
    case 'start_simulation':
      return backendFetch('/api/simulations', {
        method: 'POST',
        body: JSON.stringify({
          scene: args.scene,
          label: args.label ?? null,
          params: args.params ?? null,
          sweep: args.sweep ?? null,
        }),
      })
    case 'get_simulation':
      return backendFetch(`/api/simulations/${encodeURIComponent(args.job_id)}`)
    case 'get_simulation_results':
      return backendFetch(`/api/simulations/${encodeURIComponent(args.job_id)}/results`)
    default:
      return { ok: false, status: 0, error: `未知工具：${name}` }
  }
}

// ─────────────────────────── MCP stdio 协议 ───────────────────────────

const writeMessage = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const respond = (reqId, result) => writeMessage({ jsonrpc: '2.0', id: reqId, result })
const respondError = (reqId, code, message) =>
  writeMessage({ jsonrpc: '2.0', id: reqId, error: { code, message } })

let initialized = false

const handleRequest = async (message) => {
  const { id, method, params } = message
  if (id === undefined || id === null) return // notification：不回包

  switch (method) {
    case 'initialize': {
      // 回显客户端的协议版本：MCP 客户端与服务器协商以客户端声明为准
      initialized = true
      respond(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      })
      return
    }
    case 'ping':
      respond(id, {})
      return
    case 'tools/list':
      respond(id, { tools: TOOLS })
      return
    case 'tools/call': {
      const name = params?.name
      const args = params?.arguments ?? {}
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) {
        respond(id, {
          content: [{ type: 'text', text: `未知工具：${String(name)}` }],
          isError: true,
        })
        return
      }
      const result = await runTool(name, args)
      const text = JSON.stringify(result.ok ? result.data : result, null, 2)
      respond(id, {
        content: [{ type: 'text', text }],
        isError: !result.ok,
      })
      return
    }
    default:
      // 未初始化就调用工具：明确报错而不是静默
      if (!initialized && method?.startsWith('tools/')) {
        respondError(id, -32002, '服务器尚未完成 initialize 握手')
        return
      }
      respondError(id, -32601, `未知方法：${String(method)}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON 解析失败' } })
    return
  }
  handleRequest(message).catch((error) => {
    if (message && message.id !== undefined && message.id !== null) {
      respondError(message.id, -32603, `内部错误：${error.message}`)
    }
  })
})

rl.on('close', () => process.exit(0))
