#!/usr/bin/env bun
import { startRuntime } from '../src/runtime'

async function main() {
  process.stdout.write('starting go-runtime...\n')
  const handle = await startRuntime({
    dataDir: process.env.OC_RUNTIME_DATA_DIR,
    onStderr: (line) => process.stderr.write(`[runtime] ${line}\n`),
  })
  try {
    process.stdout.write(`endpoint: ${handle.endpoint}\n`)

    const health = await handle.client.health()
    process.stdout.write(`health: ${JSON.stringify(health)}\n`)

    const created = await handle.client.createTask({
      prompt: 'hello from ping script',
      cwd: process.cwd(),
    })
    process.stdout.write(`created: ${JSON.stringify(created)}\n`)

    const list = await handle.client.listTasks()
    process.stdout.write(`tasks: ${list.tasks.length}\n`)

    const fetched = await handle.client.getTask(created.id)
    process.stdout.write(`fetched: ${fetched.id} status=${fetched.status}\n`)

    process.stdout.write('OK\n')
  } finally {
    await handle.stop()
  }
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${(e as Error).message}\n`)
  process.exit(1)
})
