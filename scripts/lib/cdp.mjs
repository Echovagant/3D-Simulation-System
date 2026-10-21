/**
 * 最小 CDP（Chrome DevTools Protocol）客户端。
 *
 * 只依赖 Node 22+ 内置的 WebSocket，不引外部包——
 * 这个仓库的脚本要能在任何贡献者的机器上直接 `node scripts/xxx.mjs` 跑起来，
 * 不该先装一堆依赖。
 */
export class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message + ' ' + JSON.stringify(msg.error)))
        else resolve(msg.result)
      } else if (msg.method) {
        const key = msg.sessionId ? msg.sessionId + ':' + msg.method : msg.method
        const hs = this.handlers.get(key) || []
        for (const h of hs) h(msg.params, msg.sessionId)
        const all = this.handlers.get(msg.method) || []
        for (const h of all) h(msg.params, msg.sessionId)
      }
    })
  }

  on(method, fn, sessionId) {
    const key = sessionId ? sessionId + ':' + method : method
    if (!this.handlers.has(key)) this.handlers.set(key, [])
    this.handlers.get(key).push(fn)
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(payload))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error('timeout ' + method))
        }
      }, 60000)
    })
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })
    return new CDP(ws)
  }
}

/** 在页面里执行一段 JS 并取回返回值 */
export async function evalJs(cdp, sessionId, expr, awaitPromise = true) {
  const r = await cdp.send(
    'Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise },
    sessionId,
  )
  if (r.exceptionDetails) {
    throw new Error(
      'JS error: ' +
        JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text),
    )
  }
  return r.result.value
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
