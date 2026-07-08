#Requires -Version 5.1
<#
.SYNOPSIS
  停止 BinDir 下的 niuma-* 服务进程，避免 stage/build 时 exe 被占用。
#>
param(
    [Parameter(Mandatory)]
    [string]$BinDir
)

$ErrorActionPreference = 'SilentlyContinue'

if (-not (Test-Path $BinDir)) {
    return
}

$binRoot = (Resolve-Path $BinDir).Path.TrimEnd('\')

foreach ($exe in Get-ChildItem -Path $BinDir -Filter 'niuma-*.exe') {
    $procName = $exe.Name
    foreach ($proc in Get-CimInstance Win32_Process -Filter "Name = '$procName'") {
        $path = $proc.ExecutablePath
        if (-not $path) { continue }
        if (-not $path.StartsWith($binRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
            continue
        }
        Write-Host "    stopping $procName (PID $($proc.ProcessId))" -ForegroundColor Gray
        Stop-Process -Id $proc.ProcessId -Force
    }
}

Start-Sleep -Milliseconds 300
