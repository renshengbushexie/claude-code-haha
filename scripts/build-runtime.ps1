$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (!(Test-Path bin)) { New-Item -ItemType Directory bin | Out-Null }
Write-Host 'building go-runtime...'
Push-Location go-runtime
try {
    & go build -o ..\bin\oc-runtime.exe .\cmd\runtime
    if ($LASTEXITCODE -ne 0) { throw "go build failed" }
} finally {
    Pop-Location
}
Write-Host 'ok: bin\oc-runtime.exe'
