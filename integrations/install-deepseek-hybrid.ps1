[CmdletBinding()]
param(
    [string]$CodexHome,
    [string]$NodeBin,
    [string]$ApiKeyFile,
    [switch]$SkipTests,
    [switch]$LiveTest
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-FullPath {
    param([Parameter(Mandatory = $true)][string]$PathValue)
    return [System.IO.Path]::GetFullPath($PathValue)
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverPath = Join-Path $scriptDir "deepseek-mcp\server.mjs"
$testPath = Join-Path $scriptDir "deepseek-mcp\test.mjs"
$configTestPath = Join-Path $scriptDir "deepseek-mcp\test-configure.mjs"
$liveTestPath = Join-Path $scriptDir "deepseek-mcp\live-test.mjs"
$configurePath = Join-Path $scriptDir "configure-deepseek-mcp.mjs"

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
    if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
        $CodexHome = $env:CODEX_HOME
    } else {
        $CodexHome = Join-Path $env:USERPROFILE ".codex"
    }
}
if ([string]::IsNullOrWhiteSpace($ApiKeyFile)) {
    $ApiKeyFile = Join-Path $env:USERPROFILE ".config\deepseek\env"
}
if ([string]::IsNullOrWhiteSpace($NodeBin)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        throw "找不到 Node.js。请先安装 Node.js 18+，或使用 -NodeBin 指定路径。"
    }
    $NodeBin = $nodeCommand.Source
}

$CodexHome = Resolve-FullPath $CodexHome
$ApiKeyFile = Resolve-FullPath $ApiKeyFile
$NodeBin = (Resolve-Path $NodeBin).Path
$serverPath = (Resolve-Path $serverPath).Path
$testPath = (Resolve-Path $testPath).Path
$configTestPath = (Resolve-Path $configTestPath).Path
$liveTestPath = (Resolve-Path $liveTestPath).Path
$configurePath = (Resolve-Path $configurePath).Path

$nodeMajor = [int](& $NodeBin -p 'Number(process.versions.node.split(".")[0])')
if ($nodeMajor -lt 18) {
    throw "Node.js 至少需要 v18，当前主版本为 $nodeMajor。"
}

$keyDirectory = Split-Path -Parent $ApiKeyFile
[System.IO.Directory]::CreateDirectory($keyDirectory) | Out-Null
if (-not (Test-Path -LiteralPath $ApiKeyFile -PathType Leaf)) {
    $apiKey = $env:DEEPSEEK_API_KEY
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        $secureKey = Read-Host "请输入 DEEPSEEK_API_KEY" -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
        try {
            $apiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        }
    }
    if ($apiKey -notmatch '^sk-[A-Za-z0-9_-]+$') {
        throw "没有获得格式有效的 DeepSeek API Key。"
    }
    [System.IO.File]::WriteAllText(
        $ApiKeyFile,
        "DEEPSEEK_API_KEY=$apiKey`n",
        [System.Text.UTF8Encoding]::new($false)
    )
    $apiKey = $null

    try {
        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $acl = [System.Security.AccessControl.FileSecurity]::new()
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $identity,
            [System.Security.AccessControl.FileSystemRights]::Read -bor [System.Security.AccessControl.FileSystemRights]::Write,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $acl.SetAccessRuleProtection($true, $false)
        $acl.AddAccessRule($rule)
        Set-Acl -LiteralPath $ApiKeyFile -AclObject $acl
    } catch {
        Write-Warning "无法收紧密钥文件 ACL；请确认仅当前用户可读取：$ApiKeyFile"
    }
    Write-Host "已创建密钥文件：$ApiKeyFile"
}

if (-not $SkipTests) {
    Write-Host "正在运行离线 MCP 测试……"
    & $NodeBin $testPath
    if ($LASTEXITCODE -ne 0) { throw "离线 MCP 测试失败。" }

    Write-Host "正在运行离线配置迁移测试……"
    & $NodeBin $configTestPath
    if ($LASTEXITCODE -ne 0) { throw "离线配置迁移测试失败。" }
}

[System.IO.Directory]::CreateDirectory($CodexHome) | Out-Null
$configPath = Join-Path $CodexHome "config.toml"
& $NodeBin $configurePath `
    --config $configPath `
    --node $NodeBin `
    --server $serverPath `
    --key-file $ApiKeyFile
if ($LASTEXITCODE -ne 0) { throw "更新 Codex 配置失败。" }

$codexCommand = Get-Command codex -ErrorAction SilentlyContinue
if ($null -ne $codexCommand) {
    Write-Host "正在让 Codex 解析并检查 MCP 配置……"
    & $codexCommand.Source mcp get deepseek
    if ($LASTEXITCODE -ne 0) { throw "Codex 无法解析 DeepSeek MCP 配置。" }
} else {
    Write-Warning "当前 PATH 中没有 codex，已跳过 codex mcp get deepseek。"
}

if ($LiveTest) {
    Write-Host "正在执行最小真实 DeepSeek Responses API 测试……"
    $previousKeyFile = $env:DEEPSEEK_API_KEY_FILE
    try {
        $env:DEEPSEEK_API_KEY_FILE = $ApiKeyFile
        & $NodeBin $liveTestPath
        if ($LASTEXITCODE -ne 0) { throw "真实 DeepSeek API 测试失败。" }
    } finally {
        $env:DEEPSEEK_API_KEY_FILE = $previousKeyFile
    }
}

Write-Host ""
Write-Host "DeepSeek 混合接入安装完成。"
Write-Host "主模型保持不变；新增 ask_deepseek MCP，后端为 deepseek-v4-flash Responses API。"
Write-Host "请完全重启 Codex 后，在新会话中测试 GPT–DeepSeek 对抗审查。"
