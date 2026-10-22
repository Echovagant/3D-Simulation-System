// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { findProvider, llmProviders } from '@/config/llmProviders'

describe('LLM 提供商清单', () => {
  it('覆盖到用户点名的各家（GLM / DeepSeek / Qwen / 火山方舟编码套餐 / GPT / Claude / Gemini / Grok）', () => {
    const names = llmProviders.map((provider) => provider.name).join(' ')
    for (const keyword of [
      'GLM',
      'DeepSeek',
      'Qwen',
      '火山方舟',
      'OpenAI',
      'Claude',
      'Gemini',
      'Grok',
    ]) {
      expect(names).toContain(keyword)
    }
  })

  it('火山方舟的编码套餐有独立的 base_url（与通用端点不通用）', () => {
    const general = findProvider('ark')
    const coding = findProvider('ark-coding')
    expect(general).toBeDefined()
    expect(coding).toBeDefined()
    expect(coding!.baseUrl).not.toBe(general!.baseUrl)
    expect(coding!.baseUrl).toContain('/api/coding')
  })

  it('id 唯一、base_url 与模型 id 都不为空', () => {
    const ids = new Set<string>()
    for (const provider of llmProviders) {
      expect(ids.has(provider.id)).toBe(false)
      ids.add(provider.id)
      expect(provider.baseUrl).toMatch(/^https:\/\//)
      expect(provider.model.length).toBeGreaterThan(0)
      expect(provider.docsUrl).toMatch(/^https:\/\//)
    }
  })

  it('base_url 不带具体的接口路径（客户端自己拼）', () => {
    for (const provider of llmProviders) {
      expect(provider.baseUrl).not.toContain('/chat/completions')
      expect(provider.baseUrl).not.toContain('/messages')
      expect(provider.baseUrl).not.toContain('/interactions')
    }
  })

  it('协议只有三种，且每家都归到其中之一', () => {
    const protocols = new Set(llmProviders.map((provider) => provider.protocol))
    for (const protocol of protocols) {
      expect(['openai', 'anthropic', 'gemini']).toContain(protocol)
    }
  })

  it('只给官方文档确认支持 reasoning_effort 的服务商带这个参数', () => {
    const withEffort = llmProviders
      .filter((provider) => provider.reasoningEffort)
      .map((provider) => provider.id)
    expect(withEffort).toContain('minimax')
    expect(withEffort).toContain('deepseek')
    // 智谱与方舟的文档里没有写这个参数——乱发可能被判非法参数
    expect(withEffort).not.toContain('zhipu')
    expect(withEffort).not.toContain('ark')
  })

  it('清单里不出现已退役 / 已下线的模型 id', () => {
    const models = llmProviders.map((provider) => provider.model)
    // DeepSeek 官方定价页写明：deepseek-chat / deepseek-reasoner 将下线，
    // 旧的 deepseek-v4-flash 已被 V4.1-Flash 接管并退役
    for (const retired of [
      'deepseek-chat',
      'deepseek-reasoner',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
    ]) {
      expect(models).not.toContain(retired)
    }
    // 现在的 DeepSeek 主力是 deepseek-flash（对应 DeepSeek-V4.1-Flash-1017）
    expect(models).toContain('deepseek-flash')
  })
})
