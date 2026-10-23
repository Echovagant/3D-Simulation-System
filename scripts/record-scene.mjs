#!/usr/bin/env node
/**
 * 把一个场景渲染成 MP4（服务端渲染子项目的录制器）。
 *
 * 用法：node scripts/record-scene.mjs <输入JSON路径> <输出MP4路径> <输出摘要JSON路径>
 * 退出码：0 = 成功；非 0 = 失败（原因写在 stderr 上）
 *
 * 做法：起一个静态服务器服务**生产产物** → 无头 Chrome 打开渲染页
 * （场景在打开前注入）→ 逐物理步推进、逐帧抓图 → 顺序喂给 ffmpeg 编码成 MP4。
 *
 * 与 `scripts/record-demo.mjs` 的区别只有一个，但很要紧：
 * 那边录的是「屏幕上的实时交互」，帧数由录多久决定；
 * 这边录的是「按脚本推进的场景」，**抓到的第 N 帧严格对应物理的第 N 步**，
 * 所以同一个场景重跑两次，产出的帧数必须一模一样。
 */
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, extname, dirname, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CDP, evalJs, sleep } from './lib/cdp.mjs'
import { normalizeRenderRequest } from './lib/render-actions.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(repoRoot, 'dist')
const CACHE_DIR = join(repoRoot, 'node_modules', '.cache')
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const FFMPEG = process.env.FFMPEG_PATH ?? 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe'

/** 渲染页最多等多久就绪（Rapier 的 WASM 要下载并实例化） */
const READY_TIMEOUT_MS = 60_000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

const existsSync = (p) => {
  try {
    stat(p)
    return true
  } catch {
    return false
  }
}

/** 找一个没人占用的本地端口——本机同时跑着好几个项目，抢固定端口迟早出事 */
const findFreePort = () =>
  new Promise((resolvePort, reject) => {
    const probe = createSocketServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolvePort(port))
    })
  })

/** 服务 dist/ 的静态服务器 */
const startStaticServer = async (port) => {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      const file = join(DIST, pathname)
      // 不做 SPA 回退：渲染页需要的每个文件都必须真的存在，
      // 缺一个就让它 404，错误才不会被 index.html 悄悄盖掉。
      const info = await stat(file)
      if (info.isDirectory()) throw new Error('directory')
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
      })
      res.end(body)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return server
}

/** 等 Chrome 的调试端口起来 */
const waitForChrome = async (debugPort, attempts = 60) => {
  for (let i = 0; i < attempts; i++) {
    await sleep(500)
    try {
      const info = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()
      if (info.webSocketDebuggerUrl) return info.webSocketDebuggerUrl
    } catch {
      // 还没起来，继续等
    }
  }
  return null
}

const usage = () => {
  console.error('用法：node scripts/record-scene.mjs <输入JSON路径> <输出MP4路径> <输出摘要JSON路径>')
}

/**
 * 失败信号。
 *
 * 失败时**不能直接 `process.exit()`**：那会跳过 `finally`，
 * 无头 Chrome 就成了没人管的野进程（后端会反复调这个脚本，
 * 野进程会一路堆下去）。失败走异常，让 `finally` 有机会收尾。
 */
class RenderAbort extends Error {}

const main = async () => {
  const [inputArg, mp4Arg, summaryArg] = process.argv.slice(2)
  if (!inputArg || !mp4Arg || !summaryArg) {
    usage()
    process.exit(2)
  }

  const inputPath = resolve(inputArg)
  const mp4Path = resolve(mp4Arg)
  const summaryPath = resolve(summaryArg)
  const startedAt = Date.now()
  let exitCode = 0

  /** 写失败摘要（尽力而为——摘要写不出来也不能盖掉真正的错误） */
  const writeFailureSummary = async (reason, extra = {}) => {
    try {
      await writeFile(
        summaryPath,
        JSON.stringify(
          { ok: false, error: reason, durationMs: Date.now() - startedAt, ...extra },
          null,
          2,
        ),
        'utf8',
      )
    } catch {
      // 摘要写不出来也不能盖掉真正的错误
    }
  }

  /** 失败路径：写摘要并抛出失败信号（由外层统一收尾并决定退出码） */
  const abort = async (reason, extra = {}) => {
    console.error(`[record-scene] ${reason}`)
    await writeFailureSummary(reason, extra)
    throw new RenderAbort(reason)
  }

  // ── 输入 ──
  let raw
  try {
    raw = JSON.parse(await readFile(inputPath, 'utf8'))
  } catch (error) {
    await abort(`读取输入 JSON 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  let request
  try {
    request = normalizeRenderRequest(raw)
  } catch (error) {
    await abort(`输入 JSON 不合法：${error instanceof Error ? error.message : String(error)}`)
  }

  // ── 环境 ──
  if (!existsSync(DIST)) {
    await abort('没有 dist/ —— 先跑 npm run build（渲染页在生产产物里）')
  }
  if (!existsSync(join(DIST, 'render.html'))) {
    await abort('dist/render.html 不存在 —— 先跑 npm run build')
  }
  if (!existsSync(CHROME)) {
    await abort(`找不到 Chrome：${CHROME}`)
  }
  if (!existsSync(FFMPEG)) {
    await abort(`找不到 ffmpeg：${FFMPEG}`)
  }

  await mkdir(dirname(mp4Path), { recursive: true })
  await mkdir(dirname(summaryPath), { recursive: true })

  const httpPort = await findFreePort()
  const debugPort = await findFreePort()
  const server = await startStaticServer(httpPort)

  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${join(CACHE_DIR, 'chrome-render')}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${request.width},${request.height}`,
      // 软件 WebGL 兜底：没有 GPU 的机器（容器、虚拟机）上，
      // 新版 Chrome 默认禁用 SwiftShader，不开这个 WebGL 上下文会创建失败。
      '--enable-unsafe-swiftshader',
      // 容器里 setuid 沙箱常常起不来；只在 CI/容器环境关掉它。
      ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  // Chrome 的 stdout/stderr 要抽干，否则管道填满会把浏览器卡住
  chrome.stdout?.resume()
  chrome.stderr?.resume()

  let cdp = null
  let ffmpeg = null
  let sessionId = null

  try {
    const wsUrl = await waitForChrome(debugPort)
    if (!wsUrl) {
      await abort('Chrome 没有就绪（调试端口没起来）')
    }

    cdp = await CDP.connect(wsUrl)
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
    ;({ sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }))
    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { width: request.width, height: request.height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    )

    // 页面里的报错要带进失败原因：渲染页起不来时，光说「超时」没用
    const pageErrors = []
    cdp.on(
      'Runtime.exceptionThrown',
      (params) => {
        const details = params?.exceptionDetails
        pageErrors.push(details?.exception?.description ?? details?.text ?? 'unknown exception')
      },
      sessionId,
    )
    cdp.on(
      'Runtime.consoleAPICalled',
      (params) => {
        if (params?.type !== 'error') return
        const text = (params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
        pageErrors.push(text || 'console error')
      },
      sessionId,
    )

    // 场景在打开页面前注入：渲染页从 window.__RENDER_SCENE__ 读它
    await cdp.send(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: `window.__RENDER_SCENE__ = ${JSON.stringify(request.scene)};` },
      sessionId,
    )

    await cdp.send(
      'Page.navigate',
      { url: `http://127.0.0.1:${httpPort}/render.html` },
      sessionId,
    )

    // ── 等页面就绪 ──
    const readyDeadline = Date.now() + READY_TIMEOUT_MS
    let ready = false
    while (Date.now() < readyDeadline) {
      const state = await evalJs(
        cdp,
        sessionId,
        `(() => {
          const api = window.__RENDER__
          if (!api) return { present: false, ready: false }
          return { present: true, ready: api.ready === true }
        })()`,
      )
      if (state?.present && state.ready) {
        ready = true
        break
      }
      await sleep(200)
    }
    if (!ready) {
      await abort(
        `渲染页在 ${READY_TIMEOUT_MS / 1000} 秒内没有就绪` +
          (pageErrors.length ? `；页面报错：${pageErrors.slice(0, 3).join(' | ')}` : ''),
        { pageErrors },
      )
    }

    // ── ffmpeg ──
    const ffmpegArgs = [
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      String(request.fps),
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      mp4Path,
    ]
    ffmpeg = spawn(FFMPEG, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
    let ffmpegStderr = ''
    ffmpeg.stderr.on('data', (chunk) => {
      ffmpegStderr += chunk.toString()
    })
    // stdout 要抽干：ffmpeg 往这里写东西而没人读，管道填满会把进程卡住
    ffmpeg.stdout.resume()
    const ffmpegClosed = new Promise((r) => ffmpeg.on('close', (code) => r(code ?? -1)))

    const writeFrame = async (buffer) => {
      if (!ffmpeg.stdin.writable) {
        throw new Error('ffmpeg 的输入管道已经关闭')
      }
      const flushed = ffmpeg.stdin.write(buffer)
      if (!flushed) await new Promise((r) => ffmpeg.stdin.once('drain', r))
    }

    // ── 逐帧推进 + 抓帧 ──
    const applied = new Set()
    let captured = 0
    for (let frame = 0; frame < request.frames; frame++) {
      for (const action of request.actions) {
        if (applied.has(action)) continue
        if (action.atFrame > frame) continue
        await evalJs(
          cdp,
          sessionId,
          `window.__RENDER__.apply(${JSON.stringify(action)})`,
        )
        applied.add(action)
      }

      await evalJs(cdp, sessionId, `window.__RENDER__.step()`)
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId)
      await writeFrame(Buffer.from(shot.data, 'base64'))
      captured += 1
    }

    // 抓到的帧数必须等于请求的帧数——短一帧的视频对调用方就是「帧数对不上」，
    // 不能当成成功交出去（摘要里虽然记着两个数，但退出码必须是失败）。
    if (captured !== request.frames) {
      await abort(`抓到的帧数与请求不一致：请求 ${request.frames} 帧，实际抓到 ${captured} 帧`, {
        requestedFrames: request.frames,
        capturedFrames: captured,
      })
    }

    // 页面自己数的步数必须跟抓到的帧数一致——不一致说明帧与步错位了，
    // 这种视频的「第 N 帧」不再对应「第 N 步」，必须当失败处理而不是照发。
    const pageFrames = await evalJs(cdp, sessionId, `window.__RENDER__.frames()`)
    if (pageFrames !== captured) {
      await abort(`帧与步错位：页面报告推进了 ${pageFrames} 步，实际抓到 ${captured} 帧`, {
        capturedFrames: captured,
        pageFrames,
      })
    }

    ffmpeg.stdin.end()
    const ffmpegExitCode = await ffmpegClosed
    if (ffmpegExitCode !== 0) {
      await abort(
        `ffmpeg 编码失败（退出码 ${ffmpegExitCode}）：\n${ffmpegStderr.split('\n').slice(-12).join('\n')}`,
        { capturedFrames: captured, pageFrames },
      )
    }

    const mp4Stat = await stat(mp4Path)
    if (mp4Stat.size === 0) {
      await abort('产出的 MP4 是空文件', { capturedFrames: captured, pageFrames })
    }

    const summary = {
      ok: true,
      requestedFrames: request.frames,
      capturedFrames: captured,
      pageFrames,
      fps: request.fps,
      width: request.width,
      height: request.height,
      actionCount: request.actions.length,
      durationMs: Date.now() - startedAt,
      mp4Path,
      mp4Bytes: mp4Stat.size,
      ffmpeg: {
        exitCode: ffmpegExitCode,
        stderrTail: ffmpegStderr.split('\n').filter(Boolean).slice(-12),
      },
    }
    await writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8')

    console.log(
      `[record-scene] 完成：${captured} 帧 → ${mp4Path}（${mp4Stat.size} 字节，用时 ${summary.durationMs} ms）`,
    )
  } catch (error) {
    if (ffmpeg) {
      try {
        ffmpeg.stdin.end()
      } catch {
        // 管道可能已经断了
      }
    }
    if (error instanceof RenderAbort) {
      // 失败摘要已经写过了，这里只负责把退出码带出去
      exitCode = 1
    } else {
      const reason = `录制过程中出错：${error instanceof Error ? error.message : String(error)}`
      console.error(`[record-scene] ${reason}`)
      await writeFailureSummary(reason)
      exitCode = 1
    }
  } finally {
    try {
      if (cdp) await cdp.send('Browser.close')
    } catch {
      // 浏览器可能已经关了
    }
    try {
      chrome.kill()
    } catch {
      // 同上
    }
    server.close()
  }
  process.exit(exitCode)
}

// 输入校验阶段的失败发生在 try 之前（那时还没起浏览器与服务器），
// 摘要已经写好，这里只需要安静地以非 0 退出，不要甩一串堆栈。
try {
  await main()
} catch (error) {
  if (!(error instanceof RenderAbort)) throw error
  process.exit(1)
}
