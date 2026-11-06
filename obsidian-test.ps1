param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Command
)

$ErrorActionPreference = 'Stop'
$cli = $env:OBSIDIAN_CLI
if (-not $cli) { $cli = (Get-Command Obsidian -ErrorAction SilentlyContinue).Source }
$expected = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'test-vault')).TrimEnd('\')
if (-not $cli -or -not (Test-Path -LiteralPath $cli)) { throw 'Set OBSIDIAN_CLI to the installed Obsidian CLI executable.' }
if (-not $Command.Count) { throw 'Pass an Obsidian command, for example: .\obsidian-test.ps1 vault info=path' }
if ($Command | Where-Object { $_ -match '(?i)^vault=' }) { throw 'Overriding the test vault is not allowed.' }

$probe = (& $cli 'vault=test-vault' eval 'code=JSON.stringify({path:app.vault.adapter.basePath})') -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Cannot reach the test vault.' }
$prefix = $probe.IndexOf('=> ')
if ($prefix -lt 0) { throw 'Cannot verify the test vault path.' }
$actual = ($probe.Substring($prefix + 3) | ConvertFrom-Json).path
if ([IO.Path]::GetFullPath($actual).TrimEnd('\') -ne $expected) { throw "Wrong vault: $actual" }
& $cli 'vault=test-vault' @Command
if ($LASTEXITCODE -ne 0) { throw "Obsidian command failed: $LASTEXITCODE" }
