#Requires -Version 5.1
<#
.SYNOPSIS
  通用服务构建入口。构建 Layer-1/2 能力服务二进制到 services/bin/。
#>
param(
    [ValidateSet('windows', 'linux', 'kylin', 'macos')]
    [string]$Platform = 'windows',

    [ValidateSet('x64', 'arm64')]
    [string]$Arch = 'x64',

    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)

$ErrorActionPreference = 'Stop'

try {
    chcp 65001 | Out-Null
} catch {
    # ignore
}
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
. (Join-Path $Root 'scripts\shared\lib\version.ps1')
. (Join-Path $Root 'scripts\shared\lib\matrix.ps1')
$BinDir = Join-Path $Root 'services/bin'
$TargetBinDir = Join-Path $BinDir "$Platform-$Arch"
Assert-NativeMatrix -Platform $Platform -Arch $Arch
Invoke-EmitBuildInfo -RepoRoot $Root | Out-Null
$Ldflags = Get-GoVersionLdflags -RepoRoot $Root -Configuration $Configuration
$StopScript = Join-Path $PSScriptRoot '..\tasks\stop-services.ps1'

if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}
if (-not (Test-Path $TargetBinDir)) {
    New-Item -ItemType Directory -Path $TargetBinDir -Force | Out-Null
}

function Get-GoTarget {
    param(
        [string]$PlatformName,
        [string]$ArchName
    )
    $goos = switch ($PlatformName) {
        'windows' { 'windows' }
        'linux' { 'linux' }
        'kylin' { 'linux' }
        'macos' { 'darwin' }
    }
    $goarch = switch ($ArchName) {
        'x64' { 'amd64' }
        'arm64' { 'arm64' }
    }
    return @{
        GOOS = $goos
        GOARCH = $goarch
    }
}

function Get-RustTargetTriple {
    param(
        [string]$PlatformName,
        [string]$ArchName
    )
    switch ("$PlatformName/$ArchName") {
        'windows/x64' { return 'x86_64-pc-windows-msvc' }
        'windows/arm64' { return 'aarch64-pc-windows-msvc' }
        'linux/x64' { return 'x86_64-unknown-linux-gnu' }
        'linux/arm64' { return 'aarch64-unknown-linux-gnu' }
        'kylin/x64' { return 'x86_64-unknown-linux-gnu' }
        'kylin/arm64' { return 'aarch64-unknown-linux-gnu' }
        'macos/x64' { return 'x86_64-apple-darwin' }
        'macos/arm64' { return 'aarch64-apple-darwin' }
        default { throw "unsupported rust target: $PlatformName/$ArchName" }
    }
}

function Get-BinaryName {
    param(
        [string]$BaseName,
        [string]$PlatformName
    )
    if ($PlatformName -eq 'windows') {
        return "$BaseName.exe"
    }
    return $BaseName
}

function Get-HostArch {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { return 'x64' }
    }
}

function Should-SyncLegacyBin {
    return ($Platform -eq 'windows' -and $Arch -eq (Get-HostArch))
}

function Initialize-RustToolchain {
    $cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
    if (-not (Test-Path $cargoBin)) {
        return
    }
    $segments = $env:Path -split ';' | Where-Object { $_ -and $_.Trim() -ne '' }
    if ($segments -notcontains $cargoBin) {
        $env:Path = "$cargoBin;$env:Path"
    }
}

function Resolve-CargoExe {
    Initialize-RustToolchain
    $cmd = Get-Command cargo -ErrorAction SilentlyContinue
    if ($cmd) {
        return $cmd.Source
    }
    $homeCargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
    if (Test-Path $homeCargo) {
        return $homeCargo
    }
    return $null
}

function Try-StageExistingRustBinary {
    param(
        [string]$CrateDir,
        [string]$BinName,
        [string]$Output,
        [string]$PlatformName,
        [string]$ArchName,
        [string]$BuildConfiguration
    )
    $profile = if ($BuildConfiguration -eq 'Release') { 'release' } else { 'debug' }
    $targetTriple = Get-RustTargetTriple -PlatformName $PlatformName -ArchName $ArchName
    $fileName = Get-BinaryName -BaseName $BinName -PlatformName $PlatformName
    $candidates = @(
        (Join-Path $CrateDir "target/$targetTriple/$profile/$fileName")
        (Join-Path $CrateDir "target/$profile/$fileName")
    )
    foreach ($candidate in $candidates) {
        if (-not (Test-Path $candidate)) {
            continue
        }
        Copy-Item -Force $candidate $Output
        Write-Host "==> staged existing $BinName from $candidate" -ForegroundColor Yellow
        return $true
    }
    return $false
}

if (Should-SyncLegacyBin) {
    & $StopScript -BinDir $BinDir
}

function Build-GoService {
    param(
        [string]$ModuleDir,
        [string]$Package,
        [string]$Output
    )
    $target = Get-GoTarget -PlatformName $Platform -ArchName $Arch
    Write-Host "==> go build $Package -> $Output ($($target.GOOS)/$($target.GOARCH))" -ForegroundColor Cyan
    Push-Location $ModuleDir
    try {
        $args = @('build', '-ldflags', $Ldflags, '-o', $Output, $Package)
        $oldGoos = $env:GOOS
        $oldGoarch = $env:GOARCH
        $env:GOOS = $target.GOOS
        $env:GOARCH = $target.GOARCH
        try {
            & go @args
        } finally {
            $env:GOOS = $oldGoos
            $env:GOARCH = $oldGoarch
        }
        if ($LASTEXITCODE -ne 0) {
            throw "go build failed ($LASTEXITCODE): $Package"
        }
    } finally {
        Pop-Location
    }
}

function Build-RustService {
    param(
        [string]$CrateDir,
        [string]$BinName,
        [string]$Output
    )
    $cargoExe = Resolve-CargoExe
    if (-not $cargoExe) {
        if (Try-StageExistingRustBinary -CrateDir $CrateDir -BinName $BinName -Output $Output `
                -PlatformName $Platform -ArchName $Arch -BuildConfiguration $Configuration) {
            return $true
        }
        Write-Host "==> skip $BinName (cargo not found - install Rust: https://rustup.rs)" -ForegroundColor Yellow
        return $false
    }
    $targetTriple = Get-RustTargetTriple -PlatformName $Platform -ArchName $Arch
    Write-Host "==> cargo build $BinName -> $Output ($targetTriple)" -ForegroundColor Cyan
    Push-Location $CrateDir
    try {
        $cargoArgs = @('build', '--target', $targetTriple)
        if ($Configuration -eq 'Release') {
            $cargoArgs += '--release'
        }
        $info = Get-BuildInfo -RepoRoot $Root
    $env:NIUMMA_APP_VERSION = [string]$info.version
    $env:NIUMMA_BUILD_ID = [string]$info.buildId
    & $cargoExe @cargoArgs
        if ($LASTEXITCODE -ne 0) {
            throw "cargo build failed ($LASTEXITCODE): $BinName"
        }
        $profile = if ($Configuration -eq 'Release') { 'release' } else { 'debug' }
        $built = Join-Path $CrateDir "target/$targetTriple/$profile/$(Get-BinaryName -BaseName $BinName -PlatformName $Platform)"
        if (-not (Test-Path $built)) {
            throw "cargo output not found: $built"
        }
        Copy-Item -Force $built $Output
        return $true
    } finally {
        Pop-Location
    }
}

$platformOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'niuma-platform-core' -PlatformName $Platform)
$ftpOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'niuma-ftp-service' -PlatformName $Platform)
$sshOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'niuma-ssh-service' -PlatformName $Platform)
$redisOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'niuma-redis-service' -PlatformName $Platform)
$mongoOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'niuma-mongodb-service' -PlatformName $Platform)
$vastbaseOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'niuma-vastbase-service' -PlatformName $Platform)
$mysqlOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'niuma-mysql-service' -PlatformName $Platform)
$mcpVastOut = Join-Path $TargetBinDir (Get-BinaryName -BaseName 'mcp-vastbase-readonly' -PlatformName $Platform)

$MigrateDir = Join-Path $Root 'platform/internal/migrate'
Write-Host "==> go generate (sync SQL migrations)" -ForegroundColor Cyan
Push-Location $MigrateDir
try {
    & go generate ./...
    if ($LASTEXITCODE -ne 0) {
        throw "go generate failed ($LASTEXITCODE): migrate"
    }
} finally {
    Pop-Location
}

Build-GoService -ModuleDir (Join-Path $Root 'platform') `
    -Package './cmd/platform-core' `
    -Output $platformOut

Build-GoService -ModuleDir (Join-Path $Root 'services/ftp-service') `
    -Package './cmd/ftp-service' `
    -Output $ftpOut

Build-GoService -ModuleDir (Join-Path $Root 'services/mongodb-service') `
    -Package './cmd/mongodb-service' `
    -Output $mongoOut

Build-GoService -ModuleDir (Join-Path $Root 'services/vastbase-service') `
    -Package './cmd/vastbase-service' `
    -Output $vastbaseOut

Build-GoService -ModuleDir (Join-Path $Root 'services/mysql-service') `
    -Package './cmd/mysql-service' `
    -Output $mysqlOut

Build-GoService -ModuleDir (Join-Path $Root 'services/mcp-vastbase-readonly') `
    -Package '.' `
    -Output $mcpVastOut

$sshBuilt = Build-RustService -CrateDir (Join-Path $Root 'services/ssh-service') `
    -BinName 'niuma-ssh-service' `
    -Output $sshOut

$redisBuilt = Build-RustService -CrateDir (Join-Path $Root 'services/redis-service') `
    -BinName 'niuma-redis-service' `
    -Output $redisOut

if (Should-SyncLegacyBin) {
    $legacyPlatformOut = Join-Path $BinDir 'niuma-platform-core.exe'
    $legacyFtpOut = Join-Path $BinDir 'niuma-ftp-service.exe'
    $legacySshOut = Join-Path $BinDir 'niuma-ssh-service.exe'
    $legacyRedisOut = Join-Path $BinDir 'niuma-redis-service.exe'
    $legacyMongoOut = Join-Path $BinDir 'niuma-mongodb-service.exe'
    $legacyVastbaseOut = Join-Path $BinDir 'niuma-vastbase-service.exe'
    $legacyMysqlOut = Join-Path $BinDir 'niuma-mysql-service.exe'
    $legacyMcpVastOut = Join-Path $BinDir 'mcp-vastbase-readonly.exe'
    Copy-Item -Force $platformOut $legacyPlatformOut
    Copy-Item -Force $ftpOut $legacyFtpOut
    Copy-Item -Force $mongoOut $legacyMongoOut
    Copy-Item -Force $vastbaseOut $legacyVastbaseOut
    Copy-Item -Force $mysqlOut $legacyMysqlOut
    Copy-Item -Force $mcpVastOut $legacyMcpVastOut
    if ($sshBuilt -and (Test-Path $sshOut)) {
        Copy-Item -Force $sshOut $legacySshOut
    }
    if ($redisBuilt -and (Test-Path $redisOut)) {
        Copy-Item -Force $redisOut $legacyRedisOut
    }
}

Write-Host "==> services ready for ${Platform}/${Arch}:" -ForegroundColor Green
Write-Host "    $platformOut"
Write-Host "    $ftpOut"
Write-Host "    $mongoOut"
Write-Host "    $vastbaseOut"
Write-Host "    $mcpVastOut"
if ($sshBuilt -and (Test-Path $sshOut)) {
    Write-Host "    $sshOut"
} elseif (Test-Path $sshOut) {
    Write-Host "    $sshOut (existing file, not rebuilt in this run)" -ForegroundColor Yellow
}
if ($redisBuilt -and (Test-Path $redisOut)) {
    Write-Host "    $redisOut"
} elseif (Test-Path $redisOut) {
    Write-Host "    $redisOut (existing file, not rebuilt in this run)" -ForegroundColor Yellow
}
if (Should-SyncLegacyBin) {
    Write-Host "==> legacy flat bin synced for current Windows host: $BinDir" -ForegroundColor DarkGray
}
