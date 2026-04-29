import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'

import {
  startRuntime,
  type RuntimeClient,
  type RuntimeHandle,
  type StartOptions,
} from '../runtime/goClient.js'

type SidecarState =
  | { kind: 'idle' }
  | { kind: 'starting'; promise: Promise<RuntimeHandle | null> }
  | { kind: 'ready'; handle: RuntimeHandle }
  | { kind: 'disabled'; reason: string }
  | { kind: 'stopped' }

let state: SidecarState = { kind: 'idle' }

function resolveBin(): string | null {
  const override = process.env.OC_RUNTIME_BIN
  if (override) return existsSync(override) ? override : null
  const ext = platform() === 'win32' ? '.exe' : ''
  const local = join(process.cwd(), 'bin', `oc-runtime${ext}`)
  return existsSync(local) ? local : null
}

export function ensureRuntime(opts: StartOptions = {}): Promise<RuntimeHandle | null> {
  if (process.env.OC_RUNTIME_DISABLED === '1') {
    state = { kind: 'disabled', reason: 'OC_RUNTIME_DISABLED=1' }
    return Promise.resolve(null)
  }

  if (state.kind === 'ready') return Promise.resolve(state.handle)
  if (state.kind === 'starting') return state.promise
  if (state.kind === 'disabled') return Promise.resolve(null)
  if (state.kind === 'stopped') return Promise.resolve(null)

  const bin = opts.bin ?? resolveBin()
  if (!bin) {
    state = {
      kind: 'disabled',
      reason: 'oc-runtime binary not found (run `bun runtime:build` to enable sidecar)',
    }
    console.log(`[runtime] sidecar disabled: ${state.reason}`)
    return Promise.resolve(null)
  }

  const promise = startRuntime({
    ...opts,
    bin,
    onStdout: opts.onStdout ?? ((line) => console.log(`[runtime] ${line}`)),
    onStderr: opts.onStderr ?? ((line) => console.error(`[runtime] ${line}`)),
  })
    .then((handle) => {
      state = { kind: 'ready', handle }
      console.log(`[runtime] sidecar ready (endpoint=${handle.endpoint}, dataDir=${handle.dataDir})`)
      return handle
    })
    .catch((error) => {
      state = {
        kind: 'disabled',
        reason: error instanceof Error ? error.message : String(error),
      }
      console.error(`[runtime] sidecar failed to start: ${state.reason}`)
      return null
    })

  state = { kind: 'starting', promise }
  return promise
}

export async function getRuntimeClient(): Promise<RuntimeClient | null> {
  const handle = await ensureRuntime()
  return handle?.client ?? null
}

export async function shutdownRuntime(): Promise<void> {
  if (state.kind === 'starting') {
    await state.promise.catch(() => null)
  }
  if (state.kind !== 'ready') {
    state = { kind: 'stopped' }
    return
  }
  const { handle } = state
  state = { kind: 'stopped' }
  await handle.stop()
  console.log('[runtime] sidecar stopped')
}

export function getRuntimeStatus(): { kind: SidecarState['kind']; reason?: string; endpoint?: string } {
  switch (state.kind) {
    case 'ready':
      return { kind: 'ready', endpoint: state.handle.endpoint }
    case 'disabled':
      return { kind: 'disabled', reason: state.reason }
    default:
      return { kind: state.kind }
  }
}

/**
 * Test-only seam: injects a pre-started RuntimeHandle into the singleton so
 * verification scripts can drive a sidecar they own (with a temp dataDir)
 * without races against ensureRuntime() spawning a second one. NOT for prod.
 */
export function __setRuntimeHandleForTest(handle: RuntimeHandle | null): void {
  if (handle === null) {
    state = { kind: 'idle' }
  } else {
    state = { kind: 'ready', handle }
  }
}
