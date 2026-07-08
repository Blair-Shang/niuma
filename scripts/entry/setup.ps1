#Requires -Version 5.1
<#
.SYNOPSIS
  统一环境准备入口。按平台分发到对应 setup 脚本。
#>
$ErrorActionPreference = 'Stop'
$isWindows = $env:OS -eq 'Windows_NT'
$platformScript = Join-Path $PSScriptRoot '..\platforms\windows\setup\setup-desktop.ps1'

if (-not $isWindows) {
    throw 'scripts/entry/setup.ps1 currently supports Windows only; Linux/macOS/Kylin should use platforms/<os>/setup/.'
}

& $platformScript
