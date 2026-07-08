#Requires -Version 5.1
<#
.SYNOPSIS
  统一打包入口。按平台分发到对应 pack 脚本。
#>
param(
    [ValidateSet('windows', 'linux', 'kylin', 'macos')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',
    [string]$OutputDir = '',
    [switch]$SkipWebBuild,
    [switch]$SkipShellBuild
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot '..\shared\lib\matrix.ps1')
Assert-NativeMatrix -Platform $Platform -Arch $Arch

switch ($Platform) {
    'windows' {
        & (Join-Path $PSScriptRoot '..\platforms\windows\pack\bundle-windows.ps1') `
            -Platform $Platform `
            -Arch $Arch `
            -Configuration $Configuration `
            -OutputDir $OutputDir `
            -SkipWebBuild:$SkipWebBuild `
            -SkipShellBuild:$SkipShellBuild
    }
    default {
        throw "scripts/entry/pack.ps1 does not support $Platform yet; use scripts/entry/pack.sh on Unix hosts."
    }
}
