/**
 * LLM 提供商清单。
 *
 * ⚠️ 这里的每一个 base_url 与模型 id 都对着**各家官方文档**核过（见 `docsUrl`）：
 *
 * | 提供商 | 协议 | base_url | 模型 |
 * | --- | --- | --- | --- |
 * | MiniMax | OpenAI 兼容 | api.minimax.io/v1 | MiniMax-M3.1-Flash |
 * | DeepSeek | OpenAI 兼容 | api.deepseek.com | deepseek-flash |
 * | 智谱 GLM | OpenAI 兼容 | open.bigmodel.cn/api/paas/v4 | glm-5.3 |
 * | 智谱 GLM 编码套餐 | OpenAI 兼容 | open.bigmodel.cn/api/coding/paas/v4 | glm-5.2 |
 * | 通义千问 Qwen | OpenAI 兼容 | dashscope.aliyuncs.com/compatible-mode/v1 | qwen3.8-max |
 * | 火山方舟 | OpenAI 兼容 | ark.cn-beijing.volces.com/api/v3 | doubao-seed-2.1-pro |
 * | 火山方舟编码套餐 | OpenAI 兼容 | ark.cn-beijing.volces.com/api/coding/v3 | Doubao-Seed-Code |
 * | OpenAI | OpenAI 兼容 | api.openai.com/v1 | gpt-5.6-terra |
 * | Anthropic Claude | Anthropic Messages | api.anthropic.com/v1 | claude-opus-5 |
 * | Google Gemini | Gemini Interactions | generativelanguage.googleapis.com/v1beta | gemini-3.8-flash |
 * | xAI Grok | OpenAI 兼容 | api.x.ai/v1 | grok-4.7 |
 *
 * 模型 id 迭代很快，而且常常与账号绑定（方舟给的是"接入点"），
 * 所以**模型与 base_url 都可以在界面上直接改**——这里的值只是默认值。
 */

/** 协议家族：决定请求体、鉴权头与响应解析 */
export type LlmProtocol = 'openai' | 'anthropic' | 'gemini'

export interface LlmProvider {
  /** 稳定标识（也是 key 的存放槽位） */
  id: string
  /** 界面上的显示名 */
  name: string
  /** 协议家族 */
  protocol: LlmProtocol
  /** 默认 base_url（不要带 /chat/completions） */
  baseUrl: string
  /** 默认模型 id */
  model: string
  /** 官方文档地址 */
  docsUrl: string
  /**
   * 思考深度参数。
   *
   * ⚠️ 只有官方文档明确写了 `reasoning_effort` 的服务商才带这个字段——
   * 往不认识这个参数的接口上发，多半会被判成非法参数。
   *
   * ⚠️ 对**推理型模型**它还是必需的：实测 MiniMax-M3.1-Flash 不带这个参数时，
   * 推理 token 会涨到 242/256 把正文截断（`finish_reason=length`），
   * 返回的 JSON 变成半截，闸门必然拒收。带上 `low` 后推理稳定在 0~150 token。
   */
  reasoningEffort?: 'low' | 'medium' | 'high'
  /** 这一家的特别之处（界面上会显示） */
  note?: string
}

/** 全部可选提供商 */
export const llmProviders: LlmProvider[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    protocol: 'openai',
    baseUrl: 'https://api.minimax.io/v1',
    model: 'MiniMax-M3.1-Flash',
    docsUrl: 'https://platform.minimax.io/docs/guides/text-generation',
    reasoningEffort: 'low',
    note: 'M3.1-Flash 不允许关闭思考，只能把 reasoning_effort 调低。',
  },
  {
    id: 'minimax-alt',
    name: 'MiniMax（api.minimaxi.com）',
    protocol: 'openai',
    baseUrl: 'https://api.minimaxi.com/v1',
    model: 'MiniMax-M3.1-Flash',
    docsUrl: 'https://platform.minimaxi.com/document/guides/text-generation',
    reasoningEffort: 'low',
    note: '与 api.minimax.io 是两套账号体系，key 不通用：拿错会返回 401。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    reasoningEffort: 'high',
    note: 'deepseek-flash 对应 DeepSeek-V4.1-Flash-1017；同代还有 deepseek-v4-pro（V4-Pro-0813）。旧的 deepseek-v4-flash 已退役。',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-5.3',
    docsUrl: 'https://docs.bigmodel.cn/',
  },
  {
    id: 'zhipu-coding',
    name: '智谱 GLM（编码套餐）',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    model: 'glm-5.2',
    docsUrl: 'https://docs.bigmodel.cn/',
    note: 'Coding Plan 套餐有专属端点，和通用端点不通用。',
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-max',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/',
    reasoningEffort: 'low',
    note: '百炼平台也提供 Anthropic 协议端点，模型名相同。',
  },
  {
    id: 'ark',
    name: '火山方舟',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2.1-pro',
    docsUrl: 'https://www.volcengine.com/docs/82379/1099320',
    note: '同系列还有 doubao-seed-2.1-lite / 2.1-turbo 与 2.0-code；模型 id 以控制台给出的接入点为准，可直接在下面改。',
  },
  {
    id: 'ark-coding',
    name: '火山方舟（编码套餐）',
    protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    model: 'Doubao-Seed-Code',
    docsUrl: 'https://www.volcengine.com/docs/82379',
    note: 'Coding Plan 有独立域名，配错会直接 403；额度也只认套餐里的 key。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.6-terra',
    docsUrl: 'https://platform.openai.com/docs/models',
    reasoningEffort: 'low',
    note: 'Chat Completions 支持 gpt-6-astra 与 gpt-5.6-terra；旗舰 gpt-6-astra 更贵，工具调用则必须走 Responses API。',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-opus-5',
    docsUrl: 'https://platform.claude.com/docs/en/about-claude/models/overview',
    note: 'Anthropic Messages 协议：system 是顶层字段，输出上限用 max_tokens。',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-3.8-flash',
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
    note: 'Gemini Interactions 协议：鉴权用 x-goog-api-key，思考深度用 thinking_level。',
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.7',
    docsUrl: 'https://docs.x.ai/',
  },
]

/** 按 id 找提供商 */
export const findProvider = (id: string): LlmProvider | undefined =>
  llmProviders.find((provider) => provider.id === id)
