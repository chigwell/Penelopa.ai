param(
    [ValidateSet("codex", "claude", "both")]
    [string]$Agent = "both",

    [string]$Url = $(if ($env:AUTO_IMPROVE_URL) { $env:AUTO_IMPROVE_URL } else { "https://api.penelopa.ai/v2/transcript-segments" }),
    [string]$Token = $env:AUTO_IMPROVE_TOKEN,
    [string]$EnvFile,
    [string]$HookUrl = $(if ($env:AUTO_IMPROVE_HOOK_DOWNLOAD_URL) { $env:AUTO_IMPROVE_HOOK_DOWNLOAD_URL } else { "https://penelopa.ai/auto-improve-upload.ps1" }),
    [string]$ProjectId = $env:AUTO_IMPROVE_PROJECT_ID,
    [string]$DataDir = $env:AUTO_IMPROVE_DATA_DIR,
    [string]$SourceSchemaVersion = $env:AUTO_IMPROVE_SOURCE_SCHEMA_VERSION,
    [long]$SegmentMaxBytes = $(if ($env:AUTO_IMPROVE_SEGMENT_MAX_BYTES) { [long]$env:AUTO_IMPROVE_SEGMENT_MAX_BYTES } else { 8388608L }),
    [int]$DrainMaxAttempts = $(if ($env:AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS) { [int]$env:AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS } else { 16 }),
    [int]$DrainMaxSeconds = $(if ($env:AUTO_IMPROVE_DRAIN_MAX_SECONDS) { [int]$env:AUTO_IMPROVE_DRAIN_MAX_SECONDS } else { 40 }),

    [ValidateSet("segments", "delta")]
    [string]$UploadMode = $(if ($env:AUTO_IMPROVE_UPLOAD_MODE) { $env:AUTO_IMPROVE_UPLOAD_MODE } else { "segments" })
)

$ErrorActionPreference = "Stop"

function Write-InstallLog {
    param([string]$Message)
    [Console]::Error.WriteLine("auto-improve install: $Message")
}

function Read-DotEnvValue {
    param(
        [string]$Path,
        [string]$Key
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    $prefix = "$Key="
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line.StartsWith($prefix)) {
            $value = $line.Substring($prefix.Length).Trim()
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }
    return $null
}

function Add-HookCommand {
    param(
        [string]$ConfigPath,
        [string]$Command,
        [bool]$IncludeMatcher
    )

    $configDir = Split-Path -Path $ConfigPath -Parent
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    if (Test-Path -LiteralPath $ConfigPath -PathType Leaf) {
        Copy-Item -LiteralPath $ConfigPath -Destination "$ConfigPath.bak.$(Get-Date -Format yyyyMMddHHmmss)" -Force
        $raw = Get-Content -LiteralPath $ConfigPath -Raw
        $config = if ([string]::IsNullOrWhiteSpace($raw)) { [pscustomobject]@{} } else { $raw | ConvertFrom-Json }
    } else {
        $config = [pscustomobject]@{}
    }

    if (-not $config.PSObject.Properties["hooks"]) {
        $config | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
    }
    foreach ($eventName in @("Stop", "SessionEnd")) {
        if (-not $config.hooks.PSObject.Properties[$eventName]) {
            $config.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue @()
        }

        $eventHooks = @($config.hooks.$eventName)
        $alreadyConfigured = $false
        foreach ($entry in $eventHooks) {
            foreach ($existingHook in @($entry.hooks)) {
                if ($existingHook.command -eq $Command) {
                    $alreadyConfigured = $true
                    break
                }
            }
            if ($alreadyConfigured) { break }
        }
        if ($alreadyConfigured) { continue }

        $hook = [ordered]@{
            type = "command"
            command = $Command
            timeout = 60
        }
        $entry = [ordered]@{
            hooks = @([pscustomobject]$hook)
        }
        if ($IncludeMatcher) {
            $entry = [ordered]@{
                matcher = ""
                hooks = @([pscustomobject]$hook)
            }
        }
        $config.hooks.$eventName = @($eventHooks + [pscustomobject]$entry)
    }
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path (Get-Location).Path ".env"
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    $Token = Read-DotEnvValue -Path $EnvFile -Key "API_ACCESS_TOKEN"
}

if ($UploadMode -eq "delta") {
    $UploadMode = "segments"
}
if ($SegmentMaxBytes -le 0) {
    throw "SegmentMaxBytes must be a positive integer."
}
if ($DrainMaxAttempts -le 0) {
    throw "DrainMaxAttempts must be a positive integer."
}
if ($DrainMaxSeconds -le 0) {
    throw "DrainMaxSeconds must be a positive integer."
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    throw "API token not found. Pass -Token or set API_ACCESS_TOKEN in $EnvFile."
}

$installDir = if ($env:AUTO_IMPROVE_INSTALL_DIR) { $env:AUTO_IMPROVE_INSTALL_DIR } else { Join-Path $HOME ".auto-improve/hooks" }
$configFile = if ($env:AUTO_IMPROVE_HOOK_CONFIG) { $env:AUTO_IMPROVE_HOOK_CONFIG } else { Join-Path $HOME ".auto-improve-hook.json" }

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
$configDirectory = Split-Path -Path $configFile -Parent
if (-not [string]::IsNullOrWhiteSpace($configDirectory)) {
    New-Item -ItemType Directory -Force -Path $configDirectory | Out-Null
}
$targetHook = Join-Path $installDir "auto-improve-upload.ps1"
Invoke-WebRequest -Uri $HookUrl -OutFile $targetHook

$config = [ordered]@{
    url = $Url
    token = $Token
    projectId = $ProjectId
    uploadMode = $UploadMode
    dataDir = $DataDir
    sourceSchemaVersion = $SourceSchemaVersion
    segmentMaxBytes = $SegmentMaxBytes
    drainMaxAttempts = $DrainMaxAttempts
    drainMaxSeconds = $DrainMaxSeconds
    timeoutSeconds = 15
}
$config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $configFile -Encoding UTF8

$runningOnWindows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
$psExe = if ($runningOnWindows) { "powershell.exe" } else { "pwsh" }

function New-HookCommand {
    param([string]$Source)
    return "$psExe -NoProfile -ExecutionPolicy Bypass -File `"$targetHook`" $Source"
}

if ($Agent -eq "codex" -or $Agent -eq "both") {
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
    $codexConfig = Join-Path $codexHome "hooks.json"
    Add-HookCommand -ConfigPath $codexConfig -Command (New-HookCommand "codex-openai") -IncludeMatcher $false
    Write-InstallLog "Codex hook configured at $codexConfig"
}

if ($Agent -eq "claude" -or $Agent -eq "both") {
    $claudeHome = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
    $claudeConfig = Join-Path $claudeHome "settings.json"
    Add-HookCommand -ConfigPath $claudeConfig -Command (New-HookCommand "claude-anthropic") -IncludeMatcher $true
    Write-InstallLog "Claude Code hook configured at $claudeConfig"
}

Write-InstallLog "installed. Endpoint: $Url"
