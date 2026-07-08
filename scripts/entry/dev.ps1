#Requires -Version 5.1
<#
.SYNOPSIS
  统一开发入口。按平台分发到对应运行脚本。
#>
param(
    [switch]$SkipSetup,
    [switch]$HotReload,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [switch]$SkipServices,
    [switch]$SkipShellBuild
)

$ErrorActionPreference = 'Stop'
$isWindows = $env:OS -eq 'Windows_NT'
$platformScript = Join-Path $PSScriptRoot '..\platforms\windows\run\dev.ps1'

if (-not $isWindows) {
    throw 'scripts/entry/dev.ps1 currently supports Windows only; Linux/macOS/Kylin should use platforms/<os>/run/.'
}

& $platformScript `
    -SkipSetup:$SkipSetup `
    -HotReload:$HotReload `
    -Configuration $Configuration `
    -SkipServices:$SkipServices `
    -SkipShellBuild:$SkipShellBuild
