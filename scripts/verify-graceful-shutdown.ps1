$ErrorActionPreference = "Stop"
$bun = "D:\opencode\npm-global\node_modules\bun\bin\bun.exe"
$tmpDir = Join-Path $env:TEMP "oc-runtime-ctrlc-$(Get-Random)"
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
Write-Host "tmpDir=$tmpDir"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $bun
$psi.Arguments = "run src/server/index.ts"
$psi.WorkingDirectory = (Get-Location).Path
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $false
$psi.EnvironmentVariables["SERVER_PORT"] = "13458"
$psi.EnvironmentVariables["OC_RUNTIME_DATA_DIR"] = $tmpDir

$proc = [System.Diagnostics.Process]::Start($psi)
Write-Host "spawned pid=$($proc.Id)"

$outJob = Start-Job -ScriptBlock { param($p) $p.StandardOutput.ReadToEnd() } -ArgumentList $proc
$errJob = Start-Job -ScriptBlock { param($p) $p.StandardError.ReadToEnd() } -ArgumentList $proc

$endpointFile = Join-Path $tmpDir "runtime.endpoint"
$dbFile = Join-Path $tmpDir "runtime.db"
$ready = $false
for ($i = 0; $i -lt 100; $i++) {
  if (Test-Path $endpointFile) { $ready = $true; break }
  Start-Sleep -Milliseconds 200
}
Write-Host "endpointReady=$ready"

if (-not $ready) {
  $proc.Kill()
  Stop-Job $outJob,$errJob -ErrorAction SilentlyContinue
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

try {
  $health = (Invoke-WebRequest -Uri "http://127.0.0.1:13458/health" -UseBasicParsing -TimeoutSec 5).StatusCode
  Write-Host "health=$health"
} catch {
  Write-Host "health probe failed: $_"
}

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
$attached = [CtrlSender]::AttachConsole([uint32]$proc.Id)
$attErr = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
Write-Host "AttachConsole=$attached lastError=$attErr"

if ($attached) {
  [CtrlSender]::SetConsoleCtrlHandler([IntPtr]::Zero, $true) | Out-Null
  $sent = [CtrlSender]::GenerateConsoleCtrlEvent(0, 0)
  $sendErr = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
  Write-Host "GenerateConsoleCtrlEvent(CTRL_C, 0)=$sent lastError=$sendErr"
  [CtrlSender]::FreeConsole() | Out-Null
  [CtrlSender]::SetConsoleCtrlHandler([IntPtr]::Zero, $false) | Out-Null
}

$exited = $proc.WaitForExit(15000)
Write-Host "exited=$exited"
if ($exited) {
  Write-Host "exitCode=$($proc.ExitCode)"
} else {
  Write-Host "force killing"
  $proc.Kill()
}

Start-Sleep -Milliseconds 800
$stdout = Receive-Job -Job $outJob -ErrorAction SilentlyContinue
$stderr = Receive-Job -Job $errJob -ErrorAction SilentlyContinue
Stop-Job $outJob,$errJob -ErrorAction SilentlyContinue
Remove-Job $outJob,$errJob -ErrorAction SilentlyContinue

Write-Host "===== STDOUT ====="
Write-Host $stdout
Write-Host "===== STDERR ====="
Write-Host $stderr
Write-Host "===== POST-EXIT ====="
Write-Host "endpoint exists after exit: $(Test-Path $endpointFile)"

Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
