param(
  [Parameter(Mandatory = $true)][string]$VerifiedRun,
  [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
if ($VerifiedRun -notmatch '^\d+$') { throw 'Provide the successful full Windows run ID' }
$repository = 'Darlingfxx02/no-tipe'
$jobsText = gh api "repos/$repository/actions/runs/$VerifiedRun/jobs?per_page=100"
if ($LASTEXITCODE -ne 0) { throw 'Could not read the verified Windows jobs' }
$jobResponse = $jobsText | ConvertFrom-Json
$jobs = @($jobResponse.jobs)
if ($jobs.Count -eq 0 -or $jobs.Count -ne $jobResponse.total_count) { throw 'Expected a complete list of verified Windows jobs' }
if (@($jobs | Where-Object { $_.run_id -ne $VerifiedRun -or $_.status -ne 'completed' -or $_.conclusion -ne 'success' }).Count -ne 0) { throw 'All reference Windows jobs must have passed' }
$headShas = @($jobs | ForEach-Object head_sha | Sort-Object -Unique)
if ($headShas.Count -ne 1 -or $headShas[0] -notmatch '^[0-9a-f]{40}$') { throw 'Expected one verified application commit' }
$metadata = [PSCustomObject]@{headSha=$headShas[0]; jobs=$jobs}
$requiredChecks = @('Verify Windows Rust code', 'Verify Tiny and Base recognition on Windows', 'Verify native installer UI and updates')
$passedChecks = @($metadata.jobs | ForEach-Object steps | Where-Object { $_.name -in $requiredChecks -and $_.conclusion -eq 'success' } | ForEach-Object name | Sort-Object -Unique)
if ($passedChecks.Count -ne $requiredChecks.Count) { throw 'The reference run must include successful Rust and live recognition checks' }
$comparisonText = gh api "repos/$repository/compare/$($metadata.headSha)...$env:GITHUB_SHA"
if ($LASTEXITCODE -ne 0) { throw 'Could not compare the verified application source' }
$comparison = $comparisonText | ConvertFrom-Json
if ($comparison.status -notin @('ahead', 'identical') -or @($comparison.files).Count -ge 300) { throw 'The verified commit must be an ancestor with a complete source comparison' }
$changedApp = @($comparison.files | ForEach-Object filename | Where-Object {
  ($_ -like 'CrossPlatform/*' -or $_ -in @('LICENSE', 'THIRD-PARTY-NOTICES.md')) -and
  $_ -notlike 'CrossPlatform/src-tauri/installer/*' -and
  $_ -notin @('CrossPlatform/scripts/rebundle-installer.ps1', 'CrossPlatform/scripts/test-installer.ps1')
})
if ($changedApp.Count -ne 0) { throw "Application source changed since the full verification: $($changedApp -join ', ')" }

$temporary = Join-Path $env:RUNNER_TEMP "no-tipe-verified-payload-$([Guid]::NewGuid())"
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  gh run download $VerifiedRun --repo $repository --name "no-tipe-windows-$Version" --dir $temporary
  if ($LASTEXITCODE -ne 0) { throw 'Could not download the verified Windows package' }
  $installer = Join-Path $temporary "NoType_${Version}_windows-x86_64-setup.exe"
  $expected = ((Get-Content (Join-Path $temporary 'SHA256SUMS.txt') -Encoding utf8 | Select-Object -First 1).Trim() -split '\s+')[0]
  if ($expected -notmatch '^[0-9a-fA-F]{64}$' -or (Get-FileHash $installer -Algorithm SHA256).Hash -ne $expected) { throw 'The verified installer checksum does not match' }
  $payload = Join-Path $temporary 'payload'
  & 'C:\Program Files\7-Zip\7z.exe' x $installer "-o$payload" -y | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not extract the verified application payload' }
  foreach ($entry in @(
    @{name='no-tipe-desktop.exe'; destination='src-tauri/target/release/no-tipe-desktop.exe'},
    @{name='no-tipe-text.exe'; destination='src-tauri/local-text/no-tipe-text.exe'},
    @{name='llama.cpp-LICENSE.txt'; destination='src-tauri/local-text/llama.cpp-LICENSE.txt'}
  )) {
    $matches = @(Get-ChildItem $payload -Recurse -File | Where-Object Name -eq $entry.name)
    if ($matches.Count -ne 1) { throw "Expected one verified $($entry.name) payload" }
    New-Item -ItemType Directory -Force (Split-Path $entry.destination) | Out-Null
    Copy-Item -LiteralPath $matches[0].FullName -Destination $entry.destination -Force
  }
  $env:NO_TIPE_VERIFIED_APP_SHA256 = (Get-FileHash 'src-tauri/target/release/no-tipe-desktop.exe' -Algorithm SHA256).Hash
  "Verified application source and payload from Windows run $VerifiedRun."
} finally {
  Remove-Item -LiteralPath $temporary -Recurse -Force
}
