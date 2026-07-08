#Requires -Version 5.1
<#
.SYNOPSIS
  统一 platform-core 前台调试入口。当前分发到 Windows 运行脚本。
#>
param(
    [switch]$Delve,
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$isWindows = $env:OS -eq 'Windows_NT'

if (-not $isWindows) {
    throw 'scripts/entry/dev-platform.ps1 currently supports Windows only; other platforms should use platforms/<os>/run/.'
}

& (Join-Path $PSScriptRoot '..\platforms\windows\run\dev-platform.ps1') `
    -Delve:$Delve `
    -SkipBuild:$SkipBuild
