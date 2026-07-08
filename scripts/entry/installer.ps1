#Requires -Version 5.1
<#
.SYNOPSIS
  Windows 安装程序构建入口（Inno Setup Setup.exe）。
#>
param(
    [ValidateSet('windows')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [string]$InputDir = '',
    [string]$OutputDir = ''
)

$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot '..\platforms\windows\pack\build-installer.ps1') `
    -Platform $Platform `
    -Arch $Arch `
    -InputDir $InputDir `
    -OutputDir $OutputDir
