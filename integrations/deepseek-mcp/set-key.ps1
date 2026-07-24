param(
    [switch]$Clear
)

$variableName = 'DEEPSEEK_API_KEY'

if ($Clear) {
    [Environment]::SetEnvironmentVariable($variableName, $null, 'User')
    Write-Host 'DEEPSEEK_API_KEY was removed from the user environment.'
    exit 0
}

$secureValue = Read-Host 'Paste a newly created DeepSeek API key' -AsSecureString
$pointer = [IntPtr]::Zero
$plainValue = $null

try {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    $plainValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if ($plainValue -notmatch '^sk-[A-Za-z0-9_-]{16,}$') {
        throw 'The value does not look like a DeepSeek API key.'
    }
    [Environment]::SetEnvironmentVariable($variableName, $plainValue, 'User')
}
finally {
    $plainValue = $null
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

Write-Host 'DEEPSEEK_API_KEY is configured. Fully restart Codex before testing.'
