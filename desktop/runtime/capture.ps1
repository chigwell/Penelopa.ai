param([ValidateSet('codex-openai', 'claude-anthropic')][string]$Source)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $OutputEncoding
[Console]::OutputEncoding = $OutputEncoding
$root = [System.IO.Directory]::GetParent($PSScriptRoot).FullName
$env:AUTO_IMPROVE_HOME = $root
# Read UTF-8 bytes directly, independent of the Windows PowerShell host reader.
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false, $true))
try { $payload = $reader.ReadToEnd() } finally { $reader.Dispose() }
$nodePath = [System.IO.File]::ReadAllText((Join-Path $root 'node-path'), $OutputEncoding).Trim()
$payload | & $nodePath (Join-Path $root 'bin/hook.cjs') $Source
exit 0
