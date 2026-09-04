param(
    [ValidateSet("codex", "claude", "both")]
    [string]$Agent = "both",

    [string]$Url = $(if ($env:AUTO_IMPROVE_URL) { $env:AUTO_IMPROVE_URL } else { "https://api.penelopa.ai/v2/transcript-segments" }),
    [string]$Token = $env:AUTO_IMPROVE_TOKEN,
    [string]$TokenUrl = $(if ($env:AUTO_IMPROVE_TOKEN_URL) { $env:AUTO_IMPROVE_TOKEN_URL } else { "https://api.penelopa.ai/v1/auth/bootstrap-token" }),
    [string]$DashboardUrl = $(if ($env:AUTO_IMPROVE_DASHBOARD_URL) { $env:AUTO_IMPROVE_DASHBOARD_URL } else { "https://penelopa.ai/dashboard" }),
    [string]$TelegramSettingsUrl = $(if ($env:AUTO_IMPROVE_TELEGRAM_SETTINGS_URL) { $env:AUTO_IMPROVE_TELEGRAM_SETTINGS_URL } else { "https://api.penelopa.ai/v1/user/telegram-notifications" }),
    [string]$TelegramLinkUrl = $(if ($env:AUTO_IMPROVE_TELEGRAM_LINK_URL) { $env:AUTO_IMPROVE_TELEGRAM_LINK_URL } else { "https://api.penelopa.ai/v1/user/telegram-notifications/link" }),
    [string]$EnvFile,
    [string]$HookUrl = $(if ($env:AUTO_IMPROVE_HOOK_DOWNLOAD_URL) { $env:AUTO_IMPROVE_HOOK_DOWNLOAD_URL } else { "https://penelopa.ai/auto-improve-upload.ps1" }),
    [string]$ProjectId = $env:AUTO_IMPROVE_PROJECT_ID,
    [string]$DataDir = $env:AUTO_IMPROVE_DATA_DIR,
    [string]$SourceSchemaVersion = $env:AUTO_IMPROVE_SOURCE_SCHEMA_VERSION,
    [long]$SegmentMaxBytes = $(if ($env:AUTO_IMPROVE_SEGMENT_MAX_BYTES) { [long]$env:AUTO_IMPROVE_SEGMENT_MAX_BYTES } else { 8388608L }),
    [int]$DrainMaxAttempts = $(if ($env:AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS) { [int]$env:AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS } else { 16 }),
    [int]$DrainMaxSeconds = $(if ($env:AUTO_IMPROVE_DRAIN_MAX_SECONDS) { [int]$env:AUTO_IMPROVE_DRAIN_MAX_SECONDS } else { 40 }),

    [switch]$ForceNewToken,

    [ValidateSet("segments", "delta")]
    [string]$UploadMode = $(if ($env:AUTO_IMPROVE_UPLOAD_MODE) { $env:AUTO_IMPROVE_UPLOAD_MODE } else { "segments" })
)

$ErrorActionPreference = "Stop"

function Write-InstallLog {
    param([string]$Message)
    [Console]::Error.WriteLine("auto-improve install: $Message")
}

function Remove-TerminalControlCharacters {
    param([string]$Value)
    if ($null -eq $Value) { return "" }
    return [regex]::Replace($Value, "[\x00-\x1F\x7F]", "")
}

function Test-TerminalHyperlinkSupport {
    if ([Console]::IsErrorRedirected) { return $false }
    if ($env:WT_SESSION -or $env:TERM_PROGRAM -or $env:VTE_VERSION -or $env:KONSOLE_VERSION -or $env:WEZTERM_EXECUTABLE) {
        return $true
    }
    return $false
}

function Format-TerminalLink {
    param(
        [string]$Label,
        [string]$Url
    )
    $safeLabel = Remove-TerminalControlCharacters $Label
    $safeUrl = Remove-TerminalControlCharacters $Url
    if (Test-TerminalHyperlinkSupport) {
        $escape = [char]27
        return "$escape]8;;$safeUrl$escape\$safeLabel$escape]8;;$escape\ ($safeUrl)"
    }
    return $safeUrl
}

function Write-InstallLink {
    param(
        [string]$Name,
        [string]$Label,
        [string]$Url
    )
    Write-InstallLog ("{0}: {1}" -f (Remove-TerminalControlCharacters $Name), (Format-TerminalLink -Label $Label -Url $Url))
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

function Read-ExistingHookToken {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    $raw = Get-Content -LiteralPath $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $null
    }
    try {
        $config = $raw | ConvertFrom-Json
    } catch {
        return $null
    }
    if ($config.PSObject.Properties["token"]) {
        return [string]$config.token
    }
    return $null
}

function Should-ReplaceExistingToken {
    param([string]$ConfigPath)
    if ($ForceNewToken) {
        return $true
    }
    if ([Console]::IsInputRedirected) {
        Write-InstallLog "existing API token found in $ConfigPath; reusing it because no interactive terminal is available"
        return $false
    }
    $answer = Read-Host "auto-improve install: existing API token found in $ConfigPath. Replace it with a new public token? [y/N]"
    return $answer -match '^(y|yes)$'
}

function Request-BootstrapToken {
    try {
        $response = Invoke-RestMethod -Method Post -Uri $TokenUrl -Headers @{ Accept = "application/json" }
    } catch {
        $responseObject = $_.Exception.Response
        $statusCode = if ($responseObject -and $responseObject.StatusCode) { [int]$responseObject.StatusCode } else { $null }
        $retryAfter = if ($responseObject -and $responseObject.Headers) { [string]$responseObject.Headers["Retry-After"] } else { "" }
        if ($statusCode -eq 429) {
            if ([string]::IsNullOrWhiteSpace($retryAfter)) {
                throw "Token rate limit exceeded."
            }
            throw "Token rate limit exceeded; retry after ${retryAfter}s."
        }
        if ($statusCode) {
            throw "Token endpoint returned HTTP $statusCode."
        }
        throw "Cannot request API token from $TokenUrl."
    }

    $issuedToken = [string]$response.api_token
    if ([string]::IsNullOrWhiteSpace($issuedToken)) {
        throw "Token endpoint did not return api_token."
    }
    return $issuedToken
}

function New-DashboardTokenLink {
    param(
        [string]$BaseUrl,
        [string]$AccessToken
    )
    $dashboardBase = $BaseUrl.TrimEnd("/")
    $encodedToken = [System.Uri]::EscapeDataString($AccessToken)
    return "${dashboardBase}#token=$encodedToken"
}

function New-NotificationsTokenLink {
    param(
        [string]$BaseUrl,
        [string]$AccessToken
    )
    $dashboardBase = $BaseUrl.TrimEnd("/")
    $encodedToken = [System.Uri]::EscapeDataString($AccessToken)
    return "${dashboardBase}/notifications#token=$encodedToken"
}

function New-TelegramSetupLink {
    param(
        [string]$AccessToken
    )
    $headers = @{
        Accept = "application/json"
        Authorization = "Bearer $AccessToken"
    }
    $settingsBody = @{
        enabled = $true
        language = "en"
        notification_types = @("recommendation_created", "recommendation_approved")
    } | ConvertTo-Json -Compress

    try {
        Invoke-RestMethod `
            -Method Patch `
            -Uri $TelegramSettingsUrl `
            -Headers $headers `
            -ContentType "application/json" `
            -Body $settingsBody | Out-Null

        $link = Invoke-RestMethod `
            -Method Post `
            -Uri $TelegramLinkUrl `
            -Headers $headers

        $deepLinkUrl = [string]$link.deep_link_url
        if ([string]::IsNullOrWhiteSpace($deepLinkUrl)) {
            throw "Telegram setup-link endpoint did not return deep_link_url."
        }

        return [pscustomobject]@{
            DeepLinkUrl = $deepLinkUrl
            ExpiresAt = [string]$link.expires_at
        }
    } catch {
        Write-InstallLog "warning: Telegram setup link could not be generated: $($_.Exception.Message)"
        return $null
    }
}

function Resolve-InstallToken {
    param(
        [string]$CurrentToken,
        [string]$ConfigPath,
        [string]$DotEnvPath
    )
    if (-not [string]::IsNullOrWhiteSpace($CurrentToken)) {
        return @{ Token = $CurrentToken; Issued = $false }
    }

    $existingToken = Read-ExistingHookToken -Path $ConfigPath
    if (-not [string]::IsNullOrWhiteSpace($existingToken) -and -not (Should-ReplaceExistingToken -ConfigPath $ConfigPath)) {
        return @{ Token = $existingToken; Issued = $false }
    }

    if ([string]::IsNullOrWhiteSpace($existingToken) -and -not $ForceNewToken) {
        $dotEnvToken = Read-DotEnvValue -Path $DotEnvPath -Key "API_ACCESS_TOKEN"
        if (-not [string]::IsNullOrWhiteSpace($dotEnvToken)) {
            return @{ Token = $dotEnvToken; Issued = $false }
        }
    }

    Write-InstallLog "requesting a new API token from $TokenUrl"
    return @{ Token = (Request-BootstrapToken); Issued = $true }
}

function Add-HookCommand {
    param(
        [string]$ConfigPath,
        [string]$Command,
        [bool]$IncludeMatcher,
        [int]$SessionEndTimeout = 60
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
        $timeout = if ($eventName -eq "SessionEnd") { $SessionEndTimeout } else { 60 }
        if (-not $config.hooks.PSObject.Properties[$eventName]) {
            $config.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue @()
        }

        $eventHooks = @($config.hooks.$eventName)
        $alreadyConfigured = $false
        foreach ($entry in $eventHooks) {
            foreach ($existingHook in @($entry.hooks)) {
                if ($existingHook.command -eq $Command) {
                    if ($existingHook.PSObject.Properties["timeout"]) {
                        $existingHook.timeout = $timeout
                    } else {
                        $existingHook | Add-Member -NotePropertyName timeout -NotePropertyValue $timeout
                    }
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
            timeout = $timeout
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

$installDir = if ($env:AUTO_IMPROVE_INSTALL_DIR) { $env:AUTO_IMPROVE_INSTALL_DIR } else { Join-Path $HOME ".auto-improve/hooks" }
$configFile = if ($env:AUTO_IMPROVE_HOOK_CONFIG) { $env:AUTO_IMPROVE_HOOK_CONFIG } else { Join-Path $HOME ".auto-improve-hook.json" }

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

$tokenResolution = Resolve-InstallToken -CurrentToken $Token -ConfigPath $configFile -DotEnvPath $EnvFile
$Token = [string]$tokenResolution.Token
$bootstrapTokenIssued = [bool]$tokenResolution.Issued

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
    Add-HookCommand -ConfigPath $codexConfig -Command (New-HookCommand "codex-openai") -IncludeMatcher $false -SessionEndTimeout 3
    Write-InstallLog "Codex hook configured at $codexConfig"
}

if ($Agent -eq "claude" -or $Agent -eq "both") {
    $claudeHome = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME ".claude" }
    $claudeConfig = Join-Path $claudeHome "settings.json"
    Add-HookCommand -ConfigPath $claudeConfig -Command (New-HookCommand "claude-anthropic") -IncludeMatcher $true
    Write-InstallLog "Claude Code hook configured at $claudeConfig"
}

Write-InstallLog "installed. Endpoint: $Url"
$dashboardLink = New-DashboardTokenLink -BaseUrl $DashboardUrl -AccessToken $Token
$notificationsLink = New-NotificationsTokenLink -BaseUrl $DashboardUrl -AccessToken $Token
if ($Agent -eq "codex" -or $Agent -eq "both") {
    Write-InstallLog "Codex next step: open Codex -> Settings -> Hooks, review the new or changed Stop and SessionEnd hooks, and trust both."
    Write-InstallLog "Codex CLI: run /hooks, review the new or changed hooks, and trust both."
    Write-InstallLink -Name "Codex hooks docs" -Label "open docs" -Url "https://learn.chatgpt.com/docs/hooks"
}
Write-InstallLink -Name "dashboard" -Label "open dashboard" -Url $dashboardLink
$telegramSetupLink = New-TelegramSetupLink -AccessToken $Token
if ($telegramSetupLink) {
    Write-InstallLink -Name "telegram setup" -Label "open Telegram setup" -Url $telegramSetupLink.DeepLinkUrl
    if (-not [string]::IsNullOrWhiteSpace($telegramSetupLink.ExpiresAt)) {
        Write-InstallLog "telegram setup expires at: $($telegramSetupLink.ExpiresAt)"
    }
} else {
    Write-InstallLog "telegram setup unavailable"
    Write-InstallLink -Name "manual Telegram setup" -Label "open notification settings" -Url $notificationsLink
}
if ($bootstrapTokenIssued) {
    Write-InstallLog "issued API token: $Token"
}
