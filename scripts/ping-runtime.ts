#!/usr/bin/env bun
import { RuntimeError, startRuntime, type Task } from '../src/runtime'

function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`expectation failed: ${msg}`)
}

async function expectError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p
  } catch (e) {
    if (e instanceof RuntimeError && e.code === code) return
    throw new Error(`expected RuntimeError(code=${code}), got ${String(e)}`)
  }
  throw new Error(`expected RuntimeError(code=${code}), call resolved`)
}

async function main() {
  const dataDir = process.env.OC_RUNTIME_DATA_DIR
  process.stdout.write('=== phase 1: start runtime, full transition lifecycle ===\n')
  const handle = await startRuntime({
    dataDir,
    onStderr: (line) => process.stderr.write(`[runtime] ${line}\n`),
  })
  let createdId: string
  try {
    process.stdout.write(`endpoint: ${handle.endpoint}\n`)

    const health = await handle.client.health()
    process.stdout.write(`health: v${health.version} pid=${health.pid}\n`)

    const created = await handle.client.createTask({
      prompt: 'lifecycle test',
      cwd: process.cwd(),
    })
    createdId = created.id
    expect(created.status === 'pending', `new task status=${created.status}`)
    process.stdout.write(`created: ${created.id}\n`)

    const t1 = await handle.client.transitionTask(created.id, 'pending', 'queued')
    expect(t1.status === 'queued', `after pending->queued: ${t1.status}`)

    const t2 = await handle.client.transitionTask(created.id, 'queued', 'running')
    expect(t2.status === 'running', `after queued->running: ${t2.status}`)
    expect(t2.started_at != null, 'started_at should be set on running')

    await expectError(
      handle.client.transitionTask(created.id, 'queued', 'running'),
      'state_mismatch',
    )

    await expectError(
      handle.client.transitionTask(created.id, 'running', 'pending'),
      'illegal_transition',
    )

    const t3 = await handle.client.transitionTask(created.id, 'running', 'completed', 'all good')
    expect(t3.status === 'completed', `after running->completed: ${t3.status}`)
    expect(t3.finished_at != null, 'finished_at should be set on completed')

    await expectError(
      handle.client.cancelTask(created.id),
      'illegal_transition',
    )

    const transitions = await handle.client.getTaskTransitions(created.id)
    expect(transitions.length === 3, `transitions count=${transitions.length}`)
    expect(transitions[0]!.from === 'pending' && transitions[0]!.to === 'queued', 'tr[0]')
    expect(transitions[2]!.reason === 'all good', 'reason propagated')

    process.stdout.write(`transitions: ${transitions.length} recorded\n`)
    process.stdout.write('phase 1 OK\n')
  } finally {
    await handle.stop()
  }

  process.stdout.write('=== phase 2: cancel from pending + idempotency ===\n')
  const h2 = await startRuntime({
    dataDir,
    onStderr: (line) => process.stderr.write(`[runtime] ${line}\n`),
  })
  let cancelledId: string
  try {
    const tk = await h2.client.createTask({ prompt: 'cancel test', cwd: process.cwd() })
    cancelledId = tk.id
    const c1 = await h2.client.cancelTask(tk.id, 'user')
    expect(c1.status === 'cancelled', `c1=${c1.status}`)
    const c2 = await h2.client.cancelTask(tk.id)
    expect(c2.status === 'cancelled', `c2=${c2.status} (idempotent)`)
    process.stdout.write(`cancelled twice OK: ${tk.id}\n`)
  } finally {
    await h2.stop()
  }

  process.stdout.write('=== phase 3: SQLite state survives restart ===\n')
  const h3 = await startRuntime({
    dataDir,
    onStderr: (line) => process.stderr.write(`[runtime] ${line}\n`),
  })
  try {
    const recovered: Task = await h3.client.getTask(createdId!)
    expect(recovered.status === 'completed', `recovered status=${recovered.status}`)
    expect(recovered.last_error == null, 'completed task has no error')

    const cancelled: Task = await h3.client.getTask(cancelledId!)
    expect(cancelled.status === 'cancelled', `cancelled survived: ${cancelled.status}`)

    const trAgain = await h3.client.getTaskTransitions(createdId!)
    expect(trAgain.length === 3, `transitions survived: ${trAgain.length}`)
    process.stdout.write(`recovered ${createdId} status=${recovered.status} transitions=${trAgain.length}\n`)
    process.stdout.write(`recovered ${cancelledId} status=${cancelled.status}\n`)
  } finally {
    await h3.stop()
  }

  process.stdout.write('ALL OK\n')
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${(e as Error).message}\n`)
  process.exit(1)
})
