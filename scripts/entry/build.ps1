#Requires -Version 5.1
<#
.SYNOPSIS
  统一构建入口。通用服务构建走 shared，壳构建走平台脚本。
#>
param(
    [ValidateSet('shell', 'services')]
    [string]$Target,

    [ValidateSet('windows', 'linux', 'kylin', 'macos')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'
$isWindows = $env:OS -eq 'Windows_NT'

if ($isWindows) {
    . (Join-Path $PSScriptRoot '..\shared\lib\matrix.ps1')
    Assert-NativeMatrix -Platform $Platform -Arch $Arch
}

switch ($Target) {
    'services' {
        if (-not $isWindows -and $Platform -ne 'windows') {
            throw "Cross-platform service build from PowerShell is disabled. Use: bash scripts/entry/build.sh --target services --platform $Platform --arch $Arch"
        }
        if ($isWindows -and $Platform -ne 'windows') {
            throw "Cross-platform service build is disabled. Build services on the target OS (or Linux container) with bash scripts/entry/build.sh"
        }
        & (Join-Path $PSScriptRoot '..\shared\build\build-services.ps1') `
            -Platform $Platform `
            -Arch $Arch `
            -Configuration $Configuration
    }
    'shell' {
        if (-not $isWindows) {
                throw 'scripts/entry/build.ps1 -Target shell currently supports Windows only; other platforms should use platforms/<os>/build/.'
        }
        & (Join-Path $PSScriptRoot '..\platforms\windows\build\build-shell.ps1') `
            -Platform $Platform `
            -Arch $Arch `
            -Configuration $Configuration
    }
}
