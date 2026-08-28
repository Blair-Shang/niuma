#Requires -Version 5.1
<#
.SYNOPSIS
  Import Authenticode PFX for GitHub Actions (optional).

  Secrets:
    WINDOWS_PFX_BASE64   - PKCS#12 file encoded as Base64
    WINDOWS_PFX_PASSWORD - PFX password

  Sets CODESIGN_CERT to the certificate thumbprint via GITHUB_ENV
  so subsequent pack:win:setup can call scripts/shared/sign/sign-windows.ps1.
#>
$ErrorActionPreference = 'Stop'

if (-not $env:WINDOWS_PFX_BASE64) {
    Write-Host '==> skip Authenticode import (WINDOWS_PFX_BASE64 not set)' -ForegroundColor DarkGray
    exit 0
}

$tempPfx = Join-Path $env:RUNNER_TEMP 'niuma-codesign.pfx'
$bytes = [Convert]::FromBase64String($env:WINDOWS_PFX_BASE64)
[System.IO.File]::WriteAllBytes($tempPfx, $bytes)

$password = $null
$secure = $null
if ($env:WINDOWS_PFX_PASSWORD) {
    $secure = ConvertTo-SecureString $env:WINDOWS_PFX_PASSWORD -AsPlainText -Force
}

$cert = Import-PfxCertificate -FilePath $tempPfx -CertStoreLocation 'Cert:\CurrentUser\My' -Password $secure
Remove-Item -Force $tempPfx -ErrorAction SilentlyContinue
if ($password) { $password = $null }

if (-not $cert -or -not $cert.Thumbprint) {
    throw 'failed to import WINDOWS_PFX_BASE64 into CurrentUser\My'
}

$thumb = $cert.Thumbprint
Write-Host "==> imported Authenticode cert thumbprint=$thumb" -ForegroundColor Cyan
if ($env:GITHUB_ENV) {
    Add-Content -Path $env:GITHUB_ENV -Value "CODESIGN_CERT=$thumb" -Encoding utf8
}
$env:CODESIGN_CERT = $thumb
