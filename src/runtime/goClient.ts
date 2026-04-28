import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

function binaryPath(): string {
  const override = process.env.OC_RUNTIME_BIN
  if (override && existsSync(override)) return override
  const ext = platform() === 'win32' ? '.exe' : ''
  const local = join(process.cwd(), 'bin', `oc-runtime${ext}`)
  if (existsSync(local)) return local
  return `oc-runtime${ext}`
}

function defaultDataDir(): string {
  return process.env.OC_RUNTIME_DATA_DIR || join(homedir(), '.claude-haha', 'runtime')
}

export interface HealthResponse {
  ok: boolean
  version: string
  pid: number
  goos: string
  goarch: string
  endpoint: string
  db_path: string
}

export interface Task {
  id: string
  session_id?: string | null
  parent_task_id?: string | null
  prompt: string
  model?: string | null
  cwd: string
  status: string
  priority: number
  max_attempts: number
  attempts_used: number
  created_at: number
  updated_at: number
  started_at?: number | null
  finished_at?: number | null
  last_error?: string | null
}

export interface CreateTaskInput {
  prompt: string
  cwd: string
  model?: string
  session_id?: string
  priority?: number
}

export class RuntimeClient {
  readonly endpoint: string

  constructor(ep: string) {
    this.endpoint = ep
  }

  health(): Promise<HealthResponse> {
    return this.req<HealthResponse>('GET', '/health')
  }

  createTask(input: CreateTaskInput): Promise<Task> {
    return this.req<Task>('POST', '/v1/tasks', input)
  }

  listTasks(): Promise<{ tasks: Task[] }> {
    return this.req<{ tasks: Task[] }>('GET', '/v1/tasks')
  }

  getTask(id: string): Promise<Task> {
    return this.req<Task>('GET', `/v1/tasks/${encodeURIComponent(id)}`)
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { status, body: text } = await rawHttp(this.endpoint, method, path, body)
    if (status >= 200 && status < 300) {
      if (!text) return {} as T
      try {
        return JSON.parse(text) as T
      } catch (e) {
        throw new Error(`bad json from runtime: ${(e as Error).message}`)
      }
    }
    throw new Error(`runtime ${status}: ${text}`)
  }
}

interface HttpResult {
  status: number
  body: string
}

// rawHttp speaks minimal HTTP/1.1 over Bun.connect (named pipe / unix socket).
// We avoid node:http on purpose: Bun's node:http client ignores the
// `createConnection` hook, which breaks IPC transport.
async function rawHttp(
  endpoint: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResult> {
  const payload =
    body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
  const headers = [
    `${method} ${path} HTTP/1.1`,
    'Host: oc-runtime',
    'Connection: close',
    'Content-Type: application/json',
  ]
  if (payload) headers.push(`Content-Length: ${payload.length}`)
  const head = Buffer.from(headers.join('\r\n') + '\r\n\r\n', 'utf8')

  return new Promise<HttpResult>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      const buf = Buffer.concat(chunks)
      const split = indexOfDoubleCRLF(buf)
      if (split < 0) {
        reject(new Error(`runtime: malformed response (${buf.length} bytes)`))
        return
      }
      const headerText = buf.slice(0, split).toString('utf8')
      const bodyBuf = buf.slice(split + 4)
      const statusLine = headerText.split('\r\n', 1)[0] ?? ''
      const m = /^HTTP\/1\.\d (\d{3})/.exec(statusLine)
      const status = m ? Number(m[1]) : 0
      resolve({ status, body: bodyBuf.toString('utf8') })
    }

    Bun.connect({
      unix: endpoint,
      socket: {
        open(sock) {
          sock.write(head)
          if (payload) sock.write(payload)
        },
        data(_, data) {
          chunks.push(data)
        },
        end: finish,
        close: finish,
        error(_, err) {
          if (settled) return
          settled = true
          reject(err instanceof Error ? err : new Error(String(err)))
        },
      },
    }).catch((err) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })
}

function indexOfDoubleCRLF(buf: Buffer): number {
  for (let i = 0; i < buf.length - 3; i++) {
    if (
      buf[i] === 0x0d &&
      buf[i + 1] === 0x0a &&
      buf[i + 2] === 0x0d &&
      buf[i + 3] === 0x0a
    ) {
      return i
    }
  }
  return -1
}

export interface StartOptions {
  bin?: string
  dataDir?: string
  logLevel?: 'debug' | 'info' | 'warn' | 'error'
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
}

export interface RuntimeHandle {
  client: RuntimeClient
  child: ChildProcess
  endpoint: string
  dataDir: string
  stop(): Promise<void>
}

export async function startRuntime(opts: StartOptions = {}): Promise<RuntimeHandle> {
  const bin = opts.bin ?? binaryPath()
  const dataDir = opts.dataDir ?? defaultDataDir()
  const logLevel = opts.logLevel ?? 'info'

  const child = spawn(bin, ['--data-dir', dataDir, '--log-level', logLevel], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OC_RUNTIME_DATA_DIR: dataDir },
  })

  child.stdout?.setEncoding('utf8').on('data', (data: string) => {
    for (const line of data.split('\n')) if (line) opts.onStdout?.(line)
  })
  child.stderr?.setEncoding('utf8').on('data', (data: string) => {
    for (const line of data.split('\n')) if (line) opts.onStderr?.(line)
  })

  const endpointFile = join(dataDir, 'runtime.endpoint')
  const ep = await waitForEndpoint(endpointFile, child, 5000)
  const client = new RuntimeClient(ep)
  await waitForReady(client, child, 5000)

  return {
    client,
    child,
    endpoint: ep,
    dataDir,
    stop: () =>
      new Promise<void>((resolve) => {
        const done = () => resolve()
        child.once('exit', done)
        if (!child.kill('SIGTERM')) done()
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 3000).unref()
      }),
  }
}

async function waitForEndpoint(
  file: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`go-runtime exited (code=${child.exitCode}) before publishing endpoint`)
    }
    if (existsSync(file)) {
      const ep = readFileSync(file, 'utf8').trim()
      if (ep) return ep
    }
    await sleep(50)
  }
  throw new Error(`go-runtime did not publish ${file} within ${timeoutMs}ms`)
}

async function waitForReady(
  client: RuntimeClient,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`go-runtime exited (code=${child.exitCode}) during readiness probe`)
    }
    try {
      const h = await client.health()
      if (h.ok) return
    } catch (e) {
      lastErr = e
    }
    await sleep(100)
  }
  throw new Error(`go-runtime did not become ready within ${timeoutMs}ms: ${String(lastErr)}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
