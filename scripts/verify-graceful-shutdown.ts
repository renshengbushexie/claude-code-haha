import { spawn } from "node:child_process"
import { mkdtempSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"

const BUN = process.env.BUN_PATH ?? "D:\\opencode\\npm-global\\node_modules\\bun\\bin\\bun.exe"
const PORT = process.env.SERVER_PORT ?? "13457"
const dataDir = mkdtempSync(join(tmpdir(), "oc-runtime-sigterm-"))

console.log(`[test] dataDir=${dataDir} port=${PORT}`)

const child = spawn(
  BUN,
  ["run", "src/server/index.ts"],
  {
    env: { ...process.env, SERVER_PORT: PORT, OC_RUNTIME_DATA_DIR: dataDir },
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
)

const stdoutLines: string[] = []
const stderrLines: string[] = []
let sidecarReady = false

const consume = (stream: NodeJS.ReadableStream, sink: string[], tag: string) => {
  stream.setEncoding("utf8")
  stream.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line) continue
      sink.push(line)
      process.stderr.write(`[${tag}] ${line}\n`)
      if (line.includes("[runtime] sidecar ready")) sidecarReady = true
    }
  })
}
consume(child.stdout, stdoutLines, "srv-out")
consume(child.stderr, stderrLines, "srv-err")

let exitCode: number | null = null
let exitSignal: NodeJS.Signals | null = null
const exited = new Promise<void>((resolve) => {
  child.on("exit", (code, signal) => {
    exitCode = code
    exitSignal = signal
    resolve()
  })
})

const waitStart = Date.now()
while (!sidecarReady && Date.now() - waitStart < 20_000) {
  await delay(200)
}
if (!sidecarReady) {
  console.error("[test] FAIL: sidecar never ready in 20s")
  child.kill("SIGKILL")
  process.exit(1)
}
console.log(`[test] sidecar ready in ${Date.now() - waitStart}ms`)

const probe = await fetch(`http://127.0.0.1:${PORT}/health`).catch((e) => e as Error)
if (probe instanceof Error || probe.status !== 200) {
  console.error(`[test] FAIL: /health probe: ${probe instanceof Error ? probe.message : probe.status}`)
  child.kill("SIGKILL")
  process.exit(1)
}
console.log(`[test] /health=200`)

const endpointFile = join(dataDir, "runtime.endpoint")
const dbFile = join(dataDir, "runtime.db")
console.log(`[test] before SIGTERM: endpoint=${existsSync(endpointFile)} db=${existsSync(dbFile)}`)

console.log("[test] sending shutdown signal...")
let killSent: boolean | string
if (process.platform === "win32") {
  // Windows has no SIGTERM. The only way to deliver a graceful Ctrl+C to a
  // child process group is via Win32 AttachConsole + GenerateConsoleCtrlEvent.
  // taskkill /T without /F refuses to terminate the Bun child (it requires /F),
  // and /F is a hard kill that bypasses graceful shutdown handlers entirely.
  // We therefore shell out to a PowerShell one-liner that performs the same
  // FreeConsole / AttachConsole(pid) / GenerateConsoleCtrlEvent(CTRL_C, 0)
  // dance that scripts/verify-graceful-shutdown.ps1 uses.
  const { spawnSync } = await import("node:child_process")
  const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class CtrlSender {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool AttachConsole(uint dwProcessId);
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
}
"@
[CtrlSender]::FreeConsole() | Out-Null
$attached = [CtrlSender]::AttachConsole([uint32]${child.pid})
if (-not $attached) { Write-Error "AttachConsole failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 2 }
[CtrlSender]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
$sent = [CtrlSender]::GenerateConsoleCtrlEvent(0, 0)
if (-not $sent) { Write-Error "GenerateConsoleCtrlEvent failed: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 3 }
[CtrlSender]::FreeConsole() | Out-Null
[CtrlSender]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) | Out-Null
exit 0
`
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
    { encoding: "utf8" },
  )
  killSent = `ctrl-c via powershell exit=${r.status} stdout=${r.stdout?.trim()} stderr=${r.stderr?.trim()}`
} else {
  killSent = child.kill("SIGTERM")
}
console.log(`[test] signal sent: ${killSent}`)

const exitTimer = setTimeout(() => {
  console.error("[test] FAIL: no exit within 15s of SIGTERM")
  child.kill("SIGKILL")
  process.exit(1)
}, 15_000)
await exited
clearTimeout(exitTimer)

console.log(`[test] exit code=${exitCode} signal=${exitSignal}`)
const endpointAfter = existsSync(endpointFile)
console.log(`[test] after exit: endpoint=${endpointAfter}`)

const allOut = stdoutLines.concat(stderrLines).join("\n")
const checks: Array<[string, boolean]> = [
  ["graceful shutdown handler ran", /graceful|Graceful|Received SIG(INT|TERM)|shutting_down/.test(allOut)],
  ["runtime sidecar shutdown logged", /\[runtime\][^\n]*(shutdown|stopping|stopped|exit)/i.test(allOut)],
  ["runtime endpoint cleaned up", !endpointAfter],
  ["clean exit", exitCode === 0 || exitSignal === "SIGTERM"],
]

let pass = true
for (const [label, ok] of checks) {
  console.log(`[test] ${ok ? "PASS" : "FAIL"}: ${label}`)
  if (!ok) pass = false
}

try { rmSync(dataDir, { recursive: true, force: true }) } catch {}

if (pass) {
  console.log("[test] OVERALL PASS")
  process.exit(0)
} else {
  console.error("[test] OVERALL FAIL")
  process.exit(1)
}
