#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
. (Join-Path $Root 'scripts\shared\lib\version.ps1')
$info = Invoke-EmitBuildInfo -RepoRoot $Root
Write-Host "version=$($info.version) buildId=$($info.buildId)" -ForegroundColor Green
