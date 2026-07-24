param(
    [string]$InstallRoot = (Join-Path $env:USERPROFILE ".codex\integrations\deepseek"),
    [string]$SkillRoot = (Join-Path $env:USERPROFILE ".codex\skills\multi-subagents")
)

$ErrorActionPreference = "Stop"
$SourceRoot = Split-Path -Parent $PSScriptRoot
$RuntimeSource = Join-Path $PSScriptRoot "deepseek-worker"
$SkillSource = Join-Path $SourceRoot "skill\multi-subagents"

function Set-DirectoryJunction {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Target
    )

    $ResolvedTarget = (Resolve-Path -LiteralPath $Target).Path
    if (Test-Path -LiteralPath $Path) {
        $Existing = Get-Item -LiteralPath $Path -Force
        if (($Existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Remove-Item -LiteralPath $Path -Force
        } else {
            Remove-Item -LiteralPath $Path -Recurse -Force
        }
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    New-Item -ItemType Junction -Path $Path -Target $ResolvedTarget | Out-Null
}

$CachePath = Join-Path $SourceRoot ".tmp\npm-cache"
& npm.cmd install --prefix $RuntimeSource --cache $CachePath --ignore-scripts
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install the pinned OpenCode runtime."
}

Set-DirectoryJunction -Path $InstallRoot -Target $PSScriptRoot
Set-DirectoryJunction -Path $SkillRoot -Target $SkillSource

Write-Output "DeepSeek global junction: $InstallRoot -> $PSScriptRoot"
Write-Output "Multi-subagents global junction: $SkillRoot -> $SkillSource"
