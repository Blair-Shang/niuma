#Requires -Version 5.1
<#
  构建矩阵路径约定（shell / pack / services）。
#>

function Get-MatrixHostArch {
    switch ($env:PROCESSOR_ARCHITECTURE) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { return 'x64' }
    }
}

function Get-MatrixHostPlatform {
    if ($env:OS -eq 'Windows_NT') {
        return 'windows'
    }
    throw 'Get-MatrixHostPlatform is for Windows hosts only; use bash entry scripts on Linux/macOS.'
}

function Assert-NativeMatrix {
    param(
        [string]$Platform,
        [string]$Arch
    )
    if ($env:OS -ne 'Windows_NT') {
        throw 'Assert-NativeMatrix on Windows only; use bash scripts on Unix hosts.'
    }
    $hostPlatform = Get-MatrixHostPlatform
    $hostArch = Get-MatrixHostArch
    if ($Platform -ne $hostPlatform -or $Arch -ne $hostArch) {
        throw "native build only: requested $Platform/$Arch but host is $hostPlatform/$hostArch"
    }
}

function Get-ServicesBinDir {
    param(
        [string]$RepoRoot,
        [string]$Platform,
        [string]$Arch
    )
    Join-Path $RepoRoot "services/bin/$Platform-$Arch"
}

function Get-ShellBuildDir {
    param(
        [string]$RepoRoot,
        [string]$Platform,
        [string]$Arch
    )
    Join-Path $RepoRoot "build/shell-$Platform-$Arch"
}

function Get-ShellExePath {
    param(
        [string]$RepoRoot,
        [string]$Platform,
        [string]$Arch,
        [string]$Configuration = 'Release'
    )
    $buildDir = Get-ShellBuildDir -RepoRoot $RepoRoot -Platform $Platform -Arch $Arch
    if ($Platform -eq 'windows') {
        return Join-Path $buildDir "$Configuration/niuma.exe"
    }
    $configLower = $Configuration.ToLowerInvariant()
    foreach ($candidate in @(
            (Join-Path $buildDir 'niuma')
            (Join-Path $buildDir "$configLower/niuma")
        )) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }
    return (Join-Path $buildDir 'niuma')
}

function Get-ShellInstallDir {
    param(
        [string]$RepoRoot,
        [string]$Platform,
        [string]$Arch,
        [string]$Configuration = 'Release'
    )
    Split-Path -Parent (Get-ShellExePath -RepoRoot $RepoRoot -Platform $Platform -Arch $Arch -Configuration $Configuration)
}

function Test-ShouldSyncLegacyShell {
    param(
        [string]$Platform,
        [string]$Arch
    )
    return ($Platform -eq 'windows' -and $Arch -eq (Get-MatrixHostArch))
}

function Sync-LegacyShellBuild {
    param(
        [string]$RepoRoot,
        [string]$Platform,
        [string]$Arch,
        [string]$Configuration = 'Release'
    )
    if (-not (Test-ShouldSyncLegacyShell -Platform $Platform -Arch $Arch)) {
        return
    }
    $matrixInstall = Get-ShellInstallDir -RepoRoot $RepoRoot -Platform $Platform -Arch $Arch -Configuration $Configuration
    if (-not (Test-Path $matrixInstall)) {
        return
    }
    $legacyInstall = Join-Path $RepoRoot "build/shell/$Configuration"
    New-Item -ItemType Directory -Force -Path $legacyInstall | Out-Null
    Copy-Item -Recurse -Force "$matrixInstall\*" $legacyInstall
    Write-Host "==> legacy shell synced -> $legacyInstall" -ForegroundColor DarkGray
}

function Resolve-ShellExePath {
    param(
        [string]$RepoRoot,
        [string]$Platform = 'windows',
        [string]$Arch = 'x64',
        [string]$Configuration = 'Release'
    )
    $matrixExe = Get-ShellExePath -RepoRoot $RepoRoot -Platform $Platform -Arch $Arch -Configuration $Configuration
    if (Test-Path $matrixExe) {
        return $matrixExe
    }
    $legacyExe = Join-Path $RepoRoot "build/shell/$Configuration/niuma.exe"
    if (Test-Path $legacyExe) {
        return $legacyExe
    }
    return $matrixExe
}

function Get-DefaultPackOutputDir {
    param(
        [string]$RepoRoot,
        [string]$Platform,
        [string]$Arch,
        [string]$Format = 'dir'
    )
    Join-Path $RepoRoot "output/$Platform-$Arch/$Format"
}
