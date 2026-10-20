import { describe, it, expect } from 'vitest'
import {
  formatFileSize,
  formatDate,
  formatNumber,
  formatDocTitle,
  parseDocPath,
} from './formatHelpers'

describe('formatFileSize', () => {
  it('把字节数格式化为 KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB')
  })

  it('0 字节返回 0 Bytes', () => {
    expect(formatFileSize(0)).toBe('0 Bytes')
  })

  it('负数输入不应产生 NaN', () => {
    // 修复前会得到 "NaN undefined"（Math.log 负数）
    expect(formatFileSize(-1)).not.toContain('NaN')
    expect(formatFileSize(-1)).toBe('0 Bytes')
  })

  it('非有限数字退化成 0 Bytes', () => {
    expect(formatFileSize(Number.NaN)).toBe('0 Bytes')
    expect(formatFileSize(Number.POSITIVE_INFINITY)).toBe('0 Bytes')
  })

  it('大单位向上进位', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB')
  })
})

describe('formatDate', () => {
  it('能解析 ISO 日期', () => {
    expect(formatDate('2024-01-15')).toContain('2024')
  })

  it('非法日期不抛错', () => {
    expect(() => formatDate('not-a-date')).not.toThrow()
  })
})

describe('formatNumber', () => {
  it('加千位分隔符', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
  })

  it('小数保留默认位数', () => {
    expect(formatNumber(0.5)).toBe('0.5')
  })
})

describe('formatDocTitle', () => {
  it('把连字符转成空格并首字母大写', () => {
    expect(formatDocTitle('model-library')).toBe('Model Library')
  })

  it('空输入返回空串', () => {
    expect(formatDocTitle('')).toBe('')
  })
})

describe('parseDocPath', () => {
  it('拆出分类和文件名', () => {
    expect(parseDocPath('guide/introduction')).toEqual({
      category: 'guide',
      name: 'introduction',
    })
  })

  it('没有斜杠时分类为空', () => {
    expect(parseDocPath('introduction')).toEqual({
      category: 'introduction',
      name: '',
    })
  })
})
