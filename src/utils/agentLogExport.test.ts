/**
 * 日志导出与参数格式化的纯函数。
 *
 * 这两件事面板要用，但面板组件要挂载才能跑——纯函数单独测，
 * 一来能测到，二来出问题时能直接定位。
 */
import { describe, it, expect } from 'vitest'
import {
  formatLogParameters,
  serializeAgentLogs,
  exportFileStamp,
  type ExportableAgentLog,
} from './agentLogExport'

const log = (overrides: Partial<ExportableAgentLog> = {}): ExportableAgentLog => ({
  seq: 1,
  timestamp: Date.UTC(2026, 9, 24, 12, 30, 45),
  message: '决定: move',
  type: 'info',
  agentId: 'agent-1',
  agentName: '导航机器人',
  ...overrides,
})

describe('formatLogParameters —— 浮点数取整', () => {
  it('把浮点数取到两位小数', () => {
    const text = formatLogParameters({ speed: 5.123456789 })
    expect(text).toBe('{"speed":5.12}')
  })

  it('数组里的浮点数也取整', () => {
    const text = formatLogParameters({ direction: [-0.5640458590656282, 0, 0.851745735902] })
    expect(text).toBe('{"direction":[-0.56,0,0.85]}')
  })

  it('嵌套对象里的浮点数也取整', () => {
    const text = formatLogParameters({ params: { angle: 1.0471975511965976, depth: 2 } })
    expect(text).toBe('{"params":{"angle":1.05,"depth":2}}')
  })

  it('整数原样保留', () => {
    expect(formatLogParameters({ speed: 5 })).toBe('{"speed":5}')
  })

  it('取整后不再出现长串小数——面板每行只占一行高度', () => {
    const text = formatLogParameters({ direction: [-0.5640458590656282, 0, 0.851745735902] })
    expect(text).not.toMatch(/\d\.\d{5,}/)
  })
})

describe('serializeAgentLogs —— 导出成 JSONL', () => {
  it('一行一条记录', () => {
    const text = serializeAgentLogs([log({ seq: 1 }), log({ seq: 2 })])
    const lines = text.trim().split('\n')
    expect(lines).toHaveLength(2)
  })

  it('每行都是能直接 JSON.parse 的对象', () => {
    const text = serializeAgentLogs([log({ message: '出发', type: 'warning' })])
    const parsed = JSON.parse(text.trim())
    expect(parsed.message).toBe('出发')
    expect(parsed.type).toBe('warning')
    expect(parsed.agent).toBe('导航机器人')
    expect(parsed.agentId).toBe('agent-1')
  })

  it('时间写成 ISO 8601', () => {
    const text = serializeAgentLogs([log()])
    expect(JSON.parse(text.trim()).time).toBe('2026-10-24T12:30:45.000Z')
  })

  it('空列表导出空内容', () => {
    expect(serializeAgentLogs([])).toBe('')
  })

  it('末尾有换行——追加写入时不会跟上一行黏在一起', () => {
    expect(serializeAgentLogs([log()]).endsWith('\n')).toBe(true)
  })
})

describe('exportFileStamp —— 文件名里的时间戳', () => {
  it('不含冒号和点（Windows 文件名里非法）', () => {
    const stamp = exportFileStamp(new Date('2026-10-24T12:30:45.123Z'))
    expect(stamp).not.toMatch(/[:.]/)
  })

  it('仍然是可读的日期时间', () => {
    const stamp = exportFileStamp(new Date('2026-10-24T12:30:45.123Z'))
    expect(stamp).toBe('2026-10-24T12-30-45-123Z')
  })
})
