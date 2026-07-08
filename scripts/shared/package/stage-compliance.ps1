#Requires -Version 5.1
<#
.SYNOPSIS
  将商用合规文件（CEF 许可、第三方声明、版本清单）复制到发布目录。
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$DestDir,

    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
}

if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Force -Path $DestDir | Out-Null
}

$licensesDir = Join-Path $DestDir 'licenses'
New-Item -ItemType Directory -Force -Path $licensesDir | Out-Null

$cefLicense = Join-Path $RepoRoot 'third_party/cef/LICENSE.txt'
if (Test-Path $cefLicense) {
    Copy-Item -Force $cefLicense (Join-Path $licensesDir 'CEF-LICENSE.txt')
}

$cefReadme = Join-Path $RepoRoot 'third_party/cef/README.txt'
if (Test-Path $cefReadme) {
    Copy-Item -Force $cefReadme (Join-Path $licensesDir 'CEF-README.txt')
}

$notices = Join-Path $RepoRoot 'docs/compliance/NOTICES.txt'
if (Test-Path $notices) {
    Copy-Item -Force $notices (Join-Path $licensesDir 'NOTICES.txt')
}

$versionManifest = Join-Path $RepoRoot 'build/version.json'
if (Test-Path $versionManifest) {
    Copy-Item -Force $versionManifest (Join-Path $DestDir 'version.json')
}

Write-Host "==> compliance files staged -> $licensesDir" -ForegroundColor Cyan
