#Requires -Version 5.1
<#
.SYNOPSIS
  统一 CEF 下载入口。当前仅接 Windows 桌面链路。
#>
$ErrorActionPreference = 'Stop'
$isWindows = $env:OS -eq 'Windows_NT'

if (-not $isWindows) {
    throw 'scripts/entry/cef-download.ps1 currently supports Windows only; other platforms should use their own CEF/Chromium runtime setup scripts.'
}

& (Join-Path $PSScriptRoot '..\platforms\windows\setup\download-cef.ps1')
