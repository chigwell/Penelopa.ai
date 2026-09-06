param(
  [ValidateSet('codex','claude','both')][string]$Agent = 'both',
  [string]$Url, [string]$Token, [string]$TokenUrl, [string]$DashboardUrl,
  [string]$TelegramSettingsUrl, [string]$TelegramLinkUrl, [string]$EnvFile, [string]$HookUrl,
  [string]$ProjectId, [string]$DataDir, [string]$SourceSchemaVersion,
  [long]$SegmentMaxBytes, [int]$DrainMaxAttempts, [int]$DrainMaxSeconds,
  [ValidateSet('segments','delta')][string]$UploadMode = 'segments',
  [ValidateSet('auto','off','required')][string]$Desktop = $(if ($env:AUTO_IMPROVE_DESKTOP) { $env:AUTO_IMPROVE_DESKTOP } else { 'auto' }),
  [switch]$ForceNewToken, [switch]$NoDesktop, [switch]$Diagnose, [switch]$Repair,
  [switch]$Uninstall, [switch]$PurgeData, [switch]$NoLaunch, [switch]$PrintAccessLink,
  [switch]$InstallDeps, [switch]$Help
)
$ErrorActionPreference = 'Stop'
$nodeVersion = '24.20.0'
$nodeSha = '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
$bootstrapSha = '4e653123b90f57baed1e9a593902a271cef94ba86db3e5cb69d06de21e42cc6d'
$releaseBase = if ($env:AUTO_IMPROVE_RELEASE_BASE_URL) { $env:AUTO_IMPROVE_RELEASE_BASE_URL } else { 'https://penelopa.ai/desktop' }
$root = if ($env:AUTO_IMPROVE_HOME) { $env:AUTO_IMPROVE_HOME } else { Join-Path $HOME '.auto-improve' }
function Write-Stage([string]$Message) { [Console]::Error.WriteLine("Penelopa: $Message") }
function Get-Download([string]$Uri, [string]$Destination) {
  if (-not $Uri.StartsWith('https://')) { throw 'Downloads require HTTPS.' }
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination -TimeoutSec 300; return }
    catch { if ($attempt -eq 2) { throw 'Download failed. Check your connection and run the installer again.' }; Start-Sleep -Seconds ([Math]::Pow(2, $attempt)) }
  }
}
function Test-Checksum([string]$File, [string]$Expected) {
  if ((Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) { throw 'Download checksum mismatch. Nothing from that download was installed.' }
}
if ($Help) {
  Write-Output 'Penelopa.ai: -Agent codex|claude|both -Desktop auto|off|required -NoDesktop -Diagnose -Repair -Uninstall -PurgeData -ForceNewToken -NoLaunch -PrintAccessLink. Existing token, endpoint and upload options remain supported. Node/npm are installed privately; Git and Python are not required.'
  return
}
$nodeArgs = @('--agent', $Agent, '--desktop', $Desktop, '--upload-mode', $UploadMode)
$values = @{ Url='url'; Token='token'; TokenUrl='token-url'; DashboardUrl='dashboard-url'; TelegramSettingsUrl='telegram-settings-url'; TelegramLinkUrl='telegram-link-url'; EnvFile='env-file'; HookUrl='hook-url'; ProjectId='project-id'; DataDir='data-dir'; SourceSchemaVersion='source-schema-version'; SegmentMaxBytes='segment-max-bytes'; DrainMaxAttempts='drain-max-attempts'; DrainMaxSeconds='drain-max-seconds' }
foreach ($entry in $values.GetEnumerator()) { if ($PSBoundParameters.ContainsKey($entry.Key)) { $nodeArgs += @("--$($entry.Value)", [string]$PSBoundParameters[$entry.Key]) } }
$switches = @{ ForceNewToken='force-new-token'; NoDesktop='no-desktop'; Diagnose='diagnose'; Repair='repair'; Uninstall='uninstall'; PurgeData='purge-data'; NoLaunch='no-launch'; PrintAccessLink='print-access-link'; InstallDeps='install-deps' }
foreach ($entry in $switches.GetEnumerator()) { if ($PSBoundParameters[$entry.Key]) { $nodeArgs += "--$($entry.Value)" } }
if ($Diagnose -or $Repair -or $Uninstall) {
  $marker = Join-Path $root 'node-path'; $cli = Join-Path $root 'bin/penelopa.cjs'
  if ((Test-Path -LiteralPath $marker) -and (Test-Path -LiteralPath $cli)) {
    $installedNode = (Get-Content -LiteralPath $marker -Raw -Encoding UTF8).Trim()
    & $installedNode $cli @nodeArgs
    if ($LASTEXITCODE -ne 0) { throw "Penelopa finished with status $LASTEXITCODE." }
    return
  }
  if ($Repair) { throw 'No managed installation found. Rerun without -Repair.' }
  Write-Stage 'No managed Penelopa installation found.'; return
}
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'This installer supports Windows x64. Windows ARM is not included in this release.' }
if (-not [System.IO.Path]::IsPathRooted($root)) { throw 'AUTO_IMPROVE_HOME must be an absolute path.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Force -Path $root, (Join-Path $root 'cache'), (Join-Path $root 'runtime') | Out-Null
if ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($root)).AvailableFreeSpace -lt 300000000) { throw 'At least 300 MB of free space is needed to prepare the private runtime.' }
$acl = Get-Acl -LiteralPath $root
$acl.SetAccessRuleProtection($true, $false)
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'), 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $root -AclObject $acl
$lock = $null; $stage = Join-Path $root ("cache/bootstrap-" + [Guid]::NewGuid())
try {
  try { $lock = [IO.File]::Open((Join-Path $root '.bootstrap.lock'), 'OpenOrCreate', 'ReadWrite', 'None') } catch { throw 'Another Penelopa installer is running.' }
  New-Item -ItemType Directory -Path $stage | Out-Null
  Write-Stage 'Preparing runtime'
  $folder = "node-v$nodeVersion-win-x64"
  $runtime = Join-Path $root "runtime/$folder"
  $nodePath = Join-Path $runtime 'node.exe'
  $runtimeReady = $false
  try { if (Test-Path -LiteralPath $nodePath) { $runtimeReady = ((& $nodePath --version) -eq "v$nodeVersion") } } catch {}
  if (-not $runtimeReady) {
    $archive = Join-Path $stage 'node.zip'
    Get-Download "https://nodejs.org/dist/v$nodeVersion/$folder.zip" $archive
    Test-Checksum $archive $nodeSha
    Expand-Archive -LiteralPath $archive -DestinationPath $stage -Force
    if ((& (Join-Path $stage "$folder/node.exe") --version) -ne "v$nodeVersion") { throw 'The verified runtime cannot run on this operating system.' }
    $previous = Join-Path $stage 'runtime.previous'
    if (Test-Path -LiteralPath $runtime) { Move-Item -LiteralPath $runtime -Destination $previous }
    try { Move-Item -LiteralPath (Join-Path $stage $folder) -Destination $runtime }
    catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $runtime }; throw 'Runtime replacement failed; the previous runtime was preserved.' }
  }
  if ((& $nodePath --version) -ne "v$nodeVersion") { throw 'The private runtime could not run. Check the supported Windows version.' }
  $bootstrap = Join-Path $stage 'bootstrap.cjs'
  Get-Download "$releaseBase/bootstrap.cjs" $bootstrap
  Test-Checksum $bootstrap $bootstrapSha
  & $nodePath $bootstrap @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw "Penelopa finished with status $LASTEXITCODE. Hooks may already be installed; use -Diagnose." }
} finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
  if ($lock) { $lock.Dispose() }
}
