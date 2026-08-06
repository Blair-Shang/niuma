#Requires -Version 5.1
<#
  版本与构建元数据：根 package.json 为单一来源。
#>

function Invoke-EmitBuildInfo {
    param([string]$RepoRoot)
    $script = Join-Path $RepoRoot 'scripts/shared/version/emit-build-info.mjs'
    if (-not (Test-Path $script)) {
        throw "version emitter not found: $script"
    }
    # node 的 synced 日志在 stderr；$ErrorActionPreference=Stop 时 2>&1 会变成 NativeCommandError 并中止
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & node $script 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "emit-build-info.mjs exited with code $LASTEXITCODE"
        }
    } finally {
        $ErrorActionPreference = $prevEap
    }

    $jsonLine = $null
    foreach ($item in @($raw)) {
        $text = if ($item -is [System.Management.Automation.ErrorRecord]) {
            $item.ToString()
        } else {
            [string]$item
        }
        if ($text -match '^\s*\{') {
            $jsonLine = $text
        } elseif ($text -match '^synced ') {
            Write-Host "    $text"
        }
    }
    if (-not $jsonLine) {
        throw 'emit-build-info.mjs produced no JSON output'
    }
    return $jsonLine | ConvertFrom-Json
}

function Get-BuildInfo {
    param([string]$RepoRoot)
    $manifest = Join-Path $RepoRoot 'build/version.json'
    if (-not (Test-Path $manifest)) {
        return Invoke-EmitBuildInfo -RepoRoot $RepoRoot
    }
    return Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-GoVersionLdflags {
    param(
        [string]$RepoRoot,
        [ValidateSet('Debug', 'Release')]
        [string]$Configuration = 'Release'
    )
    $info = Get-BuildInfo -RepoRoot $RepoRoot
    $strip = if ($Configuration -eq 'Release') { '-s -w' } else { '' }
    $inject = @(
        "-X niuma/pkg/buildinfo.Version=$($info.version)"
        "-X niuma/pkg/buildinfo.BuildID=$($info.buildId)"
        "-X niuma/pkg/buildinfo.BuildDate=$($info.buildDate)"
    ) -join ' '
    if ($strip) {
        return "$strip $inject"
    }
    return $inject
}

function Get-CMakeVersionArgs {
    param([string]$RepoRoot)
    $info = Get-BuildInfo -RepoRoot $RepoRoot
    return @(
        "-DNIUMMA_APP_VERSION=$($info.version)"
        "-DNIUMMA_BUILD_ID=$($info.buildId)"
    )
}
