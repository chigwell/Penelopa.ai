param(
    [ValidateSet("auto", "codex-openai", "claude-anthropic")]
    [string]$Source = "auto"
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $OutputEncoding
[Console]::OutputEncoding = $OutputEncoding
$script:HookFinished = $false
$script:StateLockStream = $null
$script:StateLockPath = $null
$script:DrainLockStream = $null
$script:DrainLockPath = $null
$script:NetworkAttempted = $false
$DefaultSegmentUrl = "https://api.penelopa.ai/v2/transcript-segments"
$DefaultSegmentMaxBytes = 8388608L
$DefaultDrainMaxAttempts = 16
$DefaultDrainMaxSeconds = 40

function Write-HookLog {
    param([string]$Message)
    [Console]::Error.WriteLine("auto-improve hook: $Message")
}

function Write-DeliveryError {
    param([string]$Message)
    if ($env:AUTO_IMPROVE_HEALTH_DIR) {
        New-Item -ItemType Directory -Force -Path $env:AUTO_IMPROVE_HEALTH_DIR | Out-Null
        Write-JsonAtomic (Join-Path $env:AUTO_IMPROVE_HEALTH_DIR 'delivery-error.json') @{ at = [DateTime]::UtcNow.ToString('o'); error = $Message }
    }
}

function Finish-Hook {
    param([int]$Code = 0)
    Release-StateLock
    Release-DrainLock
    if (-not $script:HookFinished -and $Source -eq "codex-openai") {
        [Console]::Out.WriteLine("{}")
    }
    $script:HookFinished = $true
    exit $Code
}

function Read-Config {
    $configPath = $env:AUTO_IMPROVE_HOOK_CONFIG
    if ([string]::IsNullOrWhiteSpace($configPath)) {
        $configPath = Join-Path $HOME ".auto-improve-hook.json"
    }
    $config = [ordered]@{}
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        $raw = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            $parsed = $raw | ConvertFrom-Json
            foreach ($property in $parsed.PSObject.Properties) {
                $config[$property.Name] = $property.Value
            }
        }
    }
    return $config
}

function Get-Sha256Bytes {
    param([byte[]]$Bytes)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Get-Sha256Text {
    param([string]$Value)
    return Get-Sha256Bytes ([System.Text.Encoding]::UTF8.GetBytes($Value))
}

function Get-Sha256File {
    param([string]$Path)
    $stream = [System.IO.File]::OpenRead($Path)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Get-FileIdentity {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path
    if ($item.PSObject.Properties["UnixStat"] -and $item.UnixStat) {
        return "$($item.UnixStat.DeviceId):$($item.UnixStat.Inode)"
    }
    # Creation time changes when a path is replaced on Windows.  The prefix and
    # acknowledged-tail checks below also detect same-path overwrite/truncate.
    return "$($item.FullName)|$($item.CreationTimeUtc.Ticks)"
}

function Get-NextEpoch {
    param([object]$PreviousEpoch)
    if ($null -eq $PreviousEpoch -or [string]$PreviousEpoch -notmatch '^\d+$') {
        return [long]0
    }
    $epoch = [long]$PreviousEpoch
    if ($epoch -eq [long]::MaxValue) { throw "Transcript epoch overflow" }
    return $epoch + 1L
}

function Sync-FileToDisk {
    param([string]$Path)
    $stream = [System.IO.File]::Open(
        $Path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::Read
    )
    try {
        $stream.Flush($true)
    } finally {
        $stream.Dispose()
    }
}

function Sync-DirectoryToDisk {
    param([string]$Path)
    $bindingFlags = [System.Reflection.BindingFlags]"NonPublic,Public,Static"
    $runningOnWindows = [System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT
    if ($runningOnWindows -and $env:AUTO_IMPROVE_NODE) {
        # Managed delivery flushes every data/state file before atomic publication.
        # Windows has no documented user-level directory fsync API; do not depend
        # on private PowerShell reflection types or request volume-flush privileges.
        return
    }
    if ($runningOnWindows) {
        # PowerShell already ships the kernel32 CreateFile declaration. Opening
        # the directory with BACKUP_SEMANTICS lets FileStream.Flush(true) issue
        # FlushFileBuffers without compiling a per-hook Add-Type helper.
        $assembly = [System.Management.Automation.PSObject].Assembly
        $nativeType = $assembly.GetType("System.Management.Automation.PlatformInvokes", $true)
        $desiredType = $nativeType.GetNestedType("FileDesiredAccess", "NonPublic,Public")
        $shareType = $nativeType.GetNestedType("FileShareMode", "NonPublic,Public")
        $creationType = $nativeType.GetNestedType("FileCreationDisposition", "NonPublic,Public")
        $attributesType = $nativeType.GetNestedType("FileAttributes", "NonPublic,Public")
        $createFile = $nativeType.GetMethod("CreateFile", $bindingFlags)
        $desired = [System.Enum]::Parse($desiredType, "GenericRead,GenericWrite")
        $share = [System.Enum]::Parse($shareType, "Read,Write,Delete")
        $creation = [System.Enum]::Parse($creationType, "OpenExisting")
        $attributes = [System.Enum]::Parse($attributesType, "BackupSemantics,Write_Through")
        $rawHandle = [IntPtr]$createFile.Invoke($null, @(
            $Path,
            $desired,
            $share,
            [IntPtr]::Zero,
            $creation,
            $attributes,
            [IntPtr]::Zero
        ))
        if ($rawHandle -eq [IntPtr]::Zero -or $rawHandle -eq [IntPtr](-1)) {
            throw [System.ComponentModel.Win32Exception]::new(
                [System.Runtime.InteropServices.Marshal]::GetLastWin32Error(),
                "Could not open directory for durable flush: $Path"
            )
        }
        $safeHandle = [Microsoft.Win32.SafeHandles.SafeFileHandle]::new($rawHandle, $true)
        $stream = $null
        try {
            $stream = [System.IO.FileStream]::new(
                $safeHandle,
                [System.IO.FileAccess]::ReadWrite,
                1,
                $false
            )
            $stream.Flush($true)
        } finally {
            if ($stream) { $stream.Dispose() } else { $safeHandle.Dispose() }
        }
        return
    }

    # FileStream intentionally rejects directory paths on Unix. The runtime's
    # own open/fsync wrappers provide the same operation without a Python/Node
    # dependency or an expensive Add-Type compilation on every Stop hook.
    $assembly = [System.IO.File].Assembly
    $nativeType = $assembly.GetType("Interop+Sys", $true)
    $openFlagsType = $assembly.GetType("Interop+Sys+OpenFlags", $true)
    $openFlags = [System.Enum]::Parse($openFlagsType, "O_RDONLY")
    $open = $nativeType.GetMethod(
        "Open",
        $bindingFlags,
        $null,
        [type[]]@([string], $openFlagsType, [int]),
        $null
    )
    $fsync = $nativeType.GetMethod(
        "FSync",
        $bindingFlags,
        $null,
        [type[]]@([Microsoft.Win32.SafeHandles.SafeFileHandle]),
        $null
    )
    $safeHandle = $open.Invoke($null, @($Path, $openFlags, 0))
    if (-not $safeHandle -or $safeHandle.IsInvalid) {
        if ($safeHandle) { $safeHandle.Dispose() }
        throw "Could not open directory for durable flush: $Path"
    }
    try {
        $result = [int]$fsync.Invoke($null, @($safeHandle))
        if ($result -ne 0) {
            throw "Could not durably flush directory: $Path"
        }
    } finally {
        $safeHandle.Dispose()
    }
}

function Move-AtomicDurable {
    param(
        [string]$SourcePath,
        [string]$DestinationPath,
        [switch]$Directory
    )
    if ($Directory) {
        Sync-DirectoryToDisk $SourcePath
    } else {
        Sync-FileToDisk $SourcePath
    }
    $sourceParent = [System.IO.Path]::GetDirectoryName($SourcePath)
    $destinationParent = [System.IO.Path]::GetDirectoryName($DestinationPath)
    if (-not $Directory -and [System.IO.File]::Exists($DestinationPath)) {
        # PowerShell coerces $null to an empty string for a .NET string argument.
        # .NET Framework rejects that as the backup path on Windows; pass a real
        # null so ACK state, retry schedules and the drain cursor can be replaced.
        [System.IO.File]::Replace($SourcePath, $DestinationPath, [System.Management.Automation.Language.NullString]::Value)
    } else { Move-Item -LiteralPath $SourcePath -Destination $DestinationPath -Force }
    if (-not [string]::Equals($sourceParent, $destinationParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        Sync-DirectoryToDisk $sourceParent
    }
    Sync-DirectoryToDisk $destinationParent
}

function Write-JsonAtomic {
    param([string]$Path, [object]$Value)
    $temporary = "$Path.$PID.tmp"
    $Value | ConvertTo-Json -Depth 10 -Compress | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-AtomicDurable $temporary $Path
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-RangeTailHash {
    param([string]$Path, [long]$EndOffset)
    $count = [int][Math]::Min(256L, [Math]::Max(0L, $EndOffset))
    $bytes = [byte[]]::new($count)
    if ($count -gt 0) {
        $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        try {
            [void]$stream.Seek($EndOffset - $count, [System.IO.SeekOrigin]::Begin)
            $read = $stream.Read($bytes, 0, $count)
            if ($read -ne $count) { throw "Could not read acknowledged transcript tail" }
        } finally {
            $stream.Dispose()
        }
    }
    return Get-Sha256Bytes $bytes
}

function Get-RangePrefixHash {
    param([string]$Path, [long]$EndOffset)
    if ($EndOffset -lt 0L) { throw "Prefix offset must not be negative" }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        if ($stream.Length -lt $EndOffset) { throw "Transcript is shorter than the prefix offset" }
        $buffer = [byte[]]::new(65536)
        $remaining = $EndOffset
        while ($remaining -gt 0L) {
            $toRead = [int][Math]::Min([long]$buffer.Length, $remaining)
            $read = $stream.Read($buffer, 0, $toRead)
            if ($read -le 0) { throw "Could not read transcript prefix" }
            [void]$sha.TransformBlock($buffer, 0, $read, $buffer, 0)
            $remaining -= $read
        }
        [void]$sha.TransformFinalBlock([byte[]]::new(0), 0, 0)
        return ([BitConverter]::ToString($sha.Hash)).Replace("-", "").ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Write-State {
    param(
        [string]$StatePath,
        [string]$FileIdentity,
        [long]$Epoch,
        [long]$AckOffset,
        [long]$NextSegmentSeq,
        [string]$AckPrefixSha256,
        [string]$AckTailSha256,
        [long]$FinalizedOffset
    )
    Write-JsonAtomic $StatePath ([ordered]@{
        fileIdentity = $FileIdentity
        epoch = $Epoch
        ackOffset = $AckOffset
        nextSegmentSeq = $NextSegmentSeq
        ackPrefixSha256 = $AckPrefixSha256
        ackTailSha256 = $AckTailSha256
        finalizedOffset = $FinalizedOffset
    })
}

function Release-StateLock {
    if ($script:StateLockStream) {
        $script:StateLockStream.Dispose()
        $script:StateLockStream = $null
    }
    if ($script:StateLockPath -and (Test-Path -LiteralPath $script:StateLockPath)) {
        Remove-Item -LiteralPath $script:StateLockPath -Force -ErrorAction SilentlyContinue
    }
    $script:StateLockPath = $null
}

function Release-DrainLock {
    if ($script:DrainLockStream) {
        $script:DrainLockStream.Dispose()
        $script:DrainLockStream = $null
    }
    if ($script:DrainLockPath -and (Test-Path -LiteralPath $script:DrainLockPath)) {
        Remove-Item -LiteralPath $script:DrainLockPath -Force -ErrorAction SilentlyContinue
    }
    $script:DrainLockPath = $null
}

function Acquire-StateLock {
    param([string]$Path)
    $script:StateLockPath = $Path
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        try {
            $script:StateLockStream = [System.IO.File]::Open(
                $Path,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::None
            )
            return $true
        } catch [System.IO.IOException] {
            if (Test-Path -LiteralPath $Path) {
                $lock = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
                if ($lock -and $lock.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddMinutes(-5)) {
                    Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
                    continue
                }
            }
            Start-Sleep -Seconds 1
        }
    }
    $script:StateLockPath = $null
    return $false
}

function Acquire-DrainLock {
    param([string]$Path)
    $script:DrainLockPath = $Path
    try {
        $script:DrainLockStream = [System.IO.File]::Open(
            $Path,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        return $true
    } catch [System.IO.IOException] {
        if (Test-Path -LiteralPath $Path) {
            $lock = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
            if ($lock -and $lock.LastWriteTimeUtc -lt [DateTime]::UtcNow.AddMinutes(-5)) {
                Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
                try {
                    $script:DrainLockStream = [System.IO.File]::Open(
                        $Path,
                        [System.IO.FileMode]::CreateNew,
                        [System.IO.FileAccess]::Write,
                        [System.IO.FileShare]::None
                    )
                    return $true
                } catch [System.IO.IOException] {
                }
            }
        }
        $script:DrainLockPath = $null
        return $false
    }
}

function Copy-CompleteJsonlRange {
    param(
        [string]$SourcePath,
        [long]$StartOffset,
        [string]$DestinationPath,
        [long]$MaxBytes,
        [bool]$AllowEofRecord = $false,
        [bool]$StartsInsideRecord = $false,
        [bool]$HasMoreBytes = $false
    )
    $inputStream = [System.IO.File]::Open($SourcePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $outputStream = [System.IO.File]::Open($DestinationPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $firstNewline = 0L
    $lastNewline = 0L
    try {
        [void]$inputStream.Seek($StartOffset, [System.IO.SeekOrigin]::Begin)
        $buffer = [byte[]]::new(65536)
        $remaining = $MaxBytes
        while ($remaining -gt 0) {
            $toRead = [int][Math]::Min([long]$buffer.Length, $remaining)
            $read = $inputStream.Read($buffer, 0, $toRead)
            if ($read -le 0) { break }
            $outputStream.Write($buffer, 0, $read)
            for ($index = 0; $index -lt $read; $index++) {
                if ($buffer[$index] -eq 10) {
                    $newlinePosition = $outputStream.Position - $read + $index + 1
                    if ($firstNewline -eq 0L) { $firstNewline = $newlinePosition }
                    $lastNewline = $newlinePosition
                }
            }
            $remaining -= $read
        }
        $isFragment = $false
        if ($StartsInsideRecord -and $firstNewline -gt 0L) {
            $completeLength = $firstNewline
            $isFragment = $true
        } elseif ($StartsInsideRecord -and ($HasMoreBytes -or $AllowEofRecord)) {
            $completeLength = $outputStream.Position
            $isFragment = $true
        } elseif ($lastNewline -gt 0L) {
            $completeLength = $lastNewline
        } elseif ($HasMoreBytes) {
            $completeLength = $outputStream.Position
            $isFragment = $true
        } elseif ($AllowEofRecord) {
            $completeLength = $outputStream.Position
        } else {
            $completeLength = 0L
        }
        $outputStream.SetLength($completeLength)
        return [pscustomobject]@{
            Length = [long]$completeLength
            IsFragment = [bool]$isFragment
        }
    } finally {
        $outputStream.Dispose()
        $inputStream.Dispose()
    }
}

function Test-StartsInsideJsonlRecord {
    param([string]$Path, [long]$Offset)
    if ($Offset -le 0L) { return $false }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        [void]$stream.Seek($Offset - 1L, [System.IO.SeekOrigin]::Begin)
        return $stream.ReadByte() -ne 10
    } finally {
        $stream.Dispose()
    }
}

function Get-OutboxEntries {
    param([string]$Directory, [string]$Filter)
    $entries = foreach ($item in Get-ChildItem -LiteralPath $Directory -Directory -Filter $Filter) {
        $request = $null
        try {
            $request = Read-JsonFile (Join-Path $item.FullName "request.json")
        } catch {
        }
        [long]$epoch = 0L
        [long]$segmentSeq = 0L
        $valid = (
            $request -and
            -not [string]::IsNullOrWhiteSpace([string]$request.stateKey) -and
            [long]::TryParse([string]$request.epoch, [ref]$epoch) -and
            [long]::TryParse([string]$request.segmentSeq, [ref]$segmentSeq) -and
            $epoch -ge 0L -and
            $segmentSeq -ge 0L
        )
        $sortKey = if ($valid) { "k:$([string]$request.stateKey)" } else { "z:$($item.Name)" }
        [pscustomobject]@{
            Item = $item
            Request = $request
            StateKey = $(if ($valid) { [string]$request.stateKey } else { $item.FullName })
            SortKey = $sortKey
            Epoch = $(if ($valid) { $epoch } else { [long]::MaxValue })
            SegmentSeq = $(if ($valid) { $segmentSeq } else { [long]::MaxValue })
        }
    }
    return @($entries | Sort-Object SortKey, Epoch, SegmentSeq, @{ Expression = { $_.Item.Name } })
}

function Get-PendingEntries {
    param([string]$OutboxDirectory)
    return @(Get-OutboxEntries $OutboxDirectory "pending-*")
}

function Get-CursorItems {
    param([string]$OutboxDirectory)
    $items = @((Get-PendingEntries $OutboxDirectory) | ForEach-Object { $_.Item })
    $quarantineDirectory = Join-Path $OutboxDirectory "quarantine"
    if (Test-Path -LiteralPath $quarantineDirectory -PathType Container) {
        $items += @((Get-OutboxEntries $quarantineDirectory "quarantined-*") | ForEach-Object { $_.Item })
    }
    return @($items)
}

function Get-PendingCursor {
    param(
        [string]$OutboxDirectory,
        [string]$StateKey,
        [long]$Epoch,
        [long]$Offset,
        [long]$Sequence,
        [string]$PrefixSha256,
        [string]$TailSha256,
        [long]$FinalizedOffset
    )
    foreach ($item in Get-CursorItems $OutboxDirectory) {
        $request = Read-JsonFile (Join-Path $item.FullName "request.json")
        if ($request -and $request.stateKey -eq $StateKey -and $request.epoch -eq $Epoch) {
            if ([bool]$request.isFinal) {
                $FinalizedOffset = [Math]::Max($FinalizedOffset, [long]$request.byteEnd)
            }
            if ([long]$request.byteEnd -gt $Offset -or
                ([long]$request.byteEnd -eq $Offset -and [long]$request.segmentSeq -ge $Sequence)) {
                $Offset = [long]$request.byteEnd
                $Sequence = [long]$request.segmentSeq + 1
                $PrefixSha256 = [string]$request.ackPrefixSha256
                $TailSha256 = [string]$request.ackTailSha256
            }
        }
    }
    return [pscustomobject]@{
        Offset = $Offset
        Sequence = $Sequence
        PrefixSha256 = $PrefixSha256
        TailSha256 = $TailSha256
        FinalizedOffset = $FinalizedOffset
    }
}

function Add-OutboxItem {
    param(
        [string]$OutboxDirectory,
        [string]$SegmentPath,
        [string]$StateKey,
        [string]$Url,
        [string]$ProjectId,
        [string]$SessionId,
        [long]$Epoch,
        [long]$SegmentSeq,
        [long]$ByteStart,
        [long]$ByteEnd,
        [string]$SchemaVersion,
        [bool]$IsFinal,
        [string]$TranscriptPath,
        [string]$AckPrefixSha256,
        [bool]$IsFragment = $false
    )
    $segmentSha = Get-Sha256File $SegmentPath
    $idempotencyKey = Get-Sha256Text "$Source|$ProjectId|$SessionId|$Epoch|$SegmentSeq|$ByteStart|$ByteEnd|$segmentSha"
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $paddedStart = $ByteStart.ToString("D20")
    $temporary = Join-Path $OutboxDirectory ".tmp-$timestamp-$PID-$SegmentSeq"
    $item = Join-Path $OutboxDirectory "pending-$timestamp-$paddedStart-$idempotencyKey"
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        Copy-Item -LiteralPath $SegmentPath -Destination (Join-Path $temporary "segment.jsonl")
        $request = [ordered]@{
            url = $Url
            idempotencyKey = $idempotencyKey
            source = $Source
            projectId = $ProjectId
            externalSessionId = $SessionId
            epoch = $Epoch
            segmentSeq = $SegmentSeq
            byteStart = $ByteStart
            byteEnd = $ByteEnd
            segmentSha256 = $segmentSha
            sourceSchemaVersion = $SchemaVersion
            isFinal = $IsFinal
            metadata = ([ordered]@{
                transport_record_fragment = $IsFragment
                fragment_byte_start = $ByteStart
                fragment_byte_end = $ByteEnd
            } | ConvertTo-Json -Compress)
            stateKey = $StateKey
            ackPrefixSha256 = $AckPrefixSha256
            ackTailSha256 = Get-RangeTailHash $TranscriptPath $ByteEnd
            attempts = 0
            nextAttemptEpoch = 0
        }
        Write-JsonAtomic (Join-Path $temporary "request.json") $request
        Sync-FileToDisk (Join-Path $temporary "segment.jsonl")
        Move-AtomicDurable $temporary $item -Directory
    } catch {
        Remove-Item -LiteralPath $temporary -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
}

function Advance-StateForItem {
    param([object]$Request, [string]$StateDirectory)
    $statePath = Join-Path $StateDirectory "$($Request.stateKey).json"
    $state = Read-JsonFile $statePath
    if (-not $state -or $state.epoch -ne $Request.epoch -or [long]$state.ackOffset -ne [long]$Request.byteStart) {
        return
    }
    $finalizedOffset = [long]$state.finalizedOffset
    if ([bool]$Request.isFinal) {
        $finalizedOffset = [long]$Request.byteEnd
    }
    if ([string]::IsNullOrWhiteSpace([string]$Request.ackPrefixSha256)) {
        throw "Outbox item is missing its acknowledged-prefix fingerprint"
    }
    Write-State $statePath $state.fileIdentity $state.epoch ([long]$Request.byteEnd) ([long]$Request.segmentSeq + 1) $Request.ackPrefixSha256 $Request.ackTailSha256 $finalizedOffset
}

function Set-RetrySchedule {
    param([object]$Request, [string]$RequestPath, [object]$Response)
    $Request.attempts = [int]$Request.attempts + 1
    $delay = [Math]::Min(300, 5 * [Math]::Pow(2, [Math]::Min(6, $Request.attempts - 1)))
    if ($Response -and [int]$Response.StatusCode -eq 429 -and $Response.Headers.RetryAfter) {
        if ($Response.Headers.RetryAfter.Delta) {
            $delay = [Math]::Max($delay, [Math]::Ceiling($Response.Headers.RetryAfter.Delta.TotalSeconds))
        } elseif ($Response.Headers.RetryAfter.Date) {
            $serverDelay = [Math]::Ceiling(($Response.Headers.RetryAfter.Date.Value - [DateTimeOffset]::UtcNow).TotalSeconds)
            $delay = [Math]::Max($delay, $serverDelay)
        }
    }
    $Request.nextAttemptEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + [long][Math]::Max(1, $delay)
    Write-JsonAtomic $RequestPath $Request
}

function Test-SuccessAcknowledgement {
    param([object]$Request, [string]$ResponseBody)
    if ([string]::IsNullOrWhiteSpace($ResponseBody)) { return $false }
    try {
        $ack = $ResponseBody | ConvertFrom-Json
        if (-not $ack.PSObject.Properties["segment_id"] -or
            $ack.segment_id -isnot [string] -or
            [string]::IsNullOrWhiteSpace($ack.segment_id)) {
            return $false
        }
        if (-not $ack.PSObject.Properties["accepted_offset"] -or
            ($ack.accepted_offset -isnot [long] -and $ack.accepted_offset -isnot [int]) -or
            [long]$ack.accepted_offset -ne [long]$Request.byteEnd) {
            return $false
        }
        if (-not $ack.PSObject.Properties["segment_sha256"] -or
            $ack.segment_sha256 -isnot [string] -or
            -not [string]::Equals(
                $ack.segment_sha256,
                [string]$Request.segmentSha256,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
            return $false
        }
        return $true
    } catch {
        return $false
    }
}

function Move-OutboxItemToQuarantine {
    param(
        [System.IO.DirectoryInfo]$Item,
        [int]$StatusCode,
        [string]$ResponseBody,
        [string]$OutboxDirectory
    )
    $quarantineDirectory = Join-Path $OutboxDirectory "quarantine"
    New-Item -ItemType Directory -Force -Path $quarantineDirectory | Out-Null
    Set-Content -LiteralPath (Join-Path $Item.FullName "quarantine_http_status") -Value $StatusCode -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $Item.FullName "quarantined_at") -Value ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) -Encoding ASCII
    if (-not [string]::IsNullOrEmpty($ResponseBody)) {
        $boundedBody = $ResponseBody.Substring(0, [Math]::Min(65536, $ResponseBody.Length))
        Set-Content -LiteralPath (Join-Path $Item.FullName "quarantine_response.json") -Value $boundedBody -Encoding UTF8
    }
    foreach ($file in Get-ChildItem -LiteralPath $Item.FullName -File) {
        Sync-FileToDisk $file.FullName
    }
    $suffix = $Item.Name.Substring("pending-".Length)
    $destination = Join-Path $quarantineDirectory "quarantined-$suffix"
    if (Test-Path -LiteralPath $destination) {
        $destination = "$destination.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).$PID"
    }
    Move-AtomicDurable $Item.FullName $destination -Directory
    Write-HookLog "segment rejected permanently (HTTP $StatusCode); quarantined at $destination"
}

function Send-OutboxItem {
    param(
        [System.IO.DirectoryInfo]$Item,
        [string]$Token,
        [int]$TimeoutSeconds,
        [string]$StateDirectory,
        [string]$LocksDirectory
    )
    $script:NetworkAttempted = $false
    if ([string]::IsNullOrWhiteSpace($Token)) { return "Blocked" }
    $requestPath = Join-Path $Item.FullName "request.json"
    $request = Read-JsonFile $requestPath
    if (-not $request) { return "Blocked" }
    if ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -lt [long]$request.nextAttemptEpoch) { return "Blocked" }

    $statePath = Join-Path $StateDirectory "$($request.stateKey).json"
    $state = Read-JsonFile $statePath
    if ($state -and $state.epoch -eq $request.epoch) {
        $isFinalMarker = [bool]$request.isFinal -and [long]$request.byteStart -eq [long]$request.byteEnd
        if ($isFinalMarker -and [long]$state.finalizedOffset -eq [long]$request.byteEnd) {
            Remove-Item -LiteralPath $Item.FullName -Recurse -Force
            return "Delivered"
        }
        if (-not $isFinalMarker -and [long]$state.ackOffset -ge [long]$request.byteEnd) {
            Remove-Item -LiteralPath $Item.FullName -Recurse -Force
            return "Delivered"
        }
        if ([long]$state.ackOffset -ne [long]$request.byteStart) {
            return "Blocked"
        }
    }

    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [System.Net.Http.HttpClient]::new($handler)
    $content = [System.Net.Http.MultipartFormDataContent]::new()
    $stream = $null
    $response = $null
    try {
        $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
        $client.DefaultRequestHeaders.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
        $client.DefaultRequestHeaders.Add("Idempotency-Key", [string]$request.idempotencyKey)
        $fields = [ordered]@{
            source = $request.source
            project_id = $request.projectId
            external_session_id = $request.externalSessionId
            epoch = $request.epoch
            segment_seq = $request.segmentSeq
            byte_start = $request.byteStart
            byte_end = $request.byteEnd
            segment_sha256 = $request.segmentSha256
            source_schema_version = $request.sourceSchemaVersion
            is_final = ([bool]$request.isFinal).ToString().ToLowerInvariant()
            metadata = $request.metadata
        }
        foreach ($field in $fields.GetEnumerator()) {
            $content.Add([System.Net.Http.StringContent]::new([string]$field.Value), [string]$field.Key)
        }
        $stream = [System.IO.File]::OpenRead((Join-Path $Item.FullName "segment.jsonl"))
        $fileContent = [System.Net.Http.StreamContent]::new($stream)
        $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("application/x-ndjson")
        $content.Add($fileContent, "segment", "segment.jsonl")
        $script:NetworkAttempted = $true
        $response = $client.PostAsync([string]$request.url, $content).GetAwaiter().GetResult()
        $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($response.IsSuccessStatusCode) {
            if (Test-SuccessAcknowledgement $request $responseBody) {
                $stateLockPath = Join-Path $LocksDirectory "state-$($request.stateKey).lock"
                if (Acquire-StateLock $stateLockPath) {
                    try {
                        Advance-StateForItem $request $StateDirectory
                        if ($env:AUTO_IMPROVE_HEALTH_DIR) {
                            New-Item -ItemType Directory -Force -Path $env:AUTO_IMPROVE_HEALTH_DIR | Out-Null
                            Remove-Item -LiteralPath (Join-Path $env:AUTO_IMPROVE_HEALTH_DIR "delivery-error.json") -Force -ErrorAction SilentlyContinue
                            $healthPath = Join-Path $env:AUTO_IMPROVE_HEALTH_DIR "upload.json"
                            [System.IO.File]::WriteAllText("$healthPath.tmp", ('{"lastUploadAt":' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '}'), [System.Text.UTF8Encoding]::new($false))
                            Move-Item -LiteralPath "$healthPath.tmp" -Destination $healthPath -Force
                        }
                        if ($stream) { $stream.Dispose(); $stream = $null }
                        Remove-Item -LiteralPath $Item.FullName -Recurse -Force
                        return "Delivered"
                    } finally {
                        Release-StateLock
                    }
                }
                Set-RetrySchedule $request $requestPath $response
                Write-HookLog "server acknowledgement was valid but local state was busy; retained for idempotent retry"
                return "Blocked"
            }
            Set-RetrySchedule $request $requestPath $response
            Write-DeliveryError 'The server returned an invalid acknowledgement. Queued data is retained for retry.'
            Write-HookLog "segment upload returned an invalid acknowledgement; retained in durable outbox"
            return "Blocked"
        }
        Write-DeliveryError $(if ([int]$response.StatusCode -in @(401,403)) { 'The server rejected the installed account token. Reconnect your account; queued data is retained.' } else { "Delivery returned HTTP $([int]$response.StatusCode). Queued data is retained for retry or review." })
        if ([int]$response.StatusCode -in @(409, 413, 415, 422)) {
            $stateLockPath = Join-Path $LocksDirectory "state-$($request.stateKey).lock"
            if (Acquire-StateLock $stateLockPath) {
                try {
                    if ($stream) { $stream.Dispose(); $stream = $null }
                    Move-OutboxItemToQuarantine $Item ([int]$response.StatusCode) $responseBody $Item.Parent.FullName
                    return "Quarantined"
                } finally {
                    Release-StateLock
                }
            }
            Set-RetrySchedule $request $requestPath $response
            Write-HookLog "server rejection was conclusive but local state was busy; retained for retry"
            return "Blocked"
        }
        Set-RetrySchedule $request $requestPath $response
        if ([int]$response.StatusCode -eq 429) {
            Write-HookLog "segment upload rate-limited; retained in durable outbox"
        } else {
            Write-HookLog "segment upload deferred (HTTP $([int]$response.StatusCode))"
        }
        return "Blocked"
    } catch {
        Set-RetrySchedule $request $requestPath $null
        Write-DeliveryError 'The upload could not reach the server. Check your connection; queued data is retained.'
        Write-HookLog "segment upload deferred ($($_.Exception.GetType().Name))"
        return "Blocked"
    } finally {
        if ($response) { $response.Dispose() }
        if ($stream) { $stream.Dispose() }
        $content.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
}

function Write-DrainCursor {
    param([string]$Path, [string]$Value)
    $temporary = "$Path.$PID.tmp"
    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($temporary, "$Value`n", $utf8WithoutBom)
    Move-AtomicDurable $temporary $Path
}

function Drain-Outbox {
    param(
        [string]$OutboxDirectory,
        [string]$Token,
        [int]$TimeoutSeconds,
        [string]$StateDirectory,
        [string]$LocksDirectory,
        [int]$MaxAttempts,
        [int]$MaxSeconds
    )
    $blockedKeys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $cursorPath = Join-Path $OutboxDirectory ".drain-cursor"
    $cursorValue = if (Test-Path -LiteralPath $cursorPath -PathType Leaf) {
        (Get-Content -LiteralPath $cursorPath -Raw).Trim()
    } else {
        ""
    }
    $entries = @(Get-PendingEntries $OutboxDirectory)
    if (-not [string]::IsNullOrWhiteSpace($cursorValue)) {
        $after = @($entries | Where-Object { [string]::CompareOrdinal($_.SortKey, $cursorValue) -gt 0 })
        $before = @($entries | Where-Object { [string]::CompareOrdinal($_.SortKey, $cursorValue) -le 0 })
        $entries = @($after + $before)
    }

    $networkAttempts = 0
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($entry in $entries) {
        if ($networkAttempts -ge $MaxAttempts -or $stopwatch.Elapsed.TotalSeconds -ge $MaxSeconds) {
            Write-HookLog "outbox drain budget exhausted; remaining segments stay durable for a later hook"
            break
        }
        if ($script:DrainLockStream) {
            [void]$script:DrainLockStream.Seek(0, [System.IO.SeekOrigin]::Begin)
            $script:DrainLockStream.WriteByte(0)
            $script:DrainLockStream.Flush()
        }
        $item = $entry.Item
        $stateKey = [string]$entry.StateKey
        if ($blockedKeys.Contains($stateKey)) { continue }
        $remainingSeconds = [Math]::Max(1, [int][Math]::Ceiling($MaxSeconds - $stopwatch.Elapsed.TotalSeconds))
        $itemTimeout = [Math]::Min($TimeoutSeconds, $remainingSeconds)
        $result = Send-OutboxItem $item $Token $itemTimeout $StateDirectory $LocksDirectory
        if ($script:NetworkAttempted) {
            $networkAttempts++
            Write-DrainCursor $cursorPath ([string]$entry.SortKey)
        }
        if ($result -ne "Delivered") {
            [void]$blockedKeys.Add($stateKey)
        }
    }
    $stopwatch.Stop()
}

try {
    Add-Type -AssemblyName System.Net.Http
    # Windows PowerShell may replace Console.In with a host reader whose code
    # page does not change with Console.InputEncoding. Decode the pipe itself.
    $inputReader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false, $true))
    try { $inputJson = $inputReader.ReadToEnd() } finally { $inputReader.Dispose() }
    if ([string]::IsNullOrWhiteSpace($inputJson)) {
        $pipelineInput = @($input)
        if ($pipelineInput.Count -gt 0) {
            $inputJson = ($pipelineInput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        }
    }
    if ([string]::IsNullOrWhiteSpace($inputJson)) { Finish-Hook 0 }

    $event = $inputJson | ConvertFrom-Json
    if ($event.hook_event_name -notin @("Stop", "SessionEnd", "Drain")) { Finish-Hook 0 }
    $transcriptPath = [string]$event.transcript_path
    if ($event.hook_event_name -ne "Drain" -and ([string]::IsNullOrWhiteSpace($transcriptPath) -or -not (Test-Path -LiteralPath $transcriptPath -PathType Leaf))) {
        Write-HookLog "transcript_path is missing or unreadable"
        Finish-Hook 0
    }
    if ($event.hook_event_name -ne "Drain") { $transcriptPath = (Get-Item -LiteralPath $transcriptPath).FullName }
    if ($Source -eq "auto") {
        $Source = if ($transcriptPath -match "[\\/]\.claude[\\/]") { "claude-anthropic" } else { "codex-openai" }
    }

    $config = Read-Config
    $uploadMode = if ($env:AUTO_IMPROVE_UPLOAD_MODE) { $env:AUTO_IMPROVE_UPLOAD_MODE } elseif ($config.uploadMode) { [string]$config.uploadMode } else { "segments" }
    if ($uploadMode -eq "delta") { $uploadMode = "segments" }
    if ($uploadMode -eq "full") {
        Write-HookLog "legacy full upload mode has been removed; use v2 segments"
        Finish-Hook 0
    }
    if ($uploadMode -ne "segments") { throw "Unsupported upload mode: $uploadMode" }
    $url = if ($env:AUTO_IMPROVE_URL) {
        $env:AUTO_IMPROVE_URL
    } elseif ($config.url) {
        [string]$config.url
    } else {
        $DefaultSegmentUrl
    }
    $token = if ($env:AUTO_IMPROVE_TOKEN) { $env:AUTO_IMPROVE_TOKEN } elseif ($config.token) { [string]$config.token } else { "" }
    $timeoutSeconds = if ($env:AUTO_IMPROVE_TIMEOUT_SECONDS) { [int]$env:AUTO_IMPROVE_TIMEOUT_SECONDS } elseif ($config.timeoutSeconds) { [int]$config.timeoutSeconds } else { 15 }
    $cwdValue = [string]$event.cwd
    $sessionId = [string]$event.session_id
    $turnId = if ($event.turn_id) { [string]$event.turn_id } elseif ($event.prompt_id) { [string]$event.prompt_id } else { "" }
    $projectId = if ($env:AUTO_IMPROVE_PROJECT_ID) {
        $env:AUTO_IMPROVE_PROJECT_ID
    } elseif ($config.projectId) {
        [string]$config.projectId
    } elseif (-not [string]::IsNullOrWhiteSpace($cwdValue)) {
        Split-Path -Path $cwdValue -Leaf
    } else {
        "unknown-project"
    }

    $dataDirectory = if ($env:AUTO_IMPROVE_DATA_DIR) {
        $env:AUTO_IMPROVE_DATA_DIR
    } elseif ($config.dataDir) {
        [string]$config.dataDir
    } else {
        Join-Path $HOME ".auto-improve"
    }
    $schemaVersion = if ($env:AUTO_IMPROVE_SOURCE_SCHEMA_VERSION) {
        $env:AUTO_IMPROVE_SOURCE_SCHEMA_VERSION
    } elseif ($config.sourceSchemaVersion) {
        [string]$config.sourceSchemaVersion
    } else {
        "$Source-jsonl-v1"
    }
    $segmentMaxBytes = if ($env:AUTO_IMPROVE_SEGMENT_MAX_BYTES) {
        [long]$env:AUTO_IMPROVE_SEGMENT_MAX_BYTES
    } elseif ($config.segmentMaxBytes) {
        [long]$config.segmentMaxBytes
    } else {
        $DefaultSegmentMaxBytes
    }
    $drainMaxAttempts = if ($env:AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS) {
        [int]$env:AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS
    } elseif ($config.drainMaxAttempts) {
        [int]$config.drainMaxAttempts
    } else {
        $DefaultDrainMaxAttempts
    }
    $drainMaxSeconds = if ($env:AUTO_IMPROVE_DRAIN_MAX_SECONDS) {
        [int]$env:AUTO_IMPROVE_DRAIN_MAX_SECONDS
    } elseif ($config.drainMaxSeconds) {
        [int]$config.drainMaxSeconds
    } else {
        $DefaultDrainMaxSeconds
    }
    if ($segmentMaxBytes -le 0) { throw "AUTO_IMPROVE_SEGMENT_MAX_BYTES must be a positive integer" }
    if ($drainMaxAttempts -le 0) { throw "AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS must be a positive integer" }
    if ($drainMaxSeconds -le 0) { throw "AUTO_IMPROVE_DRAIN_MAX_SECONDS must be a positive integer" }
    $stateDirectory = Join-Path $dataDirectory "state"
    $outboxDirectory = Join-Path $dataDirectory "outbox"
    $quarantineDirectory = Join-Path $outboxDirectory "quarantine"
    $workDirectory = Join-Path $dataDirectory "work"
    $locksDirectory = Join-Path $dataDirectory "locks"
    New-Item -ItemType Directory -Force -Path $stateDirectory, $outboxDirectory, $quarantineDirectory, $workDirectory, $locksDirectory | Out-Null
    foreach ($directory in @($stateDirectory, $quarantineDirectory, $outboxDirectory, $workDirectory, $locksDirectory, $dataDirectory)) {
        Sync-DirectoryToDisk $directory
    }
    $dataParent = [System.IO.Path]::GetDirectoryName($dataDirectory)
    if (-not [string]::IsNullOrWhiteSpace($dataParent)) {
        Sync-DirectoryToDisk $dataParent
    }

    if ($event.hook_event_name -eq "Drain") {
        if ($token -and (Acquire-DrainLock (Join-Path $locksDirectory "drain.lock"))) {
            try { Drain-Outbox $outboxDirectory $token $timeoutSeconds $stateDirectory $locksDirectory $drainMaxAttempts $drainMaxSeconds }
            finally { Release-DrainLock }
        }
        Finish-Hook 0
    }

    $logicalSession = if ($sessionId) { $sessionId } else { $transcriptPath }
    $sessionId = $logicalSession
    $stateKey = Get-Sha256Text "$Source|$logicalSession|$transcriptPath"
    $stateLockPath = Join-Path $locksDirectory "state-$stateKey.lock"
    if (-not (Acquire-StateLock $stateLockPath)) {
        if ($event.hook_event_name -eq "SessionEnd") {
            Write-HookLog "SessionEnd snapshot could not acquire its local state lock; source bytes remain unspooled and require a later hook invocation"
        } else {
            Write-HookLog "transcript snapshot could not acquire its local state lock; a later hook will retry"
        }
        Finish-Hook 0
    }

    # Snapshot the current local transcript before any potentially slow network I/O.
    $statePath = Join-Path $stateDirectory "$stateKey.json"
    $fileInfo = Get-Item -LiteralPath $transcriptPath
    $currentSize = [long]$fileInfo.Length
    if ($env:AUTO_IMPROVE_SNAPSHOT_SIZE) {
        $limit = [long]$env:AUTO_IMPROVE_SNAPSHOT_SIZE
        if ($limit -lt 0 -or $currentSize -lt $limit) { throw "Transcript was truncated before processing." }
        $currentSize = $limit
    }
    $fileIdentity = Get-FileIdentity $transcriptPath
    $state = Read-JsonFile $statePath
    if ($env:AUTO_IMPROVE_SNAPSHOT_SIZE -and $state -and $state.fileIdentity -eq $fileIdentity -and [long]$state.ackOffset -gt $currentSize -and
        [string]$state.ackPrefixSha256 -eq (Get-RangePrefixHash $transcriptPath ([long]$state.ackOffset))) {
        if ($env:AUTO_IMPROVE_RECEIPT_FILE) { [System.IO.File]::WriteAllText($env:AUTO_IMPROVE_RECEIPT_FILE, '{"spooled":true}') }
        Finish-Hook 0
    }
    $resetState = -not $state
    if ($state) {
        if ([string]$state.epoch -notmatch '^\d+$' -or
            [string]$state.ackOffset -notmatch '^\d+$' -or
            [string]$state.nextSegmentSeq -notmatch '^\d+$' -or
            [string]$state.finalizedOffset -notmatch '^(?:-1|\d+)$') {
            $resetState = $true
        } elseif ($state.fileIdentity -ne $fileIdentity -or [long]$state.ackOffset -gt $currentSize) {
            $resetState = $true
        } elseif (-not $state.PSObject.Properties["ackPrefixSha256"] -or
            [string]::IsNullOrWhiteSpace([string]$state.ackPrefixSha256)) {
            $resetState = $true
        } elseif ([string]$state.ackPrefixSha256 -ne (Get-RangePrefixHash $transcriptPath ([long]$state.ackOffset))) {
            $resetState = $true
        }
    }
    if ($resetState) {
        $previousEpoch = if ($state) { $state.epoch } else { $null }
        $epoch = Get-NextEpoch $previousEpoch
        Write-State $statePath $fileIdentity $epoch 0 0 (Get-RangePrefixHash $transcriptPath 0) (Get-RangeTailHash $transcriptPath 0) -1
        $state = Read-JsonFile $statePath
    }

    $cursor = Get-PendingCursor $outboxDirectory $stateKey $state.epoch ([long]$state.ackOffset) ([long]$state.nextSegmentSeq) ([string]$state.ackPrefixSha256) ([string]$state.ackTailSha256) ([long]$state.finalizedOffset)
    if ($env:AUTO_IMPROVE_SNAPSHOT_SIZE -and $currentSize -lt $cursor.Offset -and
        [string]$cursor.PrefixSha256 -eq (Get-RangePrefixHash $transcriptPath ([long]$cursor.Offset))) {
        if ($env:AUTO_IMPROVE_RECEIPT_FILE) { [System.IO.File]::WriteAllText($env:AUTO_IMPROVE_RECEIPT_FILE, '{"spooled":true}') }
        Finish-Hook 0
    }
    $spoolSnapshotInvalid = $currentSize -lt $cursor.Offset
    if (-not $spoolSnapshotInvalid -and
        [long]$cursor.Offset -gt [long]$state.ackOffset) {
        $spoolSnapshotInvalid = (
            [string]::IsNullOrWhiteSpace([string]$cursor.PrefixSha256) -or
            [string]$cursor.PrefixSha256 -ne (Get-RangePrefixHash $transcriptPath ([long]$cursor.Offset))
        )
    }
    if ($spoolSnapshotInvalid) {
        $epoch = Get-NextEpoch $state.epoch
        Write-State $statePath $fileIdentity $epoch 0 0 (Get-RangePrefixHash $transcriptPath 0) (Get-RangeTailHash $transcriptPath 0) -1
        $state = Read-JsonFile $statePath
        $cursor = [pscustomobject]@{
            Offset = 0L
            Sequence = 0L
            PrefixSha256 = (Get-RangePrefixHash $transcriptPath 0)
            TailSha256 = (Get-RangeTailHash $transcriptPath 0)
            FinalizedOffset = -1L
        }
    }

    while ($currentSize -gt $cursor.Offset) {
        $segmentPath = Join-Path $workDirectory "segment-$PID.tmp"
        try {
            $readLimit = [Math]::Min($segmentMaxBytes, $currentSize - [long]$cursor.Offset)
            $allowEofRecord = (
                $event.hook_event_name -eq "SessionEnd" -and
                ([long]$cursor.Offset + $readLimit) -eq $currentSize
            )
            $startsInsideRecord = Test-StartsInsideJsonlRecord $transcriptPath ([long]$cursor.Offset)
            $hasMoreBytes = ([long]$cursor.Offset + $readLimit) -lt $currentSize
            $copyResult = Copy-CompleteJsonlRange $transcriptPath $cursor.Offset $segmentPath $readLimit $allowEofRecord $startsInsideRecord $hasMoreBytes
            $segmentLength = [long]$copyResult.Length
            if ($segmentLength -le 0) {
                break
            }
            $byteEnd = [long]$cursor.Offset + $segmentLength
            $isFinal = $event.hook_event_name -eq "SessionEnd" -and $byteEnd -eq $currentSize
            if ([bool]$copyResult.IsFragment) {
                Write-HookLog "oversized JSONL record preserved as transport fragment at bytes $($cursor.Offset)..$byteEnd"
            }
            $prefixSha256 = Get-RangePrefixHash $transcriptPath $byteEnd
            Add-OutboxItem $outboxDirectory $segmentPath $stateKey $url $projectId $sessionId $state.epoch $cursor.Sequence $cursor.Offset $byteEnd $schemaVersion $isFinal $transcriptPath $prefixSha256 ([bool]$copyResult.IsFragment)
            $cursor = [pscustomobject]@{
                Offset = $byteEnd
                Sequence = [long]$cursor.Sequence + 1
                PrefixSha256 = $prefixSha256
                TailSha256 = (Get-RangeTailHash $transcriptPath $byteEnd)
                FinalizedOffset = $(if ($isFinal) { $byteEnd } else { $cursor.FinalizedOffset })
            }
        } finally {
            Remove-Item -LiteralPath $segmentPath -Force -ErrorAction SilentlyContinue
        }
    }

    if ($event.hook_event_name -eq "SessionEnd" -and
        [long]$cursor.Offset -eq $currentSize -and
        [long]$cursor.FinalizedOffset -ne $currentSize) {
        $finalMarkerPath = Join-Path $workDirectory "final-marker-$PID.tmp"
        try {
            [System.IO.File]::WriteAllBytes($finalMarkerPath, [byte[]]::new(0))
            $prefixSha256 = Get-RangePrefixHash $transcriptPath $currentSize
            Add-OutboxItem $outboxDirectory $finalMarkerPath $stateKey $url $projectId $sessionId $state.epoch $cursor.Sequence $currentSize $currentSize $schemaVersion $true $transcriptPath $prefixSha256 $false
            $cursor = [pscustomobject]@{
                Offset = $currentSize
                Sequence = [long]$cursor.Sequence + 1
                PrefixSha256 = $prefixSha256
                TailSha256 = (Get-RangeTailHash $transcriptPath $currentSize)
                FinalizedOffset = $currentSize
            }
        } finally {
            Remove-Item -LiteralPath $finalMarkerPath -Force -ErrorAction SilentlyContinue
        }
    }

    if ($env:AUTO_IMPROVE_RECEIPT_FILE) {
        if (($cursor.Offset -eq $currentSize -or ($event.hook_event_name -eq "Stop" -and $copyResult -and $copyResult.Length -eq 0)) -and
            ($event.hook_event_name -ne "SessionEnd" -or $cursor.FinalizedOffset -eq $currentSize)) {
            [System.IO.File]::WriteAllText($env:AUTO_IMPROVE_RECEIPT_FILE, '{"spooled":true}', [System.Text.UTF8Encoding]::new($false))
            Sync-FileToDisk $env:AUTO_IMPROVE_RECEIPT_FILE
        }
    }
    Release-StateLock
    if ($env:AUTO_IMPROVE_SPOOL_ONLY -eq "1") { Finish-Hook 0 }

    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-HookLog "AUTO_IMPROVE_TOKEN is not configured; segment retained in durable outbox"
    } elseif (-not (Acquire-DrainLock (Join-Path $locksDirectory "drain.lock"))) {
        Write-HookLog "another outbox drain is active; the durable snapshot will be retried by a later hook"
    } else {
        try {
            Drain-Outbox $outboxDirectory $token $timeoutSeconds $stateDirectory $locksDirectory $drainMaxAttempts $drainMaxSeconds
        } finally {
            Release-DrainLock
        }
    }
} catch {
    Write-HookLog "$($_.Exception.GetType().Name): $($_.Exception.Message)"
} finally {
    Finish-Hook 0
}
