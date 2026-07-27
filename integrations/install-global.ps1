param(
    [string]$InstallRoot = (Join-Path $env:USERPROFILE ".codex\integrations\deepseek"),
    [string]$SkillsRoot = (Join-Path $env:USERPROFILE ".codex\skills")
)

$ErrorActionPreference = "Stop"
$SourceRoot = Split-Path -Parent $PSScriptRoot
$RuntimeSource = Join-Path $PSScriptRoot "deepseek-worker"
$SolidVibeSkillSource = Join-Path $SourceRoot "skill\solid-vibe-coding"
$ExperimentSkillSource = Join-Path $SourceRoot "skill\experiment-management"

function Get-NormalizedLinkTarget {
    param(
        [Parameter(Mandatory = $true)]$Item,
        [Parameter(Mandatory = $true)][string]$LinkPath
    )

    $RawTarget = @($Item.Target)[0]
    if ([string]::IsNullOrWhiteSpace($RawTarget)) {
        throw "Cannot determine junction target: $LinkPath"
    }
    if (-not [IO.Path]::IsPathRooted($RawTarget)) {
        $RawTarget = Join-Path (Split-Path -Parent $LinkPath) $RawTarget
    }
    return [IO.Path]::GetFullPath($RawTarget).TrimEnd(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    )
}

function Assert-DirectoryJunctionAvailable {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Target
    )

    $ResolvedTarget = (Resolve-Path -LiteralPath $Target).Path
    $Existing = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -ne $Existing) {
        if (($Existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
            throw "Refusing to overwrite existing path: $Path"
        }
        $ExistingTarget = Get-NormalizedLinkTarget -Item $Existing -LinkPath $Path
        if ([string]::Equals(
            $ExistingTarget,
            [IO.Path]::GetFullPath($ResolvedTarget),
            [StringComparison]::OrdinalIgnoreCase
        )) {
            Write-Output "Junction already correct: $Path -> $ResolvedTarget"
            return
        }
        throw "Refusing to overwrite junction pointing elsewhere: $Path"
    }
}

function Set-DirectoryJunction {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Target
    )

    $ResolvedTarget = (Resolve-Path -LiteralPath $Target).Path
    Assert-DirectoryJunctionAvailable -Path $Path -Target $ResolvedTarget
    if ($null -ne (Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue)) {
        return
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    New-Item -ItemType Junction -Path $Path -Target $ResolvedTarget | Out-Null
}

$SolidVibeSkillRoot = Join-Path $SkillsRoot "solid-vibe-coding"
$ExperimentSkillRoot = Join-Path $SkillsRoot "experiment-management"

Assert-DirectoryJunctionAvailable -Path $InstallRoot -Target $PSScriptRoot
Assert-DirectoryJunctionAvailable -Path $SolidVibeSkillRoot -Target $SolidVibeSkillSource
Assert-DirectoryJunctionAvailable -Path $ExperimentSkillRoot -Target $ExperimentSkillSource

$CachePath = Join-Path $SourceRoot ".tmp\npm-cache"
& npm.cmd install --prefix $RuntimeSource --cache $CachePath --ignore-scripts
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install the pinned OpenCode runtime."
}

Set-DirectoryJunction -Path $InstallRoot -Target $PSScriptRoot
Set-DirectoryJunction -Path $SolidVibeSkillRoot -Target $SolidVibeSkillSource
Set-DirectoryJunction -Path $ExperimentSkillRoot -Target $ExperimentSkillSource

Write-Output "DeepSeek global junction: $InstallRoot -> $PSScriptRoot"
Write-Output "Solid Vibe Coding junction: $SolidVibeSkillRoot -> $SolidVibeSkillSource"
Write-Output "Experiment Management junction: $ExperimentSkillRoot -> $ExperimentSkillSource"
