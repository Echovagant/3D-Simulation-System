// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { redactSecrets } from './secret'

/**
 * 下面几个都是**假**的 key 样例串——只用来验证脱敏规则覆盖到了各家真实形态。
 * 仓库里不允许出现真密钥，所以这些行显式豁免（闸门：scripts/check-no-secrets.mjs）。
 */
const FAKE_GEMINI_KEY = 'AIzaSyFakeGeminiKeyOnlyForUnitTest' // secret-scan: allow
const FAKE_XAI_KEY = 'xai-FakeXaiKeyOnlyForUnitTest000000' // secret-scan: allow
const FAKE_GLM_KEY = '0123456789abcdef0123456789abcdef.0123456789abcdef0123456789abcdef' // secret-scan: allow
const FAKE_OPENAI_KEY = 'sk-fakeopenai1234567890' // secret-scan: allow
const FAKE_JWT_KEY = 'eyJhbGciOiJIUzI1NiJ9.FakePayloadForUnitTest' // secret-scan: allow

describe('密钥脱敏', () => {
  it('Google Gemini 的 key（AIza 前缀）会被抹掉', () => {
    const redacted = redactSecrets(`API key not valid: ${FAKE_GEMINI_KEY}`)
    expect(redacted).not.toContain('SyFakeGeminiKeyOnlyForUnitTest')
    expect(redacted).toContain('AIza***')
    expect(redacted).toContain('API key not valid:')
  })

  it('xAI Grok 的 key（xai- 前缀）会被抹掉', () => {
    const redacted = redactSecrets(`x-goog-api-key: ${FAKE_XAI_KEY}`)
    expect(redacted).not.toContain('FakeXaiKeyOnlyForUnitTest')
    expect(redacted).toContain('xai-***')
  })

  it('智谱 GLM 的 key（两段十六进制）会被抹掉', () => {
    const bare = redactSecrets(`x-goog-api-key: ${FAKE_GLM_KEY}`)
    expect(bare).not.toContain('0123456789abcdef')
    expect(bare).toBe('x-goog-api-key: ***')

    const bearer = redactSecrets(`Authorization: Bearer ${FAKE_GLM_KEY}`)
    expect(bearer).not.toContain('0123456789abcdef')
    expect(bearer).toBe('Authorization: Bearer ***')
  })

  it('sk- 前缀与 JWT 形态照旧会被抹掉', () => {
    expect(redactSecrets(FAKE_OPENAI_KEY)).toBe('sk-***')
    expect(redactSecrets(FAKE_JWT_KEY)).toBe('eyJ***')
    // 前缀规则先跑：Bearer 头里的 sk- key 也会被抹掉
    expect(redactSecrets(`Bearer ${FAKE_OPENAI_KEY}`)).toBe('Bearer sk-***')
  })

  it('不误伤正常文本：版本号、时间戳、哈希、模型名', () => {
    const text = [
      '版本 1.2.3，耗时 0.05 秒，commit a1b2c3d',
      'sha256 3f786850e387550fdab836ed7e6dc881de23001b',
      '纳秒时间戳 1758000000000000.1758000000000001',
      '模型 xai-grok-4.7 与 glm-5.3、gpt-5.6-terra',
      '文件名 index.bac 与样式表 main.css',
    ].join('；')
    expect(redactSecrets(text)).toBe(text)
  })

  it('空文本不炸', () => {
    expect(redactSecrets('')).toBe('')
  })
})
