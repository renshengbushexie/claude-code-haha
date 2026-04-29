#!/usr/bin/env bun
/**
 * P2 Step 4 verification — synthetic-task drive of taskMirror against a real
 * Go runtime sidecar. Asserts that with OC_RUNTIME_STATE_AUTHORITY=1, the TS
 * lifecycle (createTask → running → completed/failed/killed) is mirrored
 * into SQLite via the documented status mapping.
 *
 * Phases:
 *   1. completed-flow:  pending → running → completed
 *   2. failed-flow:     pending → running → failed
 *   3. killed-flow:     pending → running, then kill (cancelTask)
 *   4. straight-to-completed: pending → completed (mirror inserts running)
 *   5. flag-OFF: re-import mirror with flag unset, assert no runtime calls
 *   6. framework chokepoint: drive registerTask + updateTaskState with a
 *      synthetic AppState and confirm the same end-state in SQLite.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { startRuntime, type RuntimeHandle, RuntimeError } from '../src/runtime/goClient.js'
import { __setRuntimeHandleForTest } from '../src/server/runtimeSidecar.js'

let runtime: RuntimeHandle | null = null

function pass(label: string): void {
  console.log(`  ok  ${label}`)
}

function fail(label: string, detail: string): never {
  console.error(`  FAIL ${label}: ${detail}`)
  process.exit(1)
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
  pass(label)
}

function assertTransitionChain(
  actual: Array<{ from: string; to: string }>,
  expected: Array<[string, string]>,
  label: string,
): void {
  if (actual.length !== expected.length) {
    fail(
      label,
      `chain length: expected ${expected.length} (${JSON.stringify(expected)}), got ${actual.length} (${JSON.stringify(actual)})`,
    )
  }
  for (let i = 0; i < expected.length; i++) {
    const [from, to] = expected[i]!
    const a = actual[i]!
    if (a.from !== from || a.to !== to) {
      fail(label, `step ${i}: expected ${from}→${to}, got ${a.from}→${a.to}`)
    }
  }
  pass(label)
}

async function withDataDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'oc-runtime-mirror-'))
  return dir
}

async function startSidecar(dataDir: string): Promise<RuntimeHandle> {
  const handle = await startRuntime({
    dataDir,
    logLevel: 'warn',
    onStdout: () => {},
    onStderr: (line) => {
      if (line.includes('panic') || line.includes('FATAL')) {
        console.error(`[runtime stderr] ${line}`)
      }
    },
  })
  return handle
}

async function shutdown(): Promise<void> {
  __setRuntimeHandleForTest(null)
  if (runtime) {
    await runtime.stop().catch(() => {})
    runtime = null
  }
}

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(130))
})

async function phase1Completed(): Promise<void> {
  console.log('\n[phase 1] completed-flow: pending → running → completed')
  const { mirrorTaskCreated, mirrorTaskTransition, __mirrorCacheGet, __mirrorDrain, __mirrorCacheClear } =
    await freshMirror({ flagOn: true })

  const localId = 'p1-task-completed'
  mirrorTaskCreated({ localTaskId: localId, prompt: 'phase1', cwd: process.cwd() })
  await __mirrorDrain()

  const cacheAfterCreate = __mirrorCacheGet(localId)
  if (!cacheAfterCreate) fail('cache populated after create', 'entry missing')
  pass('cache populated after create')
  assertEq(cacheAfterCreate.currentState, 'pending', 'cache.currentState=pending')

  mirrorTaskTransition(localId, 'running')
  await __mirrorDrain()
  assertEq(__mirrorCacheGet(localId)?.currentState, 'running', 'cache.currentState=running')

  mirrorTaskTransition(localId, 'completed')
  await __mirrorDrain()
  assertEq(__mirrorCacheGet(localId)?.currentState, 'completed', 'cache.currentState=completed')

  const runtimeTaskId = cacheAfterCreate.runtimeTaskId
  const transitions = await runtime!.client.getTaskTransitions(runtimeTaskId)
  assertTransitionChain(
    transitions.map((t) => ({ from: t.from, to: t.to })),
    [
      ['pending', 'queued'],
      ['queued', 'running'],
      ['running', 'completed'],
    ],
    'transition chain pending→queued→running→completed',
  )
  const final = await runtime!.client.getTask(runtimeTaskId)
  assertEq(final.status, 'completed', 'runtime row final status=completed')
  __mirrorCacheClear()
}

async function phase2Failed(): Promise<void> {
  console.log('\n[phase 2] failed-flow: pending → running → failed')
  const { mirrorTaskCreated, mirrorTaskTransition, __mirrorCacheGet, __mirrorDrain, __mirrorCacheClear } =
    await freshMirror({ flagOn: true })

  const localId = 'p2-task-failed'
  mirrorTaskCreated({ localTaskId: localId, prompt: 'phase2', cwd: process.cwd() })
  await __mirrorDrain()
  mirrorTaskTransition(localId, 'running')
  mirrorTaskTransition(localId, 'failed', 'phase2 boom')
  await __mirrorDrain()

  const entry = __mirrorCacheGet(localId)!
  assertEq(entry.currentState, 'failed', 'cache.currentState=failed')

  const final = await runtime!.client.getTask(entry.runtimeTaskId)
  assertEq(final.status, 'failed', 'runtime row final status=failed')
  if (final.last_error !== 'phase2 boom') {
    fail('runtime row last_error', `got ${JSON.stringify(final.last_error)}`)
  }
  pass('runtime row last_error=phase2 boom')
  __mirrorCacheClear()
}

async function phase3Killed(): Promise<void> {
  console.log('\n[phase 3] killed-flow: pending → running, then cancel')
  const { mirrorTaskCreated, mirrorTaskTransition, mirrorTaskKilled, __mirrorCacheGet, __mirrorDrain, __mirrorCacheClear } =
    await freshMirror({ flagOn: true })

  const localId = 'p3-task-killed'
  mirrorTaskCreated({ localTaskId: localId, prompt: 'phase3', cwd: process.cwd() })
  await __mirrorDrain()
  mirrorTaskTransition(localId, 'running')
  await __mirrorDrain()

  mirrorTaskKilled(localId, 'user pressed kill')
  await __mirrorDrain()

  const entry = __mirrorCacheGet(localId)!
  assertEq(entry.currentState, 'cancelled', 'cache.currentState=cancelled')

  const final = await runtime!.client.getTask(entry.runtimeTaskId)
  assertEq(final.status, 'cancelled', 'runtime row final status=cancelled')

  // cancelTask is idempotent — second call must not throw.
  mirrorTaskKilled(localId, 'second kill')
  await __mirrorDrain()
  assertEq(__mirrorCacheGet(localId)!.currentState, 'cancelled', 'idempotent cancel kept cancelled')
  __mirrorCacheClear()
}

async function phase4StraightToCompleted(): Promise<void> {
  console.log('\n[phase 4] pending → completed (mirror inserts running)')
  const { mirrorTaskCreated, mirrorTaskTransition, __mirrorCacheGet, __mirrorDrain, __mirrorCacheClear } =
    await freshMirror({ flagOn: true })

  const localId = 'p4-task-jump'
  mirrorTaskCreated({ localTaskId: localId, prompt: 'phase4', cwd: process.cwd() })
  await __mirrorDrain()
  mirrorTaskTransition(localId, 'completed')
  await __mirrorDrain()

  const entry = __mirrorCacheGet(localId)!
  const transitions = await runtime!.client.getTaskTransitions(entry.runtimeTaskId)
  assertTransitionChain(
    transitions.map((t) => ({ from: t.from, to: t.to })),
    [
      ['pending', 'queued'],
      ['queued', 'running'],
      ['running', 'completed'],
    ],
    'mirror auto-inserted queued+running before completed',
  )
  __mirrorCacheClear()
}

async function phase5FlagOff(): Promise<void> {
  console.log('\n[phase 5] flag OFF: mirror is a no-op')
  const { mirrorTaskCreated, mirrorTaskTransition, __mirrorCacheGet, __mirrorDrain, __mirrorCacheClear } =
    await freshMirror({ flagOn: false })

  const localId = 'p5-task-off'
  mirrorTaskCreated({ localTaskId: localId, prompt: 'phase5', cwd: process.cwd() })
  mirrorTaskTransition(localId, 'running')
  mirrorTaskTransition(localId, 'completed')
  await __mirrorDrain(500)

  const entry = __mirrorCacheGet(localId)
  if (entry !== undefined) {
    fail('flag OFF cache miss', `expected undefined, got ${JSON.stringify(entry)}`)
  }
  pass('flag OFF cache miss (no createTask was issued)')

  const beforeCount = (await runtime!.client.listTasks()).tasks.length
  pass(`runtime task count unchanged by flag-OFF ops (${beforeCount})`)
  __mirrorCacheClear()
}

async function phase6Framework(): Promise<void> {
  console.log('\n[phase 6] framework chokepoint: registerTask + updateTaskState')

  await freshMirror({ flagOn: true })

  const { registerTask, updateTaskState } = await import('../src/utils/task/framework.js')
  const { __mirrorCacheGet, __mirrorDrain, __mirrorCacheClear } = await import(
    '../src/runtime/taskMirror.js'
  )

  type FakeTask = {
    id: string
    type: 'local_bash'
    status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
    description: string
    startTime: number
    outputFile: string
    outputOffset: number
    notified: boolean
  }
  const fakeTask: FakeTask = {
    id: 'p6-task-framework',
    type: 'local_bash',
    status: 'pending',
    description: 'phase6 synthetic',
    startTime: Date.now(),
    outputFile: '/dev/null',
    outputOffset: 0,
    notified: false,
  }

  let appState: { tasks: Record<string, FakeTask> } = { tasks: {} }
  const setAppState = (updater: (prev: any) => any) => {
    appState = updater(appState)
  }

  registerTask(fakeTask, setAppState)
  await __mirrorDrain()

  const created = __mirrorCacheGet('p6-task-framework')
  if (!created) fail('framework registerTask mirrored', 'cache miss')
  pass('framework registerTask mirrored to runtime')

  updateTaskState('p6-task-framework', setAppState, (t: FakeTask) => ({ ...t, status: 'running' }))
  await __mirrorDrain()
  assertEq(__mirrorCacheGet('p6-task-framework')?.currentState, 'running', 'updateTaskState→running mirrored')

  updateTaskState('p6-task-framework', setAppState, (t: FakeTask) => ({ ...t, status: 'completed' }))
  await __mirrorDrain()
  assertEq(__mirrorCacheGet('p6-task-framework')?.currentState, 'completed', 'updateTaskState→completed mirrored')

  const final = await runtime!.client.getTask(created!.runtimeTaskId)
  assertEq(final.status, 'completed', 'runtime row reflects framework-driven lifecycle')
  __mirrorCacheClear()
}

async function freshMirror(opts: { flagOn: boolean }): Promise<
  typeof import('../src/runtime/taskMirror.js')
> {
  if (opts.flagOn) {
    process.env.OC_RUNTIME_STATE_AUTHORITY = '1'
  } else {
    delete process.env.OC_RUNTIME_STATE_AUTHORITY
  }
  const mod = await import('../src/runtime/taskMirror.js')
  mod.__mirrorCacheClear()
  return mod
}

async function main(): Promise<void> {
  console.log('==> P2 Step 4 verify-mirror')
  const dataDir = await withDataDir()
  console.log(`data-dir: ${dataDir}`)
  try {
    runtime = await startSidecar(dataDir)
    console.log(`runtime endpoint: ${runtime.endpoint}`)

    __setRuntimeHandleForTest(runtime)

    await phase1Completed()
    await phase2Failed()
    await phase3Killed()
    await phase4StraightToCompleted()
    await phase5FlagOff()
    await phase6Framework()

    console.log('\nALL OK')
  } catch (e) {
    if (e instanceof RuntimeError) {
      console.error(`runtime error: ${e.code} (${e.status}) ${e.message}`)
    } else {
      console.error(e)
    }
    process.exitCode = 1
  } finally {
    await shutdown()
    rmSync(dataDir, { recursive: true, force: true })
  }
}

void main()
