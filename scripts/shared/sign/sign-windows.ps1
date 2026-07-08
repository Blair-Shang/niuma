#Requires -Version 5.1
<#
.SYNOPSIS
  可选 Authenticode 签名（Setup.exe / niuma.exe）。

  环境变量：
    SIGNTOOL_PATH   - signtool.exe 路径（默认从 Windows SDK 查找）
    CODESIGN_CERT   - 证书指纹或主题名（/sha1 或 /n）
    CODESIGN_TS_URL - 时间戳 URL（默认 http://timestamp.digicert.com）
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $FilePath)) {
    throw "file not found: $FilePath"
}
if (-not $env:CODESIGN_CERT) {
    Write-Host "==> skip Authenticode (CODESIGN_CERT not set): $FilePath" -ForegroundColor DarkGray
    return
}

function Find-SignTool {
    if ($env:SIGNTOOL_PATH -and (Test-Path $env:SIGNTOOL_PATH)) {
        return $env:SIGNTOOL_PATH
    }
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $kits) {
        $latest = Get-ChildItem $kits -Directory | Sort-Object Name -Descending | Select-Object -First 1
        if ($latest) {
            foreach ($arch in @('x64', 'x86')) {
                $candidate = Join-Path $latest.FullName "$arch\signtool.exe"
                if (Test-Path $candidate) { return $candidate }
            }
        }
    }
    return $null
}

$signtool = Find-SignTool
if (-not $signtool) {
    throw 'signtool.exe not found. Set SIGNTOOL_PATH or install Windows SDK.'
}

$tsUrl = if ($env:CODESIGN_TS_URL) { $env:CODESIGN_TS_URL } else { 'http://timestamp.digicert.com' }
$cert = $env:CODESIGN_CERT
$certArg = if ($cert -match '^[0-9A-Fa-f]{40}$') { "/sha1 $cert" } else { "/n `"$cert`"" }

Write-Host "==> Authenticode sign: $FilePath" -ForegroundColor Cyan
& $signtool sign /fd SHA256 /tr $tsUrl /td SHA256 $certArg $FilePath
if ($LASTEXITCODE -ne 0) {
    throw "signtool failed ($LASTEXITCODE)"
}
