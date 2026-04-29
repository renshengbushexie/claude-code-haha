// Best-effort mirror of TS task lifecycle into the Go runtime / SQLite.
//
// Design contract (P2 Step 4, Mirror-only):
//   - TS remains the sole authority for UI task state. The Go runtime is a
//     parallel persistent record only — never read back into AppState.
//   - All entry points are fire-and-forget. They MUST NOT throw, MUST NOT
//     block the caller, and MUST NOT take dependencies on the runtime being
//     reachable. Failures degrade silently to a single console.warn.
//   - Behaviour is gated by OC_RUNTIME_STATE_AUTHORITY. With the flag OFF
//     (default) or with no runtime sidecar available, every entry point is
//     a no-op — byte-equivalent to the pre-Step-4 codepath.
//
// Status mapping TS(5) → Go(10):
//   pending    → pending      (initial state on createTask)
//   running    → pending → queued → running     (insert intermediate transitions)
//   completed  → ... → running → completed
//   failed     → ... → running → failed
//   killed     → cancelTask (idempotent; not modeled as a transition)
//
// The mirror keeps an in-memory map (localTaskId → { runtimeTaskId, currentState })
// because the Go transition RPC is CAS-on-current-state, so the `from` arg
// must reflect the runtime's truth, not the TS task's 5-state truth (which
// is missing the intermediate states the runtime requires).

import type { TaskState as GoTaskState, RuntimeClient } from './goClient.js'
import { RuntimeError } from './goClient.js'
import { getRuntimeClient } from '../server/runtimeSidecar.js'

type TsTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'

const FLAG_ENV = 'OC_RUNTIME_STATE_AUTHORITY'

interface MirrorEntry {
  runtimeTaskId: string
  currentState: GoTaskState
}
const cache = new Map<string, MirrorEntry>()

const taskQueues = new Map<string, Promise<void>>()

function enqueue(localTaskId: string, op: () => Promise<void>): void {
  const prev = taskQueues.get(localTaskId) ?? Promise.resolve()
  const next = prev.then(op, op)
  taskQueues.set(localTaskId, next)
  void next.finally(() => {
    if (taskQueues.get(localTaskId) === next) {
      taskQueues.delete(localTaskId)
    }
  })
}

function isFlagOn(): boolean {
  const raw = process.env[FLAG_ENV]
  if (!raw) return false
  switch (raw.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true
    default:
      return false
  }
}

function warn(msg: string, err?: unknown): void {
  if (err instanceof RuntimeError) {
    console.warn(`[runtime-mirror] ${msg}: ${err.code} ${err.message}`)
    return
  }
  if (err instanceof Error) {
    console.warn(`[runtime-mirror] ${msg}: ${err.message}`)
    return
  }
  if (err !== undefined) {
    console.warn(`[runtime-mirror] ${msg}: ${String(err)}`)
    return
  }
  console.warn(`[runtime-mirror] ${msg}`)
}

export interface MirrorCreateInput {
  localTaskId: string
  prompt: string
  cwd?: string
}

/**
 * Mirror task creation into the Go runtime. Fire-and-forget.
 * Records the new runtime task id and 'pending' state in the cache so later
 * transitions know the correct `from` state.
 */
export function mirrorTaskCreated(input: MirrorCreateInput): void {
  if (!isFlagOn()) return
  if (cache.has(input.localTaskId)) return

  enqueue(input.localTaskId, async () => {
    if (cache.has(input.localTaskId)) return
    let client: RuntimeClient | null
    try {
      client = await getRuntimeClient()
    } catch (e) {
      warn(`getRuntimeClient failed for ${input.localTaskId}`, e)
      return
    }
    if (!client) return

    try {
      const created = await client.createTask({
        prompt: input.prompt,
        cwd: input.cwd ?? process.cwd(),
      })
      if (cache.has(input.localTaskId)) return
      cache.set(input.localTaskId, {
        runtimeTaskId: created.id,
        currentState: created.status,
      })
    } catch (e) {
      warn(`createTask failed for ${input.localTaskId}`, e)
    }
  })
}

/**
 * Mirror a TS-side status change into the Go runtime. Fire-and-forget.
 * Translates the TS 5-state delta into the appropriate Go 10-state CAS
 * transitions (or cancelTask for 'killed').
 */
export function mirrorTaskTransition(
  localTaskId: string,
  next: TsTaskStatus,
  reason?: string,
): void {
  if (!isFlagOn()) return
  if (next === 'killed') {
    mirrorTaskKilled(localTaskId, reason)
    return
  }
  if (next === 'pending') return

  enqueue(localTaskId, async () => {
    let client: RuntimeClient | null
    try {
      client = await getRuntimeClient()
    } catch (e) {
      warn(`getRuntimeClient failed for ${localTaskId}`, e)
      return
    }
    if (!client) return

    const entry = cache.get(localTaskId)
    if (!entry) return

    const targets: GoTaskState[] = []
    if (next === 'running') {
      if (entry.currentState === 'pending') {
        targets.push('queued', 'running')
      } else if (entry.currentState === 'queued') {
        targets.push('running')
      }
    } else if (next === 'completed') {
      if (entry.currentState === 'pending') targets.push('queued', 'running')
      else if (entry.currentState === 'queued') targets.push('running')
      targets.push('completed')
    } else if (next === 'failed') {
      if (entry.currentState === 'pending') targets.push('queued', 'running')
      else if (entry.currentState === 'queued') targets.push('running')
      targets.push('failed')
    }

    for (const to of targets) {
      const from = entry.currentState
      if (from === to) continue
      try {
        const updated = await client.transitionTask(
          entry.runtimeTaskId,
          from,
          to,
          to === 'failed' ? reason ?? 'task failed' : reason,
        )
        entry.currentState = updated.status
      } catch (e) {
        warn(`transitionTask ${from}→${to} failed for ${localTaskId}`, e)
        return
      }
    }
  })
}

/**
 * Mirror a kill into the Go runtime via the idempotent cancel RPC.
 * Fire-and-forget. Safe to call multiple times.
 */
export function mirrorTaskKilled(localTaskId: string, reason?: string): void {
  if (!isFlagOn()) return

  enqueue(localTaskId, async () => {
    let client: RuntimeClient | null
    try {
      client = await getRuntimeClient()
    } catch (e) {
      warn(`getRuntimeClient failed for ${localTaskId}`, e)
      return
    }
    if (!client) return

    const entry = cache.get(localTaskId)
    if (!entry) return

    try {
      const updated = await client.cancelTask(entry.runtimeTaskId, reason)
      entry.currentState = updated.status
    } catch (e) {
      warn(`cancelTask failed for ${localTaskId}`, e)
    }
  })
}

// --- Test-only helpers (verify-mirror script + unit tests).

export function __mirrorCacheGet(localTaskId: string):
  | { runtimeTaskId: string; currentState: GoTaskState }
  | undefined {
  const e = cache.get(localTaskId)
  return e ? { runtimeTaskId: e.runtimeTaskId, currentState: e.currentState } : undefined
}

export function __mirrorCacheClear(): void {
  cache.clear()
  taskQueues.clear()
}

/**
 * Block until in-flight mirror operations have settled. Verify scripts use
 * this for deterministic assertions; production code never calls this.
 * Polls the cache until it stabilises across three 25 ms ticks (or timeout).
 */
export async function __mirrorDrain(timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (taskQueues.size > 0 && Date.now() < deadline) {
    await Promise.race([
      Promise.allSettled([...taskQueues.values()]),
      new Promise((r) => setTimeout(r, 50)),
    ])
  }
  let lastSnapshot = ''
  let stableTicks = 0
  while (Date.now() < deadline) {
    const snapshot = JSON.stringify(
      [...cache.entries()].map(([k, v]) => [k, v.currentState]).sort(),
    )
    if (snapshot === lastSnapshot) {
      stableTicks++
      if (stableTicks >= 3) return
    } else {
      stableTicks = 0
      lastSnapshot = snapshot
    }
    await new Promise((r) => setTimeout(r, 25))
  }
}
